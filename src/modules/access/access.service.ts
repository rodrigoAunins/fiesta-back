import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { Raffle } from '../../entities/raffle.entity';
import { User } from '../../entities/user.entity';
import { DoorAssignment } from '../../entities/door-assignment.entity';
import { RafflePurchase } from '../../entities/raffle-purchase.entity';
import { RafflePurchaseItem } from '../../entities/raffle-purchase-item.entity';

import { RafflePurchaseStatus } from '../../common/enums/raffle-purchase-status.enum';
import { ValidateQrDto } from './dto/validate-qr.dto';
import { ValidateAccessCodeDto } from './dto/validate-access-code.dto';

type UserRole = 'creator' | 'seller' | 'door';

@Injectable()
export class AccessService {
  constructor(
    @InjectRepository(Raffle)
    private readonly raffleRepo: Repository<Raffle>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(DoorAssignment)
    private readonly doorAssignmentRepo: Repository<DoorAssignment>,

    @InjectRepository(RafflePurchase)
    private readonly purchaseRepo: Repository<RafflePurchase>,

    @InjectRepository(RafflePurchaseItem)
    private readonly purchaseItemRepo: Repository<RafflePurchaseItem>,
  ) {}

  async validateQr(userId: string, role: UserRole, dto: ValidateQrDto) {
    const qrToken = String(dto.qrToken || '').trim();

    if (!qrToken) {
      throw new BadRequestException('No recibimos un QR válido para verificar.');
    }

    return this.validateAndOptionallyCheckIn(userId, role, {
      raffleId: dto.raffleId,
      qrToken,
      consumeEntry: dto.consumeEntry ?? true,
    });
  }

  async validateCode(userId: string, role: UserRole, dto: ValidateAccessCodeDto) {
    const accessCode = String(dto.accessCode || '').trim().toUpperCase();

    if (!accessCode) {
      throw new BadRequestException('No recibimos un código válido para verificar.');
    }

    return this.validateAndOptionallyCheckIn(userId, role, {
      raffleId: dto.raffleId,
      accessCode,
      consumeEntry: dto.consumeEntry ?? true,
    });
  }

  async getAccessibleRaffles(userId: string, role: UserRole) {
    if (role === 'creator') {
      const raffles = await this.raffleRepo.find({
        where: { creator: { id: userId } },
        order: { createdAt: 'DESC' },
      });

      return raffles.map((raffle) => ({
        id: raffle.id,
        title: raffle.title,
        drawDate: raffle.drawDate,
        status: raffle.status,
        mode: (raffle as any).mode || null,
        venueName: (raffle as any).venueName || null,
        venueAddress: (raffle as any).venueAddress || null,
        themeName: raffle.themeName,
        themePrimaryColor: raffle.themePrimaryColor,
        themeSecondaryColor: raffle.themeSecondaryColor,
        themeAccentColor: raffle.themeAccentColor,
      }));
    }

    if (role === 'door') {
      const assignments = await this.doorAssignmentRepo.find({
        where: {
          doorUser: { id: userId },
          isActive: true,
        },
        relations: ['raffle'],
        order: { createdAt: 'DESC' },
      });

      return assignments.map((assignment) => ({
        assignmentId: assignment.id,
        label: assignment.label,
        notes: assignment.notes,
        raffle: assignment.raffle
          ? {
              id: assignment.raffle.id,
              title: assignment.raffle.title,
              drawDate: assignment.raffle.drawDate,
              status: assignment.raffle.status,
              mode: (assignment.raffle as any).mode || null,
              venueName: (assignment.raffle as any).venueName || null,
              venueAddress: (assignment.raffle as any).venueAddress || null,
              themeName: assignment.raffle.themeName,
              themePrimaryColor: assignment.raffle.themePrimaryColor,
              themeSecondaryColor: assignment.raffle.themeSecondaryColor,
              themeAccentColor: assignment.raffle.themeAccentColor,
            }
          : null,
      }));
    }

    throw new ForbiddenException('Tu usuario no tiene acceso al control de ingresos.');
  }

