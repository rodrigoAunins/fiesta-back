import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from '../../entities/user.entity';
import { Raffle } from '../../entities/raffle.entity';
import { Ticket } from '../../entities/ticket.entity';
import { RafflePurchase } from '../../entities/raffle-purchase.entity';
import { RafflePurchaseItem } from '../../entities/raffle-purchase-item.entity';
import { PaymentProof } from '../../entities/payment-proof.entity';
import { RaffleAccessPayment } from '../../entities/raffle-access-payment.entity';
import { GlobalCatalogItem } from '../../entities/global-catalog-item.entity';

import { RafflePurchaseStatus } from '../../common/enums/raffle-purchase-status.enum';
import { RaffleAccessPaymentStatus } from '../../common/enums/raffle-access-payment-status.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import {
  ensureStrongPassword,
  hashSecret,
  isSuperAdminEmail,
  sanitizeUser,
} from '../auth/auth.utils';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';

type AdminOverviewRange = '7d' | '30d' | '90d';

type DateRangeContext = {
  range: AdminOverviewRange;
  days: number;
  start: Date;
  end: Date;
  todayStart: Date;
};

type ActivityItem = {
  id: string;
  type:
    | 'raffle_created'
    | 'unlock_paid'
    | 'purchase_confirmed'
    | 'purchase_pending'
    | 'raffle_finished';
  title: string;
  description: string;
  createdAt: string;
  tone: 'blue' | 'green' | 'amber' | 'rose';
};

@Injectable()
export class AdminService {
  private readonly CONFIRMED_PURCHASE_STATUSES = [
    RafflePurchaseStatus.APPROVED,
    RafflePurchaseStatus.AUTO_APPROVED,
  ];

  private readonly PENDING_PROOF_STATUSES = ['pending', 'ocr_review'];

  constructor(
    private readonly configService: ConfigService,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(Raffle)
    private readonly raffleRepo: Repository<Raffle>,

    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,

    @InjectRepository(RafflePurchase)
    private readonly purchaseRepo: Repository<RafflePurchase>,

    @InjectRepository(RafflePurchaseItem)
    private readonly purchaseItemRepo: Repository<RafflePurchaseItem>,

    @InjectRepository(PaymentProof)
    private readonly paymentProofRepo: Repository<PaymentProof>,

    @InjectRepository(RaffleAccessPayment)
    private readonly accessPaymentRepo: Repository<RaffleAccessPayment>,

    @InjectRepository(GlobalCatalogItem)
    private readonly globalCatalogRepo: Repository<GlobalCatalogItem>,
  ) {}

  async getOverview(user: any, rawRange?: string) {
    this.assertSuperAdminAccess(user);

    const ctx = this.resolveDateRange(rawRange);

    const [summary, charts, topRaffles, recentActivity] = await Promise.all([
      this.buildSummary(ctx),
      this.buildCharts(ctx),
      this.buildTopRaffles(ctx),
      this.buildRecentActivity(ctx),
    ]);

    const alerts = this.buildAlerts(summary);

    return {
      meta: {
        range: ctx.range,
        generatedAt: new Date().toISOString(),
        isMock: false,
      },
      summary,
      charts,
      topRaffles,
      recentActivity,
      alerts,
    };
  }

  async getUsers(user: any) {
    this.assertManagerAccess(user);

    const qb = this.userRepo
      .createQueryBuilder('user')
      .orderBy('"user"."createdAt"', 'DESC');

    if (!this.isSuperAdmin(user)) {
      qb.where('"user"."role" IN (:...roles)', {
        roles: [UserRole.GUEST, UserRole.SELLER, UserRole.DOOR],
      });
    }

    const users = await qb.getMany();

    return users.map((item) => {
      const sanitized = sanitizeUser(item);
      return {
        ...sanitized,
        role: this.isSuperAdmin({ email: item.email }) ? 'master' : sanitized?.role,
      };
    });
  }

