import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

import { User } from '../../entities/user.entity';
import { Raffle } from '../../entities/raffle.entity';
import { Ticket } from '../../entities/ticket.entity';
import { Prize } from '../../entities/prize.entity';
import { SellerAssignment } from '../../entities/seller-assignment.entity';
import { DoorAssignment } from '../../entities/door-assignment.entity';
import { RaffleSeat } from '../../entities/raffle-seat.entity';
import { RafflePurchaseItem } from '../../entities/raffle-purchase-item.entity';
import { RaffleAccessPayment } from '../../entities/raffle-access-payment.entity';

import { RaffleMode } from '../../common/enums/raffle-mode.enum';
import { RaffleAccessPaymentStatus } from '../../common/enums/raffle-access-payment-status.enum';
import { RafflePurchaseStatus } from '../../common/enums/raffle-purchase-status.enum';

import { buildRafflePricing, round2, toNumber } from './raffles.pricing';
import { CreateRaffleDto } from './dto/create-raffle.dto';
import { FinalizeDrawDto } from './dto/finalize-draw.dto';
import { CreateDoorStaffDto } from './dto/create-door-staff.dto';

type UserRole = 'master' | 'creator' | 'organizer' | 'guest' | 'seller' | 'door';

type ShareImageResult =
  | { kind: 'binary'; contentType: string; buffer: Buffer }
  | { kind: 'redirect'; url: string };