  async getRecentCheckins(userId: string, role: UserRole, raffleId: string) {
    await this.assertCanValidateThisRaffle(userId, role, raffleId);

    const items = await this.purchaseItemRepo.find({
      where: {
        purchase: { raffle: { id: raffleId } },
        checkedInAt: IsNull() as any,
      },
      relations: [
        'purchase',
        'purchase.raffle',
        'ticket',
        'seat',
        'checkedInBy',
      ],
      order: { createdAt: 'DESC' },
      take: 1,
    });

    const checkedInItems = await this.purchaseItemRepo
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.purchase', 'purchase')
      .leftJoinAndSelect('purchase.raffle', 'raffle')
      .leftJoinAndSelect('item.ticket', 'ticket')
      .leftJoinAndSelect('item.seat', 'seat')
      .leftJoinAndSelect('item.checkedInBy', 'checkedInBy')
      .where('raffle.id = :raffleId', { raffleId })
      .andWhere('item.checkedInAt IS NOT NULL')
      .orderBy('item.checkedInAt', 'DESC')
      .take(50)
      .getMany();

    return checkedInItems.map((item) => ({
      itemId: item.id,
      checkedInAt: item.checkedInAt,
      accessCode: item.accessCode,
      ticketNumber: item.ticketNumber,
      attendeeName: item.attendeeName,
      attendeePhone: item.attendeePhone,
      attendeeEmail: item.attendeeEmail,
      seatLabel: item.seatLabel,
      sectionLabel: item.sectionLabel,
      tableLabel: item.tableLabel,
      checkedInBy: item.checkedInBy
        ? {
            id: item.checkedInBy.id,
            firstName: item.checkedInBy.firstName,
            lastName: item.checkedInBy.lastName,
            fullName: `${item.checkedInBy.firstName} ${item.checkedInBy.lastName}`.trim(),
            email: item.checkedInBy.email,
          }
        : null,
      purchase: item.purchase
        ? {
            id: item.purchase.id,
            buyerName: item.purchase.buyerName,
            buyerPhone: item.purchase.buyerPhone,
            buyerEmail: item.purchase.buyerEmail,
            paymentMethod: item.purchase.paymentMethod,
            status: item.purchase.status,
          }
        : null,
    }));
  }

  private async validateAndOptionallyCheckIn(
    userId: string,
    role: UserRole,
    params: {
      raffleId?: string;
      qrToken?: string;
      accessCode?: string;
      consumeEntry: boolean;
    },
  ) {
    const item = await this.findItemByAccess(params);

    if (!item) {
      return {
        ok: false,
        allowEntry: false,
        status: 'not_found',
        message: 'No encontramos un acceso válido con esos datos.',
      };
    }

    const raffleId = item.purchase?.raffle?.id;

    if (!raffleId) {
      throw new NotFoundException('No pudimos vincular este acceso con un evento.');
    }

    if (params.raffleId && params.raffleId !== raffleId) {
      return {
        ok: false,
        allowEntry: false,
        status: 'wrong_event',
        message: 'Este acceso pertenece a otro evento.',
        raffle: this.mapRaffle(item.purchase.raffle),
        purchase: this.mapPurchase(item.purchase),
        item: this.mapItem(item),
      };
    }

    await this.assertCanValidateThisRaffle(userId, role, raffleId);

    const purchaseStatus = String(item.purchase?.status || '');

    if (item.checkedInAt) {
      return {
        ok: false,
        allowEntry: false,
        status: 'already_used',
        message: 'Este acceso ya fue utilizado anteriormente.',
        raffle: this.mapRaffle(item.purchase.raffle),
        purchase: this.mapPurchase(item.purchase),
        item: this.mapItem(item),
      };
    }

    if (
      purchaseStatus === RafflePurchaseStatus.REJECTED ||
      purchaseStatus === RafflePurchaseStatus.CANCELLED ||
      purchaseStatus === RafflePurchaseStatus.EXPIRED
    ) {
      return {
        ok: false,
        allowEntry: false,
        status: 'rejected',
        message: 'Este acceso no está habilitado para ingresar.',
        raffle: this.mapRaffle(item.purchase.raffle),
        purchase: this.mapPurchase(item.purchase),
        item: this.mapItem(item),
      };
    }

    if (
      purchaseStatus !== RafflePurchaseStatus.APPROVED &&
      purchaseStatus !== RafflePurchaseStatus.AUTO_APPROVED
    ) {
      return {
        ok: false,
        allowEntry: false,
        status: 'pending',
        message: 'Este acceso todavía está pendiente de confirmación.',
        raffle: this.mapRaffle(item.purchase.raffle),
        purchase: this.mapPurchase(item.purchase),
        item: this.mapItem(item),
      };
    }

    if (params.consumeEntry) {
      item.checkedInAt = new Date();
      item.checkedInBy = { id: userId } as User;
      await this.purchaseItemRepo.save(item);
    }

    const refreshed = await this.purchaseItemRepo.findOne({
      where: { id: item.id },
      relations: [
        'purchase',
        'purchase.raffle',
        'ticket',
        'seat',
        'checkedInBy',
      ],
    });

    const finalItem = refreshed || item;

    return {
      ok: true,
      allowEntry: true,
      status: 'approved',
      message: params.consumeEntry
        ? 'Acceso válido. Ingreso registrado correctamente.'
        : 'Acceso válido. La persona puede ingresar.',
      raffle: this.mapRaffle(finalItem.purchase.raffle),
      purchase: this.mapPurchase(finalItem.purchase),
      item: this.mapItem(finalItem),
    };
  }