  async createUser(user: any, data: CreateAdminUserDto) {
    this.assertManagerAccess(user);

    if (!this.isSuperAdmin(user) && data.role === UserRole.ORGANIZER) {
      throw new ForbiddenException('Solo el master puede crear organizadores.');
    }

    if (!ensureStrongPassword(data.password)) {
      throw new BadRequestException(
        'La contraseña debe tener al menos 8 caracteres, una mayúscula y un número',
      );
    }

    const exists = await this.userRepo
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email: data.email })
      .getOne();

    if (exists) {
      throw new BadRequestException('Ya existe una cuenta con ese correo electrónico');
    }

    const userToCreate = this.userRepo.create({
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      passwordHash: await hashSecret(data.password),
      googleId: null,
      recoveryCodeHash: null,
      recoveryCodeGeneratedAt: null,
      role: data.role as User['role'],
      isActive: true,
      mp_access_token: null,
      mp_refresh_token: null,
      mp_user_id: null,
    });

    const saved = await this.userRepo.save(userToCreate);
    return sanitizeUser(saved);
  }

  async getFinalUserEvents(user: any, finalUserId: string) {
    this.assertManagerAccess(user);
    const finalUser = await this.getFinalUser(finalUserId);

    const qb = this.raffleRepo
      .createQueryBuilder('raffle')
      .leftJoinAndSelect('raffle.creator', 'creator')
      .leftJoinAndSelect('raffle.finalUser', 'finalUser')
      .leftJoinAndSelect('raffle.createdBy', 'createdBy')
      .where('"raffle"."finalUserId" = :finalUserId', { finalUserId })
      .orderBy('"raffle"."createdAt"', 'DESC');

    if (!this.isSuperAdmin(user)) {
      qb.andWhere('("creator"."id" = :managerId OR "createdBy"."id" = :managerId)', {
        managerId: user.id,
      });
    }

    const events = await qb.getMany();
    return {
      user: sanitizeUser(finalUser),
      events: events.map((event) => this.serializeManagedEvent(event)),
    };
  }

  async assignFinalUser(user: any, eventId: string, finalUserId: string | null) {
    this.assertManagerAccess(user);
    const event = await this.raffleRepo.findOne({
      where: { id: eventId },
      relations: ['creator', 'finalUser', 'createdBy'],
    });
    if (!event) {
      throw new BadRequestException('El evento seleccionado no existe.');
    }

    if (!this.isSuperAdmin(user)) {
      const canManage = event.creator?.id === user.id || event.createdBy?.id === user.id;
      if (!canManage) {
        throw new ForbiddenException('No tenes permisos para modificar este evento.');
      }
    }

    if (finalUserId) {
      const finalUser = await this.getFinalUser(finalUserId);
      event.finalUser = finalUser;
      event.finalUserId = finalUser.id;
    } else {
      event.finalUser = null;
      event.finalUserId = null;
    }

    const saved = await this.raffleRepo.save(event);
    return this.serializeManagedEvent(saved);
  }

  private async getFinalUser(id: string) {
    const finalUser = await this.userRepo.findOne({ where: { id } });
    if (!finalUser) {
      throw new BadRequestException('El usuario final seleccionado no existe.');
    }
    if (String(finalUser.role) !== UserRole.GUEST) {
      throw new BadRequestException('El usuario seleccionado no es un usuario final.');
    }
    return finalUser;
  }

  private serializeManagedEvent(event: Raffle) {
    const finalUser = event.finalUser ? sanitizeUser(event.finalUser) : null;
    const creator = event.creator ? sanitizeUser(event.creator) : null;
    return {
      id: event.id,
      title: event.title,
      status: event.status,
      drawDate: event.drawDate,
      createdAt: event.createdAt,
      totalNumbers: event.totalNumbers,
      finalUserId: event.finalUserId || null,
      finalUser,
      creator,
    };
  }

  async getGlobalCatalog(user: any) {
    if (!user?.id) {
      throw new ForbiddenException('Sesión inválida.');
    }

    const items = await this.globalCatalogRepo.find({
      order: {
        kind: 'ASC',
        orderIndex: 'ASC',
        name: 'ASC',
      },
    });

    return items;
  }

  async createGlobalCatalogItem(user: any, data: any) {
    this.assertSuperAdminAccess(user);

    const item = this.globalCatalogRepo.create(this.normalizeCatalogInput(data));
    return this.globalCatalogRepo.save(item);
  }

  async updateGlobalCatalogItem(user: any, id: string, data: any) {
    this.assertSuperAdminAccess(user);

    const item = await this.globalCatalogRepo.findOne({ where: { id } });
    if (!item) {
      throw new BadRequestException('El item del catálogo no existe.');
    }

    Object.assign(item, this.normalizeCatalogInput(data));
    return this.globalCatalogRepo.save(item);
  }

  async deleteGlobalCatalogItem(user: any, id: string) {
    this.assertSuperAdminAccess(user);

    const item = await this.globalCatalogRepo.findOne({ where: { id } });
    if (!item) {
      throw new BadRequestException('El item del catálogo no existe.');
    }

    await this.globalCatalogRepo.remove(item);
    return { success: true };
  }

  private normalizeCatalogInput(data: any) {
    const rawKind = String(data?.kind || '').trim().toLowerCase();
    if (!['provider', 'service'].includes(rawKind)) {
      throw new BadRequestException('El tipo debe ser provider o service.');
    }
    const kind = rawKind as GlobalCatalogItem['kind'];

    const name = String(data?.name || '').trim();
    if (!name) {
      throw new BadRequestException('El nombre es obligatorio.');
    }

    return {
      kind,
      name,
      category: String(data?.category || '').trim() || null,
      description: String(data?.description || '').trim() || null,
      phone: String(data?.phone || '').trim() || null,
      whatsapp: String(data?.whatsapp || '').trim() || null,
      imageUrl: String(data?.imageUrl || '').trim() || null,
      isActive: data?.isActive !== false,
      orderIndex: Number.isFinite(Number(data?.orderIndex)) ? Number(data.orderIndex) : 0,
    } satisfies Partial<GlobalCatalogItem>;
  }

  private assertSuperAdminAccess(user: any) {
    if (!this.isSuperAdmin(user)) {
      throw new ForbiddenException(
        'No tenés permisos para acceder al panel maestro.',
      );
    }
  }

  private assertManagerAccess(user: any) {
    if (!this.isSuperAdmin(user) && !['organizer', 'creator'].includes(user?.role)) {
      throw new ForbiddenException('No tenés permisos para administrar usuarios.');
    }
  }

  private isSuperAdmin(user: any) {
    return (
      user?.isSuperAdmin === true ||
      user?.role === 'master' ||
      isSuperAdminEmail(
        user?.email,
        this.configService.get<string>('SUPERADMIN_EMAILS'),
      )
    );
  }

  private resolveDateRange(rawRange?: string): DateRangeContext {
    const range: AdminOverviewRange =
      rawRange === '7d' || rawRange === '90d' ? rawRange : '30d';

    const daysMap: Record<AdminOverviewRange, number> = {
      '7d': 7,
      '30d': 30,
      '90d': 90,
    };

    const days = daysMap[range];

    const now = new Date();

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const start = new Date(todayStart);
    start.setDate(start.getDate() - (days - 1));

    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    return {
      range,
      days,
      start,
      end,
      todayStart,
    };
  }

  private purchaseAnchorExpr(alias = 'purchase') {
    return `COALESCE("${alias}"."approvedAt", "${alias}"."reviewedAt", "${alias}"."submittedAt", "${alias}"."createdAt")`;
  }

  private purchaseItemAnchorExpr(itemAlias = 'item', purchaseAlias = 'purchase') {
    return `COALESCE("${itemAlias}"."approvedAt", "${purchaseAlias}"."approvedAt", "${purchaseAlias}"."reviewedAt", "${purchaseAlias}"."createdAt")`;
  }

  private paymentAnchorExpr(alias = 'payment') {
    return `COALESCE("${alias}"."paidAt", "${alias}"."updatedAt", "${alias}"."createdAt")`;
  }

  private raffleFinishedAnchorExpr(alias = 'raffle') {
    return `COALESCE("${alias}"."finishedAt", "${alias}"."createdAt")`;
  }

  private ticketAnchorExpr(alias = 'ticket') {
    return `COALESCE("${alias}"."approvedAt", "${alias}"."createdAt")`;
  }

  private async buildSummary(ctx: DateRangeContext) {
    const [
      registeredPeople,
      confirmedPeople,
      checkedInPeople,
      totalRaffles,
      activeRaffles,
      finishedRaffles,
      totalCreators,
      activeCreators,
      paidUnlocks,
      totalUnlockableRaffles,
      unlockRevenue,
      purchaseRevenue,
      ticketGrossRevenue,
      ticketNetRevenue,
      ticketPlatformRevenue,
      pendingProofs,
      todayRegistrations,
    ] = await Promise.all([
      this.countRegisteredPeople(ctx),
      this.countConfirmedPeople(ctx),
      this.countCheckedInPeople(ctx),
      this.countRafflesCreated(ctx),
      this.countActiveRafflesCurrent(),
      this.countFinishedRaffles(ctx),
      this.countCreatorsInRange(ctx),
      this.countActiveCreatorsCurrent(),
      this.countPaidUnlocks(ctx),
      this.countUnlockableRafflesCurrent(),
      this.sumUnlockRevenue(ctx),
      this.sumConfirmedPurchaseRevenue(ctx),
      this.sumTicketGrossRevenue(ctx),
      this.sumTicketNetRevenue(ctx),
      this.sumTicketPlatformRevenue(ctx),
      this.countPendingProofsCurrent(),
      this.countTodayRegistrations(ctx),
    ]);

    const organizerGrossRevenue =
      ticketGrossRevenue > 0 ? ticketGrossRevenue : purchaseRevenue;

    const organizerNetRevenue =
      ticketNetRevenue > 0 ? ticketNetRevenue : organizerGrossRevenue;

    const platformRevenue = this.round2(unlockRevenue + ticketPlatformRevenue);

    return {
      registeredPeople,
      confirmedPeople,
      checkedInPeople,
      totalRaffles,
      activeRaffles,
      finishedRaffles,
      totalCreators,
      activeCreators,
      paidUnlocks,
      totalUnlockableRaffles,
      unlockRevenue: this.round2(unlockRevenue),
      organizerGrossRevenue: this.round2(organizerGrossRevenue),
      organizerNetRevenue: this.round2(organizerNetRevenue),
      platformRevenue: this.round2(platformRevenue),
      pendingProofs,
      todayRegistrations,
    };
  }

  private async buildCharts(ctx: DateRangeContext) {
    const [registrationsByDay, revenueByDay, unlocksByDay] = await Promise.all([
      this.getRegistrationsByDay(ctx),
      this.getRevenueByDay(ctx),
      this.getUnlocksByDay(ctx),
    ]);

    const [activeRaffles, finishedRaffles, paidUnlocks] = await Promise.all([
      this.countActiveRafflesCurrent(),
      this.countFinishedRaffles(ctx),
      this.countPaidUnlocks(ctx),
    ]);

    const paymentMethodBreakdown = await this.getPaymentMethodBreakdown(ctx);

    return {
      registrationsByDay,
      revenueByDay,
      unlocksByDay,
      raffleStatusBreakdown: [
        {
          label: 'Activas',
          value: activeRaffles,
          color: '#2563eb',
          helpText: 'Siguen vendiendo ahora mismo',
        },
        {
          label: 'Finalizadas',
          value: finishedRaffles,
          color: '#16a34a',
          helpText: 'Se cerraron en la ventana elegida',
        },
        {
          label: 'Con desbloqueo pago',
          value: paidUnlocks,
          color: '#7c3aed',
          helpText: 'Ya monetizaron para la plataforma',
        },
      ],
      paymentMethodBreakdown,
    };
  }

  private async buildTopRaffles(ctx: DateRangeContext) {
    const purchaseRows = await this.purchaseRepo
      .createQueryBuilder('purchase')
      .innerJoin('purchase.raffle', 'raffle')
      .innerJoin('raffle.creator', 'creator')
      .select('"raffle"."id"', 'id')
      .addSelect('"raffle"."title"', 'title')
      .addSelect('"raffle"."status"', 'status')
      .addSelect('"raffle"."createdAt"', 'createdAt')
      .addSelect('"creator"."firstName"', 'creatorFirstName')
      .addSelect('"creator"."lastName"', 'creatorLastName')
      .addSelect('COALESCE(SUM("purchase"."ticketCount"), 0)', 'confirmedEntries')
      .addSelect('COALESCE(SUM("purchase"."totalAmount"), 0)', 'grossRevenue')
      .where('"purchase"."status" IN (:...statuses)', {
        statuses: this.CONFIRMED_PURCHASE_STATUSES,
      })
      .andWhere(`${this.purchaseAnchorExpr('purchase')} BETWEEN :start AND :end`, {
        start: ctx.start,
        end: ctx.end,
      })
      .groupBy('"raffle"."id"')
      .addGroupBy('"raffle"."title"')
      .addGroupBy('"raffle"."status"')
      .addGroupBy('"raffle"."createdAt"')
      .addGroupBy('"creator"."firstName"')
      .addGroupBy('"creator"."lastName"')
      .orderBy('COALESCE(SUM("purchase"."totalAmount"), 0)', 'DESC')
      .limit(8)
      .getRawMany();

    const unlockRows = await this.accessPaymentRepo
      .createQueryBuilder('payment')
      .innerJoin('payment.raffle', 'raffle')
      .select('"raffle"."id"', 'raffleId')
      .addSelect('COALESCE(SUM("payment"."amount"), 0)', 'unlockAmount')
      .where('"payment"."status" = :status', {
        status: RaffleAccessPaymentStatus.PAID,
      })
      .groupBy('"raffle"."id"')
      .getRawMany();

    const unlockMap = new Map<
      string,
      {
        unlockPaid: boolean;
        unlockAmount: number;
      }
    >();

    for (const row of unlockRows) {
      const unlockAmount = this.toNumber(row.unlockAmount);
      unlockMap.set(String(row.raffleId), {
        unlockPaid: unlockAmount > 0,
        unlockAmount,
      });
    }

    return purchaseRows.map((row) => {
      const creatorName = `${String(row.creatorFirstName || '').trim()} ${String(
        row.creatorLastName || '',
      ).trim()}`.trim();

      const grossRevenue = this.toNumber(row.grossRevenue);
      const unlockInfo = unlockMap.get(String(row.id));

      const rawStatus = String(row.status || 'active');

      return {
        id: String(row.id),
        title: String(row.title || 'Evento sin nombre'),
        creatorName: creatorName || 'Sin organizador',
        status:
          rawStatus === 'finished'
            ? 'finished'
            : rawStatus === 'active'
              ? 'active'
              : 'paused',
        createdAt: row.createdAt,
        confirmedEntries: this.toInt(row.confirmedEntries),
        grossRevenue: this.round2(grossRevenue),
        netRevenue: this.round2(grossRevenue),
        unlockPaid: unlockInfo?.unlockPaid || false,
        unlockAmount: this.round2(unlockInfo?.unlockAmount || 0),
      };
    });
  }

  private async buildRecentActivity(ctx: DateRangeContext): Promise<ActivityItem[]> {
    const [
      recentCreatedRaffles,
      recentFinishedRaffles,
      recentUnlocks,
      recentApprovedPurchases,
      recentPendingProofs,
    ] = await Promise.all([
      this.raffleRepo
        .createQueryBuilder('raffle')
        .innerJoin('raffle.creator', 'creator')
        .select('"raffle"."id"', 'id')
        .addSelect('"raffle"."title"', 'title')
        .addSelect('"raffle"."createdAt"', 'createdAt')
        .addSelect('"creator"."firstName"', 'creatorFirstName')
        .addSelect('"creator"."lastName"', 'creatorLastName')
        .where('"raffle"."createdAt" BETWEEN :start AND :end', {
          start: ctx.start,
          end: ctx.end,
        })
        .orderBy('"raffle"."createdAt"', 'DESC')
        .limit(6)
        .getRawMany(),

      this.raffleRepo
        .createQueryBuilder('raffle')
        .select('"raffle"."id"', 'id')
        .addSelect('"raffle"."title"', 'title')
        .addSelect('"raffle"."finishedAt"', 'finishedAt')
        .where('"raffle"."status" = :status', { status: 'finished' })
        .andWhere('"raffle"."finishedAt" IS NOT NULL')
        .andWhere('"raffle"."finishedAt" BETWEEN :start AND :end', {
          start: ctx.start,
          end: ctx.end,
        })
        .orderBy('"raffle"."finishedAt"', 'DESC')
        .limit(6)
        .getRawMany(),

      this.accessPaymentRepo
        .createQueryBuilder('payment')
        .innerJoin('payment.raffle', 'raffle')
        .innerJoin('payment.creator', 'creator')
        .select('"payment"."id"', 'id')
        .addSelect('"payment"."amount"', 'amount')
        .addSelect('"payment"."paidAt"', 'paidAt')
        .addSelect('"raffle"."title"', 'raffleTitle')
        .addSelect('"creator"."firstName"', 'creatorFirstName')
        .addSelect('"creator"."lastName"', 'creatorLastName')
        .where('"payment"."status" = :status', {
          status: RaffleAccessPaymentStatus.PAID,
        })
        .andWhere('"payment"."paidAt" IS NOT NULL')
        .andWhere('"payment"."paidAt" BETWEEN :start AND :end', {
          start: ctx.start,
          end: ctx.end,
        })
        .orderBy('"payment"."paidAt"', 'DESC')
        .limit(6)
        .getRawMany(),

      this.purchaseRepo
        .createQueryBuilder('purchase')
        .innerJoin('purchase.raffle', 'raffle')
        .select('"purchase"."id"', 'id')
        .addSelect('"purchase"."buyerName"', 'buyerName')
        .addSelect('"purchase"."totalAmount"', 'totalAmount')
        .addSelect('"purchase"."approvedAt"', 'approvedAt')
        .addSelect('"purchase"."reviewedAt"', 'reviewedAt')
        .addSelect('"purchase"."submittedAt"', 'submittedAt')
        .addSelect('"purchase"."createdAt"', 'createdAt')
        .addSelect('"raffle"."title"', 'raffleTitle')
        .where('"purchase"."status" IN (:...statuses)', {
          statuses: this.CONFIRMED_PURCHASE_STATUSES,
        })
        .andWhere(`${this.purchaseAnchorExpr('purchase')} BETWEEN :start AND :end`, {
          start: ctx.start,
          end: ctx.end,
        })
        .orderBy(this.purchaseAnchorExpr('purchase'), 'DESC')
        .limit(6)
        .getRawMany(),

      this.paymentProofRepo
        .createQueryBuilder('proof')
        .innerJoin('proof.purchase', 'purchase')
        .innerJoin('purchase.raffle', 'raffle')
        .select('"proof"."id"', 'id')
        .addSelect('"proof"."createdAt"', 'createdAt')
        .addSelect('"proof"."reviewStatus"', 'reviewStatus')
        .addSelect('"purchase"."buyerName"', 'buyerName')
        .addSelect('"raffle"."title"', 'raffleTitle')
        .where('"proof"."reviewStatus" IN (:...statuses)', {
          statuses: this.PENDING_PROOF_STATUSES,
        })
        .andWhere('"proof"."createdAt" BETWEEN :start AND :end', {
          start: ctx.start,
          end: ctx.end,
        })
        .orderBy('"proof"."createdAt"', 'DESC')
        .limit(6)
        .getRawMany(),
    ]);

    const items: ActivityItem[] = [];

    for (const row of recentCreatedRaffles) {
      const creatorName = `${String(row.creatorFirstName || '').trim()} ${String(
        row.creatorLastName || '',
      ).trim()}`.trim();

      items.push({
        id: `raffle_created_${row.id}`,
        type: 'raffle_created',
        title: 'Nuevo evento creado',
        description: `"${String(row.title || 'Evento')}" fue publicado por ${
          creatorName || 'un organizador'
        }.`,
        createdAt: new Date(row.createdAt).toISOString(),
        tone: 'blue',
      });
    }

    for (const row of recentFinishedRaffles) {
      items.push({
        id: `raffle_finished_${row.id}`,
        type: 'raffle_finished',
        title: 'Evento finalizado',
        description: `"${String(row.title || 'Evento')}" fue cerrado y pasó a histórico.`,
        createdAt: new Date(row.finishedAt).toISOString(),
        tone: 'rose',
      });
    }

    for (const row of recentUnlocks) {
      const creatorName = `${String(row.creatorFirstName || '').trim()} ${String(
        row.creatorLastName || '',
      ).trim()}`.trim();

      items.push({
        id: `unlock_paid_${row.id}`,
        type: 'unlock_paid',
        title: 'Desbloqueo abonado',
        description: `"${String(row.raffleTitle || 'Evento')}" pagó ${this.formatMoney(
          this.toNumber(row.amount),
        )}${creatorName ? ` · ${creatorName}` : ''}.`,
        createdAt: new Date(row.paidAt).toISOString(),
        tone: 'green',
      });
    }

    for (const row of recentApprovedPurchases) {
      const anchorDate =
        row.approvedAt || row.reviewedAt || row.submittedAt || row.createdAt;

      items.push({
        id: `purchase_confirmed_${row.id}`,
        type: 'purchase_confirmed',
        title: 'Compra confirmada',
        description: `${String(row.buyerName || 'Un comprador')} quedó confirmado en "${
          row.raffleTitle || 'el evento'
        }" por ${this.formatMoney(this.toNumber(row.totalAmount))}.`,
        createdAt: new Date(anchorDate).toISOString(),
        tone: 'blue',
      });
    }

    for (const row of recentPendingProofs) {
      items.push({
        id: `purchase_pending_${row.id}`,
        type: 'purchase_pending',
        title: 'Comprobante pendiente',
        description: `${String(row.buyerName || 'Un comprador')} cargó comprobante para "${
          row.raffleTitle || 'el evento'
        }" y todavía espera revisión.`,
        createdAt: new Date(row.createdAt).toISOString(),
        tone: 'amber',
      });
    }

    return items
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 10);
  }

  private buildAlerts(summary: any) {
    const alerts: Array<{
      id: string;
      title: string;
      description: string;
      tone: 'blue' | 'green' | 'amber' | 'rose';
    }> = [];

    if (summary.pendingProofs > 0) {
      alerts.push({
        id: 'pending-proofs',
        title: 'Hay comprobantes esperando revisión',
        description: `${summary.pendingProofs} comprobantes siguen pendientes. Esto te sirve para detectar organizadores que están vendiendo pero validan lento.`,
        tone: 'amber',
      });
    }

    if (summary.paidUnlocks > 0) {
      alerts.push({
        id: 'unlocks',
        title: 'La monetización está activa',
        description: `${summary.paidUnlocks} desbloqueos pagos en la ventana elegida, con ${this.formatMoney(
          summary.unlockRevenue,
        )} de ingreso para plataforma.`,
        tone: 'green',
      });
    }

    if (summary.platformRevenue <= 0) {
      alerts.push({
        id: 'platform-zero',
        title: 'Todavía no hay monetización en el período',
        description:
          'Podés usar esto para detectar si faltan activaciones, planes o eventos que crucen el umbral.',
        tone: 'rose',
      });
    } else {
      alerts.push({
        id: 'platform-focus',
        title: 'Tus ingresos hoy dependen del desbloqueo',
        description:
          'Después podemos ampliar esto con suscripciones, comisión por venta o upsells sin tocar la estructura del panel.',
        tone: 'blue',
      });
    }

    return alerts.slice(0, 3);
  }

  private async countRegisteredPeople(ctx: DateRangeContext) {
    return this.purchaseItemRepo
      .createQueryBuilder('item')
      .where('"item"."createdAt" BETWEEN :start AND :end', {
        start: ctx.start,
        end: ctx.end,
      })
      .getCount();
  }

  private async countConfirmedPeople(ctx: DateRangeContext) {
    return this.purchaseItemRepo
      .createQueryBuilder('item')
      .innerJoin('item.purchase', 'purchase')
      .where('"purchase"."status" IN (:...statuses)', {
        statuses: this.CONFIRMED_PURCHASE_STATUSES,
      })
      .andWhere(
        `${this.purchaseItemAnchorExpr('item', 'purchase')} BETWEEN :start AND :end`,
        {
          start: ctx.start,
          end: ctx.end,
        },
      )
      .getCount();
  }

  private async countCheckedInPeople(ctx: DateRangeContext) {
    return this.purchaseItemRepo
      .createQueryBuilder('item')
      .where('"item"."checkedInAt" IS NOT NULL')
      .andWhere('"item"."checkedInAt" BETWEEN :start AND :end', {
        start: ctx.start,
        end: ctx.end,
      })
      .getCount();
  }

  private async countRafflesCreated(ctx: DateRangeContext) {
    return this.raffleRepo
      .createQueryBuilder('raffle')
      .where('"raffle"."createdAt" BETWEEN :start AND :end', {
        start: ctx.start,
        end: ctx.end,
      })
      .getCount();
  }

  private async countActiveRafflesCurrent() {
    return this.raffleRepo
      .createQueryBuilder('raffle')
      .where('"raffle"."status" = :status', { status: 'active' })
      .getCount();
  }

  private async countFinishedRaffles(ctx: DateRangeContext) {
    return this.raffleRepo
      .createQueryBuilder('raffle')
      .where('"raffle"."status" = :status', { status: 'finished' })
      .andWhere(`${this.raffleFinishedAnchorExpr('raffle')} BETWEEN :start AND :end`, {
        start: ctx.start,
        end: ctx.end,
      })
      .getCount();
  }

  private async countCreatorsInRange(ctx: DateRangeContext) {
    const raw = await this.raffleRepo
      .createQueryBuilder('raffle')
      .innerJoin('raffle.creator', 'creator')
      .select('COUNT(DISTINCT "creator"."id")', 'count')
      .where('"raffle"."createdAt" BETWEEN :start AND :end', {
        start: ctx.start,
        end: ctx.end,
      })
      .getRawOne();

    return this.toInt(raw?.count);
  }

  private async countActiveCreatorsCurrent() {
    const raw = await this.raffleRepo
      .createQueryBuilder('raffle')
      .innerJoin('raffle.creator', 'creator')
      .select('COUNT(DISTINCT "creator"."id")', 'count')
      .where('"raffle"."status" = :status', { status: 'active' })
      .getRawOne();

    return this.toInt(raw?.count);
  }

  private async countPaidUnlocks(ctx: DateRangeContext) {
    return this.accessPaymentRepo
      .createQueryBuilder('payment')
      .where('"payment"."status" = :status', {
        status: RaffleAccessPaymentStatus.PAID,
      })
      .andWhere(`${this.paymentAnchorExpr('payment')} BETWEEN :start AND :end`, {
        start: ctx.start,
        end: ctx.end,
      })
      .getCount();
  }

  private async countUnlockableRafflesCurrent() {
    const confirmedRows = await this.purchaseItemRepo
      .createQueryBuilder('item')
      .innerJoin('item.purchase', 'purchase')
      .innerJoin('purchase.raffle', 'raffle')
      .select('"raffle"."id"', 'raffleId')
      .addSelect('COUNT("item"."id")', 'confirmedCount')
      .where('"purchase"."status" IN (:...statuses)', {
        statuses: this.CONFIRMED_PURCHASE_STATUSES,
      })
      .groupBy('"raffle"."id"')
      .having('COUNT("item"."id") >= :minConfirmed', { minConfirmed: 20 })
      .getRawMany();

    const paidUnlockRows = await this.accessPaymentRepo
      .createQueryBuilder('payment')
      .innerJoin('payment.raffle', 'raffle')
      .select('"raffle"."id"', 'raffleId')
      .where('"payment"."status" = :status', {
        status: RaffleAccessPaymentStatus.PAID,
      })
      .groupBy('"raffle"."id"')
      .getRawMany();

    const ids = new Set<string>();

    for (const row of confirmedRows) {
      ids.add(String(row.raffleId));
    }

    for (const row of paidUnlockRows) {
      ids.add(String(row.raffleId));
    }

    return ids.size;
  }

  private async sumUnlockRevenue(ctx: DateRangeContext) {
    const raw = await this.accessPaymentRepo
      .createQueryBuilder('payment')
      .select('COALESCE(SUM("payment"."amount"), 0)', 'total')
      .where('"payment"."status" = :status', {
        status: RaffleAccessPaymentStatus.PAID,
      })
      .andWhere(`${this.paymentAnchorExpr('payment')} BETWEEN :start AND :end`, {
        start: ctx.start,
        end: ctx.end,
      })
      .getRawOne();

    return this.toNumber(raw?.total);
  }

  private async sumConfirmedPurchaseRevenue(ctx: DateRangeContext) {
    const raw = await this.purchaseRepo
      .createQueryBuilder('purchase')
      .select('COALESCE(SUM("purchase"."totalAmount"), 0)', 'total')
      .where('"purchase"."status" IN (:...statuses)', {
        statuses: this.CONFIRMED_PURCHASE_STATUSES,
      })
      .andWhere(`${this.purchaseAnchorExpr('purchase')} BETWEEN :start AND :end`, {
        start: ctx.start,
        end: ctx.end,
      })
      .getRawOne();

    return this.toNumber(raw?.total);
  }

  private async sumTicketGrossRevenue(ctx: DateRangeContext) {
    const raw = await this.ticketRepo
      .createQueryBuilder('ticket')
      .select('COALESCE(SUM("ticket"."gross_amount"), 0)', 'total')
      .where('"ticket"."status" = :status', { status: 'sold' })
      .andWhere(`${this.ticketAnchorExpr('ticket')} BETWEEN :start AND :end`, {
        start: ctx.start,
        end: ctx.end,
      })
      .getRawOne();

    return this.toNumber(raw?.total);
  }

  private async sumTicketNetRevenue(ctx: DateRangeContext) {
    const raw = await this.ticketRepo
      .createQueryBuilder('ticket')
      .select('COALESCE(SUM("ticket"."organizer_net_amount"), 0)', 'total')
      .where('"ticket"."status" = :status', { status: 'sold' })
      .andWhere(`${this.ticketAnchorExpr('ticket')} BETWEEN :start AND :end`, {
        start: ctx.start,
        end: ctx.end,
      })
      .getRawOne();

    return this.toNumber(raw?.total);
  }

  private async sumTicketPlatformRevenue(ctx: DateRangeContext) {
    const raw = await this.ticketRepo
      .createQueryBuilder('ticket')
      .select('COALESCE(SUM("ticket"."platform_fee_amount"), 0)', 'total')
      .where('"ticket"."status" = :status', { status: 'sold' })
      .andWhere(`${this.ticketAnchorExpr('ticket')} BETWEEN :start AND :end`, {
        start: ctx.start,
        end: ctx.end,
      })
      .getRawOne();

    return this.toNumber(raw?.total);
  }

  private async countPendingProofsCurrent() {
    return this.paymentProofRepo
      .createQueryBuilder('proof')
      .where('"proof"."reviewStatus" IN (:...statuses)', {
        statuses: this.PENDING_PROOF_STATUSES,
      })
      .getCount();
  }

  private async countTodayRegistrations(ctx: DateRangeContext) {
    return this.purchaseItemRepo
      .createQueryBuilder('item')
      .where('"item"."createdAt" BETWEEN :start AND :end', {
        start: ctx.todayStart,
        end: ctx.end,
      })
      .getCount();
  }

  private async getRegistrationsByDay(ctx: DateRangeContext) {
    const rows = await this.purchaseItemRepo
      .createQueryBuilder('item')
      .select(`date_trunc('day', "item"."createdAt")`, 'day')
      .addSelect('COUNT("item"."id")', 'value')
      .where('"item"."createdAt" BETWEEN :start AND :end', {
        start: ctx.start,
        end: ctx.end,
      })
      .groupBy(`date_trunc('day', "item"."createdAt")`)
      .orderBy(`date_trunc('day', "item"."createdAt")`, 'ASC')
      .getRawMany();

    return this.fillSeries(ctx, rows, 'value');
  }

  private async getRevenueByDay(ctx: DateRangeContext) {
    const rows = await this.purchaseRepo
      .createQueryBuilder('purchase')
      .select(`date_trunc('day', ${this.purchaseAnchorExpr('purchase')})`, 'day')
      .addSelect('COALESCE(SUM("purchase"."totalAmount"), 0)', 'value')
      .where('"purchase"."status" IN (:...statuses)', {
        statuses: this.CONFIRMED_PURCHASE_STATUSES,
      })
      .andWhere(`${this.purchaseAnchorExpr('purchase')} BETWEEN :start AND :end`, {
        start: ctx.start,
        end: ctx.end,
      })
      .groupBy(`date_trunc('day', ${this.purchaseAnchorExpr('purchase')})`)
      .orderBy(`date_trunc('day', ${this.purchaseAnchorExpr('purchase')})`, 'ASC')
      .getRawMany();

    return this.fillSeries(ctx, rows, 'value');
  }

  private async getUnlocksByDay(ctx: DateRangeContext) {
    const rows = await this.accessPaymentRepo
      .createQueryBuilder('payment')
      .select(`date_trunc('day', ${this.paymentAnchorExpr('payment')})`, 'day')
      .addSelect('COUNT("payment"."id")', 'value')
      .where('"payment"."status" = :status', {
        status: RaffleAccessPaymentStatus.PAID,
      })
      .andWhere(`${this.paymentAnchorExpr('payment')} BETWEEN :start AND :end`, {
        start: ctx.start,
        end: ctx.end,
      })
      .groupBy(`date_trunc('day', ${this.paymentAnchorExpr('payment')})`)
      .orderBy(`date_trunc('day', ${this.paymentAnchorExpr('payment')})`, 'ASC')
      .getRawMany();

    return this.fillSeries(ctx, rows, 'value');
  }

  private async getPaymentMethodBreakdown(ctx: DateRangeContext) {
    const paidRows = await this.purchaseRepo
      .createQueryBuilder('purchase')
      .select('"purchase"."paymentMethod"', 'paymentMethod')
      .addSelect('COUNT("purchase"."id")', 'value')
      .where('"purchase"."status" IN (:...statuses)', {
        statuses: this.CONFIRMED_PURCHASE_STATUSES,
      })
      .andWhere('"purchase"."totalAmount" > 0')
      .andWhere(`${this.purchaseAnchorExpr('purchase')} BETWEEN :start AND :end`, {
        start: ctx.start,
        end: ctx.end,
      })
      .groupBy('"purchase"."paymentMethod"')
      .getRawMany();

    const freeRaw = await this.purchaseRepo
      .createQueryBuilder('purchase')
      .select('COUNT("purchase"."id")', 'value')
      .where('"purchase"."status" IN (:...statuses)', {
        statuses: this.CONFIRMED_PURCHASE_STATUSES,
      })
      .andWhere('"purchase"."totalAmount" <= 0')
      .andWhere(`${this.purchaseAnchorExpr('purchase')} BETWEEN :start AND :end`, {
        start: ctx.start,
        end: ctx.end,
      })
      .getRawOne();

    const byMethod = new Map<string, number>();

    for (const row of paidRows) {
      byMethod.set(String(row.paymentMethod || 'other'), this.toInt(row.value));
    }

    const freeCount = this.toInt(freeRaw?.value);

    const result = [
      {
        label: 'Transferencia',
        value: byMethod.get('transfer') || 0,
        color: '#2563eb',
      },
      {
        label: 'Efectivo',
        value: byMethod.get('cash') || 0,
        color: '#f59e0b',
      },
      {
        label: 'Link de pago',
        value: byMethod.get('link') || 0,
        color: '#7c3aed',
      },
      {
        label: 'Sin cargo',
        value: freeCount,
        color: '#16a34a',
      },
    ].filter((item) => item.value > 0);

    return result.length
      ? result
      : [
          {
            label: 'Sin datos',
            value: 0,
            color: '#94a3b8',
          },
        ];
  }

  private fillSeries(
    ctx: DateRangeContext,
    rows: Array<{ day: any; value: any }>,
    valueField: string,
  ) {
    const map = new Map<string, { label: string; value: number }>();

    for (let i = 0; i < ctx.days; i += 1) {
      const current = new Date(ctx.start);
      current.setDate(ctx.start.getDate() + i);

      const key = this.toDateKey(current);

      map.set(key, {
        label: this.toDisplayDate(current),
        value: 0,
      });
    }

    for (const row of rows) {
      const key = this.toDateKey(new Date(row.day));
      const existing = map.get(key);

      if (existing) {
        existing.value = this.toNumber(row[valueField]);
      }
    }

    return Array.from(map.values());
  }

  private toDateKey(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private toDisplayDate(date: Date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}`;
  }

  private toNumber(value: unknown, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  private toInt(value: unknown, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
  }

  private round2(value: number) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  private formatMoney(value: number) {
    return `$${this.round2(value).toLocaleString('es-AR')}`;
  }
}