@Injectable()
export class RafflesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(Raffle)
    private readonly raffleRepo: Repository<Raffle>,

    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,

    @InjectRepository(SellerAssignment)
    private readonly assignRepo: Repository<SellerAssignment>,

    @InjectRepository(DoorAssignment)
    private readonly doorAssignRepo: Repository<DoorAssignment>,

    @InjectRepository(RaffleSeat)
    private readonly seatRepo: Repository<RaffleSeat>,

    @InjectRepository(Prize)
    private readonly prizeRepo: Repository<Prize>,

    @InjectRepository(RafflePurchaseItem)
    private readonly purchaseItemRepo: Repository<RafflePurchaseItem>,

    @InjectRepository(RaffleAccessPayment)
    private readonly accessPaymentRepo: Repository<RaffleAccessPayment>,
  ) {}

  getFeeConfig() {
    return {
      platformFeeRate: 0,
      estimatedMpFeeRate: 0,
    };
  }

  async createRaffle(
    creatorId: string,
    role: UserRole,
    data: CreateRaffleDto,
  ) {
    if (!['master', 'creator', 'organizer'].includes(role)) {
      throw new BadRequestException('Solo el organizador puede crear eventos');
    }

    const eventName = data.title?.trim();

    if (!eventName) {
      throw new BadRequestException('El nombre del evento es obligatorio');
    }

    const finalUser = await this.userRepo.findOne({
      where: { id: data.finalUserId },
    });

    if (!finalUser) {
      throw new BadRequestException('El usuario final seleccionado no existe');
    }

    if (finalUser.role !== 'guest') {
      throw new BadRequestException('Debes asociar un usuario final al evento');
    }

    const requestedOrganizerId = data.organizerId || data.assignedToId || null;
    let targetCreatorId = creatorId;

    if (role === 'master' && requestedOrganizerId) {
      const organizer = await this.userRepo.findOne({
        where: { id: requestedOrganizerId },
      });

      if (!organizer) {
        throw new BadRequestException('El organizador seleccionado no existe');
      }

      if (!['creator', 'organizer'].includes(String(organizer.role))) {
        throw new BadRequestException('El responsable asignado debe ser organizador');
      }

      targetCreatorId = organizer.id;
    }

    const parsedTotalNumbers =
      Number.isFinite(Number(data.totalNumbers)) && Number(data.totalNumbers) > 0
        ? Number(data.totalNumbers)
        : Number((data as any).maxCapacity || (data as any).estimatedAttendanceCapacity || 0);

    if (!parsedTotalNumbers || parsedTotalNumbers <= 0) {
      throw new BadRequestException('La capacidad total del evento debe ser mayor a 0');
    }

    const { platformFeeRate, estimatedMpFeeRate } = this.getFeeConfig();

    const desiredNetGoal = Number(data.desiredNetGoal || '0');
    const explicitTicketPrice =
      (data as any).ticketPrice !== undefined && (data as any).ticketPrice !== null
        ? Number((data as any).ticketPrice)
        : null;

    const pricing =
      explicitTicketPrice !== null && Number.isFinite(explicitTicketPrice)
        ? {
            suggestedTicketPrice: Math.max(0, explicitTicketPrice),
            rawTicketPrice: Math.max(0, explicitTicketPrice),
            estimatedGrossGoal: round2(Math.max(0, explicitTicketPrice) * parsedTotalNumbers),
            estimatedPlatformFeeAmount: 0,
            estimatedMpFeeAmount: 0,
            estimatedOrganizerNet: round2(Math.max(0, explicitTicketPrice) * parsedTotalNumbers),
            totalRate: 0,
          }
        : buildRafflePricing({
            desiredNetGoal,
            totalNumbers: parsedTotalNumbers,
            platformFeeRate,
            estimatedMpFeeRate,
          });

    const allowTransfer =
      typeof data.allowTransfer === 'boolean' ? data.allowTransfer : true;

    const allowCash =
      typeof data.allowCash === 'boolean' ? data.allowCash : true;

    const isPaid =
      typeof (data as any).isPaid === 'boolean'
        ? (data as any).isPaid
        : pricing.suggestedTicketPrice > 0;

    const finalTicketPrice = isPaid ? Math.max(0, pricing.suggestedTicketPrice) : 0;

    const transferAlias =
      allowTransfer && data.transferAlias?.trim()
        ? data.transferAlias.trim()
        : null;

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const raffle = qr.manager.create(Raffle, {
        title: eventName,
        description: data.desc?.trim() || null,
        ticketPrice: finalTicketPrice.toFixed(2),
        totalNumbers: parsedTotalNumbers,
        minDrawPercent: Number(data.minDraw || '0').toFixed(2),
        drawDate: new Date(data.drawDate),

        desiredNetGoal: desiredNetGoal.toFixed(2),
        platformFeeRate: Number(platformFeeRate).toFixed(5),
        estimatedMpFeeRate: Number(estimatedMpFeeRate).toFixed(5),
        estimatedGrossGoal: Number(pricing.estimatedGrossGoal || 0).toFixed(2),

        status: 'active',
        finishedAt: null,

        transferAlias,
        allowTransfer,
        allowCash,

        coverImageBase64: data.coverImage || null,
        themeName: data.themeName || 'classic',
        themePrimaryColor: data.themePrimaryColor || '#fff159',
        themeSecondaryColor: data.themeSecondaryColor || '#3483fa',
        themeAccentColor: data.themeAccentColor || '#00a650',
        themeTextColor: data.themeTextColor || '#0f172a',
        themeCardColor: data.themeCardColor || '#ffffff',

        creator: { id: targetCreatorId } as any,
        finalUser: { id: finalUser.id } as any,
        finalUserId: finalUser.id,
        createdBy: { id: creatorId } as any,
        createdById: creatorId,
        createdByRole: role as any,
      });

      const saved = await qr.manager.save(raffle);

      const prizes = (data.prizes || []).map((p, index) =>
        qr.manager.create(Prize, {
          title: p.title.trim(),
          description: p.desc?.trim() || null,
          youtubeLink: p.video?.trim() || null,
          imageBase64: p.image || null,
          drawOrder: index + 1,
          winningTicketId: null,
          winningTicketNumber: null,
          winnerName: null,
          winnerPhone: null,
          raffle: saved,
        }),
      );

      if (prizes.length > 0) {
        await qr.manager.save(prizes);
      }

      const tickets: Partial<Ticket>[] = [];
      const pad = parsedTotalNumbers > 100 ? 3 : 2;

      for (let i = 1; i <= parsedTotalNumbers; i++) {
        tickets.push({
          number: i.toString().padStart(pad, '0'),
          raffle: saved,
          status: 'available',
          buyerName: null,
          buyerPhone: null,
          buyerEmail: null,
          mp_payment_id: null,
          mp_payment_status: null,
          mp_payment_method_id: null,
          mp_payment_type_id: null,
          lockedAt: null,
          approvedAt: null,
          gross_amount: '0.00',
          mp_fee_amount: '0.00',
          platform_fee_amount: '0.00',
          organizer_net_amount: '0.00',
          soldBySeller: null,
        });
      }

      await qr.manager
        .createQueryBuilder()
        .insert()
        .into(Ticket)
        .values(tickets)
        .execute();

      await qr.commitTransaction();

      return {
        ...saved,
        pricing,
      };
    } catch (error) {
      console.error('ERROR GUARDANDO EVENTO/RIFA:', error);
      await qr.rollbackTransaction();
      throw new InternalServerErrorException('Error creando el evento');
    } finally {
      await qr.release();
    }
  }

  async finalizeDraw(
    raffleId: string,
    creatorId: string,
    actorRole: UserRole,
    data: FinalizeDrawDto,
  ) {
    if (actorRole !== 'creator') {
      throw new ForbiddenException('Solo el organizador puede finalizar el sorteo');
    }

    const raffle = await this.raffleRepo.findOne({
      where: { id: raffleId, creator: { id: creatorId } },
      relations: ['tickets', 'prizes'],
    });

    if (!raffle) {
      throw new NotFoundException('Evento/Rifa no encontrado');
    }

    if (raffle.status === 'finished') {
      throw new BadRequestException('El sorteo ya fue finalizado');
    }

    if (!data?.winners?.length) {
      throw new BadRequestException('No se recibieron ganadores');
    }

    const soldTickets = raffle.tickets.filter((t) => t.status === 'sold');
    const soldMap = new Map(soldTickets.map((t) => [t.id, t]));
    const prizeMap = new Map(raffle.prizes.map((p) => [p.id, p]));
    const usedTicketIds = new Set<string>();

    raffle.prizes.forEach((p) => {
      p.winningTicketId = null;
      p.winningTicketNumber = null;
      p.winnerName = null;
      p.winnerPhone = null;
    });

    for (const winner of data.winners) {
      const prize = prizeMap.get(winner.prizeId);
      if (!prize) {
        throw new BadRequestException(`Premio inválido: ${winner.prizeId}`);
      }

      const ticket = soldMap.get(winner.ticketId);
      if (!ticket) {
        throw new BadRequestException(
          `Ticket inválido o no vendido: ${winner.ticketId}`,
        );
      }

      if (usedTicketIds.has(ticket.id)) {
        throw new BadRequestException(
          `El ticket ${ticket.number} ya fue usado para otro premio`,
        );
      }

      usedTicketIds.add(ticket.id);

      prize.drawOrder = winner.drawOrder;
      prize.winningTicketId = ticket.id;
      prize.winningTicketNumber = ticket.number;
      prize.winnerName = winner.buyerName || ticket.buyerName || null;
      prize.winnerPhone = winner.buyerPhone || ticket.buyerPhone || null;
    }

    raffle.status = 'finished';
    raffle.finishedAt = new Date();

    await this.prizeRepo.save(raffle.prizes);
    await this.raffleRepo.save(raffle);

    return this.getPublicRaffle(raffleId);
  }

  async getMyRaffles(userId: string, role: UserRole) {
    if (role === 'master') {
      const raffles = await this.raffleRepo.find({
        relations: ['creator', 'finalUser', 'createdBy', 'tickets', 'prizes', 'sellers', 'doors', 'seats'],
        order: { createdAt: 'DESC' },
      });

      return Promise.all(
        raffles.map(async (raffle) => {
          const unlock = await this.getUnlockInfo(raffle.id, raffle.totalNumbers);

          return {
            ...raffle,
            financials: this.buildFinancials(
              raffle.tickets || [],
              raffle.ticketPrice,
            ),
            unlock,
            sellersCount: Array.isArray(raffle.sellers) ? raffle.sellers.length : 0,
            doorUsersCount: Array.isArray(raffle.doors) ? raffle.doors.length : 0,
            seatsCount: Array.isArray(raffle.seats) ? raffle.seats.length : 0,
          };
        }),
      );
    }

    if (role === 'guest') {
      const raffles = await this.raffleRepo.find({
        where: { finalUser: { id: userId } },
        relations: ['creator', 'finalUser', 'createdBy', 'tickets', 'prizes', 'sellers', 'doors', 'seats'],
        order: { createdAt: 'DESC' },
      });

      return Promise.all(
        raffles.map(async (raffle) => {
          const unlock = await this.getUnlockInfo(raffle.id, raffle.totalNumbers);

          return {
            ...raffle,
            financials: this.buildFinancials(
              raffle.tickets || [],
              raffle.ticketPrice,
            ),
            unlock,
            sellersCount: Array.isArray(raffle.sellers) ? raffle.sellers.length : 0,
            doorUsersCount: Array.isArray(raffle.doors) ? raffle.doors.length : 0,
            seatsCount: Array.isArray(raffle.seats) ? raffle.seats.length : 0,
          };
        }),
      );
    }

    if (role === 'organizer') {
      role = 'creator';
    }

    if (role === 'creator') {
      const raffles = await this.raffleRepo.find({
        where: { creator: { id: userId } },
        relations: ['creator', 'finalUser', 'createdBy', 'tickets', 'prizes', 'sellers', 'doors', 'seats'],
        order: { createdAt: 'DESC' },
      });

      return Promise.all(
        raffles.map(async (raffle) => {
          const unlock = await this.getUnlockInfo(raffle.id, raffle.totalNumbers);

          return {
            ...raffle,
            financials: this.buildFinancials(
              raffle.tickets || [],
              raffle.ticketPrice,
            ),
            unlock,
            sellersCount: Array.isArray(raffle.sellers) ? raffle.sellers.length : 0,
            doorUsersCount: Array.isArray(raffle.doors) ? raffle.doors.length : 0,
            seatsCount: Array.isArray(raffle.seats) ? raffle.seats.length : 0,
          };
        }),
      );
    }

    if (role === 'seller') {
      const assignments = await this.assignRepo.find({
        where: { seller: { id: userId } },
        relations: ['raffle', 'raffle.tickets', 'raffle.prizes', 'raffle.seats'],
        order: { createdAt: 'DESC' },
      });

      return Promise.all(
        assignments.map(async (assignment) => {
          const raffle = assignment.raffle;
          const unlock = await this.getUnlockInfo(raffle.id, raffle.totalNumbers);

          return {
            ...raffle,
            assignment: {
              id: assignment.id,
              commissionPercent: assignment.commissionPercent,
              isActive: assignment.isActive,
              shareSlug: assignment.shareSlug,
              label: assignment.label,
              notes: assignment.notes,
              createdAt: assignment.createdAt,
            },
            financials: this.buildFinancials(raffle.tickets || [], raffle.ticketPrice),
            unlock,
          };
        }),
      );
    }

    if (role === 'door') {
      const assignments = await this.doorAssignRepo.find({
        where: { doorUser: { id: userId } },
        relations: ['raffle', 'raffle.tickets', 'raffle.prizes', 'raffle.seats'],
        order: { createdAt: 'DESC' },
      });

      return Promise.all(
        assignments.map(async (assignment) => {
          const raffle = assignment.raffle;
          const unlock = await this.getUnlockInfo(raffle.id, raffle.totalNumbers);

          return {
            ...raffle,
            doorAssignment: {
              id: assignment.id,
              isActive: assignment.isActive,
              label: assignment.label,
              notes: assignment.notes,
              createdAt: assignment.createdAt,
            },
            financials: this.buildFinancials(raffle.tickets || [], raffle.ticketPrice),
            unlock,
          };
        }),
      );
    }

    return [];
  }

  async getCreatorDashboard(
    raffleId: string,
    creatorId: string,
    actorRole: UserRole,
  ) {
    if (!['master', 'creator', 'organizer', 'guest'].includes(actorRole)) {
      throw new ForbiddenException(
        'Solo el organizador puede acceder al dashboard principal',
      );
    }

    const where =
      actorRole === 'master'
        ? { id: raffleId }
        : actorRole === 'guest'
          ? { id: raffleId, finalUser: { id: creatorId } }
          : { id: raffleId, creator: { id: creatorId } };

    const raffle = await this.raffleRepo.findOne({
      where,
      relations: [
        'creator',
        'finalUser',
        'createdBy',
        'tickets',
        'tickets.seat',
        'prizes',
        'sellers',
        'sellers.seller',
        'doors',
        'doors.doorUser',
        'seats',
      ],
    });

    if (!raffle) {
      throw new NotFoundException('Evento/Rifa no encontrado');
    }

    const soldCount = (raffle.tickets || []).filter((t) => t.status === 'sold').length;
    const pendingCount = (raffle.tickets || []).filter((t) => t.status === 'pending').length;

    const salesProgressPercent =
      raffle.totalNumbers > 0 ? round2((soldCount / raffle.totalNumbers) * 100) : 0;

    const financials = this.buildFinancials(raffle.tickets || [], raffle.ticketPrice);

    const desiredNetGoal = toNumber(raffle.desiredNetGoal);
    const netProgressPercent =
      desiredNetGoal > 0
        ? Math.min(
            100,
            round2((financials.organizerNetCollected / desiredNetGoal) * 100),
          )
        : 0;

    const unlock = await this.getUnlockInfo(raffle.id, raffle.totalNumbers);

    return {
      raffleId: raffle.id,
      title: raffle.title,
      description: raffle.description,
      finalUserId: raffle.finalUserId,
      finalUser: raffle.finalUser
        ? {
            id: raffle.finalUser.id,
            firstName: raffle.finalUser.firstName,
            lastName: raffle.finalUser.lastName,
            fullName: `${raffle.finalUser.firstName} ${raffle.finalUser.lastName}`.trim(),
            email: raffle.finalUser.email,
            role: raffle.finalUser.role,
          }
        : null,
      organizerId: (raffle.creator as any)?.id || null,
      organizer: raffle.creator
        ? {
            id: raffle.creator.id,
            firstName: raffle.creator.firstName,
            lastName: raffle.creator.lastName,
            fullName: `${raffle.creator.firstName} ${raffle.creator.lastName}`.trim(),
            email: raffle.creator.email,
            role: raffle.creator.role,
          }
        : null,
      createdById: raffle.createdById,
      createdByRole: raffle.createdByRole,
      mode: raffle.mode,
      drawDate: raffle.drawDate,
      eventEndAt: raffle.eventEndAt,
      venueName: raffle.venueName,
      venueAddress: raffle.venueAddress,
      status: raffle.status,
      finishedAt: raffle.finishedAt,
      totalTickets: raffle.totalNumbers,

      soldCount,
      pendingCount,
      salesProgressPercent,

      netProgressPercent,
      ticketPrice: toNumber(raffle.ticketPrice),
      desiredNetGoal,
      estimatedGrossGoal: toNumber(raffle.estimatedGrossGoal),
      platformFeeRate: toNumber(raffle.platformFeeRate),
      estimatedMpFeeRate: toNumber(raffle.estimatedMpFeeRate),

      transferAlias: raffle.transferAlias || null,
      allowTransfer: raffle.allowTransfer ?? true,
      allowCash: raffle.allowCash ?? true,
      requireManualApproval: raffle.requireManualApproval ?? true,
      sendTicketsOnlyAfterApproval: raffle.sendTicketsOnlyAfterApproval ?? true,
      requirePerItemAttendeeData: raffle.requirePerItemAttendeeData ?? true,
      allowQuantitySelector: raffle.allowQuantitySelector ?? true,
      minPurchaseQuantity: raffle.minPurchaseQuantity ?? 1,
      maxPurchaseQuantity: raffle.maxPurchaseQuantity ?? 10,
      showRemainingCapacity: raffle.showRemainingCapacity ?? true,
      allowQrValidation: raffle.allowQrValidation ?? true,
      requireBuyerEmail: raffle.requireBuyerEmail ?? false,

      coverImageBase64: raffle.coverImageBase64 || null,
      themeName: raffle.themeName || 'classic',
      themePrimaryColor: raffle.themePrimaryColor || '#fff159',
      themeSecondaryColor: raffle.themeSecondaryColor || '#3483fa',
      themeAccentColor: raffle.themeAccentColor || '#00a650',
      themeTextColor: raffle.themeTextColor || '#0f172a',
      themeCardColor: raffle.themeCardColor || '#ffffff',

      prizes: raffle.prizes || [],

      seats: (raffle.seats || []).map((seat) => ({
        id: seat.id,
        label: seat.label,
        sectionLabel: seat.sectionLabel,
        tableLabel: seat.tableLabel,
        x: Number(seat.x),
        y: Number(seat.y),
        width: Number(seat.width),
        height: Number(seat.height),
        rotation: Number(seat.rotation),
        priceOverride:
          seat.priceOverride !== null ? Number(seat.priceOverride) : null,
        status: seat.status,
        isActive: seat.isActive,
      })),

      sellers: (raffle.sellers || []).map((s) => ({
        id: s.id,
        commissionPercent: s.commissionPercent,
        isActive: s.isActive,
        shareSlug: s.shareSlug,
        label: s.label,
        notes: s.notes,
        seller: s.seller
          ? {
              id: s.seller.id,
              firstName: s.seller.firstName,
              lastName: s.seller.lastName,
              fullName: `${s.seller.firstName} ${s.seller.lastName}`.trim(),
              email: s.seller.email,
            }
          : null,
        createdAt: s.createdAt,
      })),

      doorUsers: (raffle.doors || []).map((d) => ({
        id: d.id,
        isActive: d.isActive,
        label: d.label,
        notes: d.notes,
        doorUser: d.doorUser
          ? {
              id: d.doorUser.id,
              firstName: d.doorUser.firstName,
              lastName: d.doorUser.lastName,
              fullName: `${d.doorUser.firstName} ${d.doorUser.lastName}`.trim(),
              email: d.doorUser.email,
            }
          : null,
        createdAt: d.createdAt,
      })),

      financials,
      unlock,
    };
  }

  async getPublicRaffle(id: string) {
    const raffle = await this.raffleRepo.findOne({
      where: { id },
      relations: [
        'prizes',
        'tickets',
        'tickets.seat',
        'sellers',
        'sellers.seller',
        'seats',
      ],
    });

    if (!raffle) {
      throw new NotFoundException('No existe');
    }

    const prizesSafe = [...(raffle.prizes || [])]
      .sort((a, b) => {
        const ao = a.drawOrder ?? 9999;
        const bo = b.drawOrder ?? 9999;
        return ao - bo;
      })
      .map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        youtubeLink: p.youtubeLink,
        imageBase64: p.imageBase64,
        drawOrder: p.drawOrder,
        winningTicketId: p.winningTicketId,
        winningTicketNumber: p.winningTicketNumber,
        winnerName: p.winnerName,
        winnerPhone: null,
      }));

    const ticketsSafe = (raffle.tickets || [])
      .slice()
      .sort((a, b) => a.number.localeCompare(b.number))
      .map((t) => ({
        id: t.id,
        number: t.number,
        status: t.status,
        seatId: (t as any).seat?.id || null,
      }));

    const sellersSafe = (raffle.sellers || []).map((s) => ({
      id: s.id,
      commissionPercent: s.commissionPercent,
      isActive: s.isActive,
      shareSlug: s.shareSlug,
      label: s.label,
      seller: s.seller
        ? {
            id: s.seller.id,
            fullName: `${s.seller.firstName} ${s.seller.lastName}`.trim(),
          }
        : null,
    }));

    const seatTicketMap = new Map<string, Ticket>();
    for (const ticket of raffle.tickets || []) {
      const seatId = (ticket as any).seat?.id;
      if (seatId) {
        seatTicketMap.set(seatId, ticket);
      }
    }

    const seatsSafe = (raffle.seats || []).map((seat) => {
      const linkedTicket = seatTicketMap.get(seat.id);

      return {
        id: seat.id,
        label: seat.label,
        sectionLabel: seat.sectionLabel,
        tableLabel: seat.tableLabel,
        x: Number(seat.x),
        y: Number(seat.y),
        width: Number(seat.width),
        height: Number(seat.height),
        rotation: Number(seat.rotation),
        priceOverride:
          seat.priceOverride !== null ? Number(seat.priceOverride) : null,
        status: linkedTicket?.status || seat.status,
        isActive: seat.isActive,
        ticketId: linkedTicket?.id || null,
        ticketNumber: linkedTicket?.number || null,
      };
    });

    return {
      id: raffle.id,
      title: raffle.title,
      description: raffle.description,
      mode: raffle.mode,
      ticketPrice: raffle.ticketPrice,
      totalNumbers: raffle.totalNumbers,
      minDrawPercent: raffle.minDrawPercent,
      drawDate: raffle.drawDate,
      eventEndAt: raffle.eventEndAt,
      venueName: raffle.venueName,
      venueAddress: raffle.venueAddress,
      status: raffle.status,
      finishedAt: raffle.finishedAt,

      transferAlias: raffle.allowTransfer ? raffle.transferAlias : null,
      allowTransfer: raffle.allowTransfer ?? true,
      allowCash: raffle.allowCash ?? true,
      requireManualApproval: raffle.requireManualApproval ?? true,
      sendTicketsOnlyAfterApproval: raffle.sendTicketsOnlyAfterApproval ?? true,
      requirePerItemAttendeeData: raffle.requirePerItemAttendeeData ?? true,
      allowQuantitySelector: raffle.allowQuantitySelector ?? true,
      minPurchaseQuantity: raffle.minPurchaseQuantity ?? 1,
      maxPurchaseQuantity: raffle.maxPurchaseQuantity ?? 10,
      showRemainingCapacity: raffle.showRemainingCapacity ?? true,
      allowQrValidation: raffle.allowQrValidation ?? true,
      requireBuyerEmail: raffle.requireBuyerEmail ?? false,

      coverImageBase64: raffle.coverImageBase64,
      themeName: raffle.themeName,
      themePrimaryColor: raffle.themePrimaryColor,
      themeSecondaryColor: raffle.themeSecondaryColor,
      themeAccentColor: raffle.themeAccentColor,
      themeTextColor: raffle.themeTextColor,
      themeCardColor: raffle.themeCardColor,

      prizes: prizesSafe,
      tickets: ticketsSafe,
      sellers: sellersSafe,
      seats: seatsSafe,
      createdAt: raffle.createdAt,
    };
  }

  // =========================
  // NUEVO: PERSONAL DE PUERTA
  // =========================

  async createDoorStaff(
    raffleId: string,
    creatorId: string,
    actorRole: UserRole,
    data: CreateDoorStaffDto,
  ) {
    if (actorRole !== 'creator') {
      throw new ForbiddenException('Solo el organizador puede crear personal de puerta');
    }

    const raffle = await this.raffleRepo.findOne({
      where: { id: raffleId, creator: { id: creatorId } },
      relations: ['doors', 'doors.doorUser'],
    });

    if (!raffle) {
      throw new NotFoundException('Evento no encontrado');
    }

    const email = data.email.trim().toLowerCase();
    const firstName = data.firstName.trim();
    const lastName = data.lastName.trim();
    const password = data.password.trim();

    if (password.length < 8) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres');
    }

    let doorUser = await this.userRepo.findOne({
      where: { email },
    });

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      let createdNow = false;

      if (!doorUser) {
        const passwordHash = await bcrypt.hash(password, 10);

        doorUser = qr.manager.create(User, {
          firstName,
          lastName,
          email,
          passwordHash,
          googleId: null,
          role: 'door' as any,
          mp_access_token: null,
          mp_refresh_token: null,
          mp_user_id: null,
          recoveryCodeHash: null,
          recoveryCodeGeneratedAt: null,
        });

        doorUser = await qr.manager.save(doorUser);
        createdNow = true;
      } else {
        if (doorUser.role !== 'door') {
          throw new BadRequestException(
            'Ese correo ya existe y pertenece a un usuario que no es personal de puerta',
          );
        }

        doorUser.firstName = firstName;
        doorUser.lastName = lastName;
        await qr.manager.save(doorUser);
      }

      const existingAssignment = await qr.manager.findOne(DoorAssignment, {
        where: {
          raffle: { id: raffle.id } as any,
          doorUser: { id: doorUser.id } as any,
        },
        relations: ['doorUser', 'raffle'],
      });

      if (existingAssignment) {
        throw new BadRequestException('Ese usuario ya está asignado a la puerta de este evento');
      }

      const assignment = qr.manager.create(DoorAssignment, {
        isActive: true,
        label: data.label?.trim() || data.whatsapp?.trim() || null,
        notes: data.notes?.trim() || null,
        doorUser,
        raffle,
      });

      const savedAssignment = await qr.manager.save(assignment);

      await qr.commitTransaction();

      return {
        message: createdNow
          ? 'Personal de puerta creado y asignado correctamente'
          : 'Personal de puerta asignado correctamente',
        staff: {
          id: doorUser.id,
          firstName: doorUser.firstName,
          lastName: doorUser.lastName,
          fullName: `${doorUser.firstName} ${doorUser.lastName}`.trim(),
          email: doorUser.email,
          role: doorUser.role,
          whatsapp: data.whatsapp?.trim() || null,
        },
        assignment: {
          id: savedAssignment.id,
          isActive: savedAssignment.isActive,
          label: savedAssignment.label,
          notes: savedAssignment.notes,
          createdAt: savedAssignment.createdAt,
        },
      };
    } catch (error) {
      await qr.rollbackTransaction();
      throw error;
    } finally {
      await qr.release();
    }
  }

  async getDoorStaff(
    raffleId: string,
    creatorId: string,
    actorRole: UserRole,
  ) {
    if (actorRole !== 'creator') {
      throw new ForbiddenException('Solo el organizador puede ver el personal de puerta');
    }

    const raffle = await this.raffleRepo.findOne({
      where: { id: raffleId, creator: { id: creatorId } },
    });

    if (!raffle) {
      throw new NotFoundException('Evento no encontrado');
    }

    const assignments = await this.doorAssignRepo.find({
      where: { raffle: { id: raffleId } },
      relations: ['doorUser'],
      order: { createdAt: 'DESC' },
    });

    return assignments.map((assignment) => ({
      id: assignment.id,
      isActive: assignment.isActive,
      label: assignment.label,
      notes: assignment.notes,
      createdAt: assignment.createdAt,
      doorUser: assignment.doorUser
        ? {
            id: assignment.doorUser.id,
            firstName: assignment.doorUser.firstName,
            lastName: assignment.doorUser.lastName,
            fullName: `${assignment.doorUser.firstName} ${assignment.doorUser.lastName}`.trim(),
            email: assignment.doorUser.email,
            role: assignment.doorUser.role,
          }
        : null,
    }));
  }

  private buildFinancials(tickets: Ticket[], ticketPriceRaw: string) {
    const sold = tickets.filter((t) => t.status === 'sold');
    const ticketPrice = toNumber(ticketPriceRaw);

    const grossCollected = round2(sold.length * ticketPrice);

    return {
      grossCollected,
      mpFeeCollected: 0,
      platformFeeCollected: 0,
      organizerNetCollected: grossCollected,
    };
  }

  async getShareHtml(id: string, sellerId?: string) {
    const raffle = await this.getPublicRaffle(id);
    const firstPrize = this.getFirstPrizeForShare(raffle);

    const title = this.normalizeText(raffle.title) || 'Pase Libre';
    const description = this.buildOgDescription(raffle, firstPrize);

    const shareUrl = this.buildSharePageUrl(id, sellerId);
    const redirectUrl = this.buildFrontendRaffleUrl(id, sellerId);
    const imageUrl = this.buildShareImageUrl(id);

    const safeTitle = this.escapeHtml(title);
    const safeDescription = this.escapeHtml(description);
    const safeShareUrl = this.escapeHtml(shareUrl);
    const safeImageUrl = this.escapeHtml(imageUrl);
    const safeRedirectUrl = this.escapeHtml(redirectUrl);

    return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${safeDescription}" />
    <meta name="robots" content="noindex,nofollow" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Pase Libre" />
    <meta property="og:title" content="${safeTitle}" />
    <meta property="og:description" content="${safeDescription}" />
    <meta property="og:image" content="${safeImageUrl}" />
    <meta property="og:url" content="${safeShareUrl}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${safeTitle}" />
    <meta name="twitter:description" content="${safeDescription}" />
    <meta name="twitter:image" content="${safeImageUrl}" />
    <meta http-equiv="refresh" content="0; url=${safeRedirectUrl}" />
    <script>
      window.location.replace(${JSON.stringify(redirectUrl)});
    </script>
  </head>
  <body style="font-family: Arial, sans-serif; padding: 24px;">
    <p>Redirigiendo al evento...</p>
    <p><a href="${safeRedirectUrl}">Si no redirige automáticamente, hacé click acá</a>.</p>
  </body>
</html>`;
  }

  async getShareImage(id: string): Promise<ShareImageResult> {
    const raffle = await this.getPublicRaffle(id);

    if (raffle.coverImageBase64) {
      const parsedCover = this.parseImageBase64(raffle.coverImageBase64);
      if (parsedCover) {
        return {
          kind: 'binary',
          contentType: parsedCover.contentType,
          buffer: parsedCover.buffer,
        };
      }
    }

    const prizeWithImage = raffle.prizes?.find((p: any) => !!p.imageBase64);

    if (prizeWithImage?.imageBase64) {
      const parsedPrize = this.parseImageBase64(prizeWithImage.imageBase64);
      if (parsedPrize) {
        return {
          kind: 'binary',
          contentType: parsedPrize.contentType,
          buffer: parsedPrize.buffer,
        };
      }
    }

    const fallbackUrl = (
      this.configService.get<string>('DEFAULT_OG_IMAGE_URL') || ''
    ).trim();

    if (fallbackUrl) {
      return { kind: 'redirect', url: fallbackUrl };
    }

    const svg = this.buildFallbackOgSvg(raffle);

    return {
      kind: 'binary',
      contentType: 'image/svg+xml; charset=utf-8',
      buffer: Buffer.from(svg, 'utf8'),
    };
  }

  private getFirstPrizeForShare(raffle: any) {
    if (!raffle.prizes?.length) return null;
    return raffle.prizes.find((p: any) => !!p.imageBase64) || raffle.prizes[0];
  }

  private buildPaymentMethodsText(raffle: any) {
    const parts: string[] = [];
    if (raffle.allowTransfer) parts.push('transferencia');
    if (raffle.allowCash) parts.push('efectivo');

    if (!parts.length) return 'método a confirmar con el organizador';
    if (parts.length === 1) return parts[0];
    return `${parts[0]} o ${parts[1]}`;
  }

  private buildOgDescription(raffle: any, firstPrize: any | null) {
    const pieces: string[] = [];

    if (raffle.status === 'finished' && raffle.finishedAt) {
      pieces.push(
        `Evento finalizado el ${new Date(raffle.finishedAt).toLocaleString(
          'es-AR',
        )}.`,
      );
    }

    if (firstPrize?.title) {
      pieces.push(`Destacado: ${this.normalizeText(firstPrize.title)}.`);
    }

    const baseDescription =
      this.normalizeText(firstPrize?.description) ||
      this.normalizeText(raffle.description);

    if (baseDescription) {
      pieces.push(baseDescription);
    }

    if (raffle.ticketPrice) {
      pieces.push(
        `Valor por entrada/número: $${Number(raffle.ticketPrice).toLocaleString('es-AR')}.`,
      );
    }

    pieces.push(`Pago por ${this.buildPaymentMethodsText(raffle)}.`);

    return this.truncate(pieces.join(' '), 190);
  }

  private buildFrontendRaffleUrl(id: string, sellerId?: string) {
    const base = this.getFrontendBaseUrl();
    const url = new URL(`${base}/raffle/${id}`);

    if (sellerId) {
      url.searchParams.set('vendedor', sellerId);
    }

    return url.toString();
  }

  private buildSharePageUrl(id: string, sellerId?: string) {
    const base = this.getApiBaseUrl();
    const url = new URL(`${base}/api/raffles/share/${id}`);

    if (sellerId) {
      url.searchParams.set('vendedor', sellerId);
    }

    return url.toString();
  }

  private buildShareImageUrl(id: string) {
    const base = this.getApiBaseUrl();
    return `${base}/api/raffles/share/${id}/image`;
  }

  private getFrontendBaseUrl() {
    return (
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173'
    ).replace(/\/+$/, '');
  }

  private getApiBaseUrl() {
    return (
      this.configService.get<string>('API_BASE_URL') || 'http://localhost:3000'
    ).replace(/\/+$/, '');
  }

  private normalizeText(value?: string | null) {
    return (value || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private truncate(value: string, max: number) {
    if (value.length <= max) return value;
    return `${value.slice(0, max - 1).trimEnd()}…`;
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private parseImageBase64(raw: string) {
    try {
      const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

      if (match) {
        const [, contentType, base64Data] = match;
        return {
          contentType,
          buffer: Buffer.from(base64Data, 'base64'),
        };
      }

      return {
        contentType: 'image/jpeg',
        buffer: Buffer.from(raw, 'base64'),
      };
    } catch (error) {
      console.error('No se pudo parsear imageBase64 para OG image:', error);
      return null;
    }
  }

  private buildFallbackOgSvg(raffle: any) {
    const firstPrize = raffle.prizes?.[0];

    const title = this.escapeForSvg(
      this.truncate(this.normalizeText(raffle.title) || 'Pase Libre', 42),
    );

    const prizeTitle = this.escapeForSvg(
      this.truncate(
        this.normalizeText(firstPrize?.title) || 'Organizá y compartí tu evento',
        50,
      ),
    );

    const price = Number(raffle.ticketPrice || 0).toLocaleString('es-AR');

    const primary = raffle.themePrimaryColor || '#fff159';
    const secondary = raffle.themeSecondaryColor || '#3483fa';
    const accent = raffle.themeAccentColor || '#00a650';
    const text = raffle.themeTextColor || '#111827';
    const card = raffle.themeCardColor || '#ffffff';

    const subtitle =
      raffle.status === 'finished'
        ? 'Evento finalizado'
        : `Pago por ${this.buildPaymentMethodsText(raffle)}`;

    return `
<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">
      <stop stop-color="${primary}"/>
      <stop offset="1" stop-color="${secondary}"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="44" y="44" width="1112" height="542" rx="34" fill="${card}"/>

  <rect x="76" y="76" width="220" height="56" rx="20" fill="${secondary}"/>
  <text x="186" y="113" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="white">Pase Libre</text>

  <text x="76" y="200" font-family="Arial, sans-serif" font-size="56" font-weight="800" fill="${text}">${title}</text>
  <text x="76" y="276" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="${text}">${prizeTitle}</text>

  <rect x="76" y="340" width="420" height="86" rx="24" fill="${primary}"/>
  <text x="106" y="390" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="${text}">Valor por entrada</text>
  <text x="106" y="420" font-family="Arial, sans-serif" font-size="30" font-weight="800" fill="${text}">$${price}</text>

  <rect x="76" y="470" width="700" height="62" rx="20" fill="${accent}"/>
  <text x="106" y="510" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="white">${this.escapeForSvg(
    subtitle,
  )}</text>
</svg>`;
  }

  private escapeForSvg(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private async getUnlockInfo(raffleId: string, totalNumbers: number) {
    const confirmedNumbers = await this.countConfirmedNumbers(raffleId);

    const paidUnlock = await this.accessPaymentRepo.findOne({
      where: {
        raffle: { id: raffleId },
        status: RaffleAccessPaymentStatus.PAID,
      },
      order: { createdAt: 'DESC' },
    });

    const freeLimit = 20;
    const requiresUnlockPayment = confirmedNumbers >= freeLimit && !paidUnlock;

    return {
      freeLimit,
      confirmedNumbers,
      unlocked: !!paidUnlock,
      requiresUnlockPayment,
      totalNumbers,
      latestPaidUnlock: paidUnlock
        ? {
            id: paidUnlock.id,
            amount: Number(paidUnlock.amount),
            status: paidUnlock.status,
            paidAt: paidUnlock.paidAt,
          }
        : null,
    };
  }

  private async countConfirmedNumbers(raffleId: string) {
    return this.purchaseItemRepo
      .createQueryBuilder('item')
      .innerJoin('item.purchase', 'purchase')
      .innerJoin('purchase.raffle', 'raffle')
      .where('raffle.id = :raffleId', { raffleId })
      .andWhere('purchase.status IN (:...statuses)', {
        statuses: [
          RafflePurchaseStatus.APPROVED,
          RafflePurchaseStatus.AUTO_APPROVED,
        ],
      })
      .getCount();
  }
}