  private async findItemByAccess(params: {
    raffleId?: string;
    qrToken?: string;
    accessCode?: string;
    consumeEntry: boolean;
  }) {
    const qb = this.purchaseItemRepo
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.purchase', 'purchase')
      .leftJoinAndSelect('purchase.raffle', 'raffle')
      .leftJoinAndSelect('item.ticket', 'ticket')
      .leftJoinAndSelect('item.seat', 'seat')
      .leftJoinAndSelect('item.checkedInBy', 'checkedInBy');

    if (params.qrToken) {
      qb.where('item.qrToken = :qrToken', { qrToken: params.qrToken });
    } else if (params.accessCode) {
      qb.where('UPPER(item.accessCode) = UPPER(:accessCode)', {
        accessCode: params.accessCode,
      });
    } else {
      throw new BadRequestException('Falta el QR o el código para validar.');
    }

    return qb.getOne();
  }

  private async assertCanValidateThisRaffle(
    userId: string,
    role: UserRole,
    raffleId: string,
  ) {
    if (role === 'creator') {
      const raffle = await this.raffleRepo.findOne({
        where: { id: raffleId, creator: { id: userId } },
      });

      if (!raffle) {
        throw new ForbiddenException('No tenés permiso para validar ingresos en este evento.');
      }

      return;
    }

    if (role === 'door') {
      const assignment = await this.doorAssignmentRepo.findOne({
        where: {
          raffle: { id: raffleId },
          doorUser: { id: userId },
          isActive: true,
        },
        relations: ['raffle', 'doorUser'],
      });

      if (!assignment) {
        throw new ForbiddenException('No estás asignado al control de acceso de este evento.');
      }

      return;
    }

    throw new ForbiddenException('Tu usuario no tiene acceso al control de ingresos.');
  }

  private mapRaffle(raffle: Raffle | null | undefined) {
    if (!raffle) return null;

    return {
      id: raffle.id,
      title: raffle.title,
      drawDate: raffle.drawDate,
      status: raffle.status,
      venueName: (raffle as any).venueName || null,
      venueAddress: (raffle as any).venueAddress || null,
    };
  }

  private mapPurchase(purchase: RafflePurchase | null | undefined) {
    if (!purchase) return null;

    return {
      id: purchase.id,
      buyerName: purchase.buyerName,
      buyerPhone: purchase.buyerPhone,
      buyerEmail: purchase.buyerEmail,
      paymentMethod: purchase.paymentMethod,
      status: purchase.status,
      totalAmount: Number(purchase.totalAmount || 0),
      ticketCount: purchase.ticketCount,
      approvedAt: purchase.approvedAt,
      rejectedAt: purchase.rejectedAt,
      submittedAt: purchase.submittedAt,
    };
  }

  private mapItem(item: RafflePurchaseItem | null | undefined) {
    if (!item) return null;

    return {
      id: item.id,
      ticketNumber: item.ticketNumber,
      accessCode: item.accessCode,
      attendeeName: item.attendeeName,
      attendeePhone: item.attendeePhone,
      attendeeEmail: item.attendeeEmail,
      seatLabel: item.seatLabel,
      sectionLabel: item.sectionLabel,
      tableLabel: item.tableLabel,
      checkedInAt: item.checkedInAt,
      checkedInBy: item.checkedInBy
        ? {
            id: item.checkedInBy.id,
            firstName: item.checkedInBy.firstName,
            lastName: item.checkedInBy.lastName,
            fullName: `${item.checkedInBy.firstName} ${item.checkedInBy.lastName}`.trim(),
            email: item.checkedInBy.email,
          }
        : null,
    };
  }
}