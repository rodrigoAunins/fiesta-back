import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from '../../entities/user.entity';
import { Raffle } from '../../entities/raffle.entity';
import { SellerAssignment } from '../../entities/seller-assignment.entity';
import { RafflePurchase } from '../../entities/raffle-purchase.entity';

import {
  ensureStrongPassword,
  generateRecoveryCode,
  generateTemporaryPassword,
  hashSecret,
  normalizeEmail,
  normalizeName,
  sanitizeUser,
} from '../auth/auth.utils';
import { AssignSellerDto } from './dto/assign-seller.dto';

import { RafflePurchaseStatus } from '../../common/enums/raffle-purchase-status.enum';
import { UserRole } from '../../common/enums/user-role.enum';

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

@Injectable()
export class SellersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(Raffle)
    private readonly raffleRepo: Repository<Raffle>,

    @InjectRepository(SellerAssignment)
    private readonly assignmentRepo: Repository<SellerAssignment>,

    @InjectRepository(RafflePurchase)
    private readonly purchaseRepo: Repository<RafflePurchase>,
  ) {}

  private async buildUniqueShareSlug(
    raffleId: string,
    baseValue: string,
    ignoreAssignmentId?: string,
  ) {
    const base = slugify(baseValue) || 'rrpp';
    let candidate = base;
    let i = 1;

    while (true) {
      const existing = await this.assignmentRepo
        .createQueryBuilder('assignment')
        .where('assignment.raffleId = :raffleId', { raffleId })
        .andWhere('assignment.shareSlug = :shareSlug', { shareSlug: candidate })
        .andWhere(ignoreAssignmentId ? 'assignment.id != :ignoreId' : '1=1', {
          ignoreId: ignoreAssignmentId,
        })
        .getOne();

      if (!existing) {
        return candidate;
      }

      i += 1;
      candidate = `${base}-${i}`;
    }
  }

  private async getSellerStats(sellerId: string, raffleId: string) {
    const purchases = await this.purchaseRepo.find({
      where: {
        raffle: { id: raffleId },
        createdBySeller: { id: sellerId },
      },
      relations: ['raffle', 'createdBySeller'],
      order: { createdAt: 'DESC' },
    });

    let sold = 0;
    let pending = 0;
    let rejected = 0;
    let totalRevenue = 0;
    let pendingRevenue = 0;

    for (const purchase of purchases) {
      const count = Number(purchase.ticketCount || 0);
      const amount = Number(purchase.totalAmount || 0);

      if (
        purchase.status === RafflePurchaseStatus.APPROVED ||
        purchase.status === RafflePurchaseStatus.AUTO_APPROVED
      ) {
        sold += count;
        totalRevenue += amount;
        continue;
      }

      if (
        purchase.status === RafflePurchaseStatus.RESERVED ||
        purchase.status === RafflePurchaseStatus.PENDING_PROOF ||
        purchase.status === RafflePurchaseStatus.UNDER_REVIEW ||
        purchase.status === RafflePurchaseStatus.PENDING_CASH_CONFIRMATION
      ) {
        pending += count;
        pendingRevenue += amount;
        continue;
      }

      if (purchase.status === RafflePurchaseStatus.REJECTED) {
        rejected += count;
      }
    }

    return {
      sold,
      pending,
      rejected,
      totalRevenue: round2(totalRevenue),
      pendingRevenue: round2(pendingRevenue),
      operations: purchases.length,
    };
  }

  async assignSellerToRaffle(
    creatorId: string,
    raffleId: string,
    data: AssignSellerDto,
  ) {
    const raffle = await this.raffleRepo.findOne({
      where: { id: raffleId, creator: { id: creatorId } },
      relations: ['sellers', 'sellers.seller'],
    });

    if (!raffle) {
      throw new NotFoundException('Evento no encontrado');
    }

    const email = normalizeEmail(data.email);
    const firstName = normalizeName(data.firstName);
    const lastName = normalizeName(data.lastName);

    let seller = await this.userRepo
      .createQueryBuilder('user')
      .addSelect(['user.passwordHash', 'user.recoveryCodeHash'])
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .getOne();

    let temporaryPassword: string | null = null;
    let recoveryCode: string | null = null;
    let createdNow = false;

    if (!seller) {
      createdNow = true;

      temporaryPassword = data.password?.trim() || generateTemporaryPassword();

      if (!ensureStrongPassword(temporaryPassword)) {
        throw new BadRequestException(
          'La contraseña del RRPP debe tener al menos 8 caracteres, una mayúscula y un número',
        );
      }

      recoveryCode = generateRecoveryCode();

      const createdSeller = this.userRepo.create({
        firstName,
        lastName,
        email,
        passwordHash: await hashSecret(temporaryPassword),
        recoveryCodeHash: await hashSecret(recoveryCode),
        recoveryCodeGeneratedAt: new Date(),
        role: UserRole.SELLER,
      });

      seller = await this.userRepo.save(createdSeller);
    } else {
      if (seller.role !== UserRole.SELLER) {
        throw new BadRequestException(
          'Ese correo ya pertenece a una cuenta que no es RRPP',
        );
      }

      seller.firstName = firstName;
      seller.lastName = lastName;
      seller = await this.userRepo.save(seller);
    }

    const existingAssignment = await this.assignmentRepo.findOne({
      where: {
        raffle: { id: raffleId },
        seller: { id: seller.id },
      },
      relations: ['seller', 'raffle'],
    });

    const desiredSlug =
      data.shareSlug?.trim() ||
      `${firstName}-${lastName}` ||
      seller.email.split('@')[0];

    const uniqueShareSlug = await this.buildUniqueShareSlug(
      raffleId,
      desiredSlug,
      existingAssignment?.id,
    );

    let savedAssignment: SellerAssignment;

    if (existingAssignment) {
      existingAssignment.commissionPercent = Number(data.commissionPercent || 0);
      existingAssignment.isActive = true;
      existingAssignment.shareSlug = uniqueShareSlug;
      existingAssignment.label = data.label?.trim() || null;
      existingAssignment.notes = data.notes?.trim() || null;

      savedAssignment = await this.assignmentRepo.save(existingAssignment);
    } else {
      const assignment = this.assignmentRepo.create({
        commissionPercent: Number(data.commissionPercent || 0),
        isActive: true,
        shareSlug: uniqueShareSlug,
        label: data.label?.trim() || null,
        notes: data.notes?.trim() || null,
        seller,
        raffle,
      });

      savedAssignment = await this.assignmentRepo.save(assignment);
    }

    const stats = await this.getSellerStats(seller.id, raffleId);
    const earned = round2(
      stats.totalRevenue * (savedAssignment.commissionPercent / 100),
    );

    return {
      message: createdNow
        ? 'RRPP creado y asignado correctamente'
        : existingAssignment
          ? 'RRPP actualizado correctamente'
          : 'RRPP asignado correctamente',
      assignment: {
        id: savedAssignment.id,
        commissionPercent: savedAssignment.commissionPercent,
        isActive: savedAssignment.isActive,
        shareSlug: savedAssignment.shareSlug,
        label: savedAssignment.label,
        notes: savedAssignment.notes,
      },
      seller: sanitizeUser(seller),
      stats: {
        sold: stats.sold,
        pending: stats.pending,
        rejected: stats.rejected,
        totalRevenue: stats.totalRevenue,
        pendingRevenue: stats.pendingRevenue,
        earned,
        operations: stats.operations,
      },
      access: createdNow
        ? {
            email: seller.email,
            temporaryPassword,
            recoveryCode,
          }
        : null,
    };
  }

  async getSellerDashboard(sellerId: string, raffleId: string) {
    const assignment = await this.assignmentRepo.findOne({
      where: {
        seller: { id: sellerId },
        raffle: { id: raffleId },
      },
      relations: ['raffle', 'seller'],
    });

    if (!assignment) {
      throw new NotFoundException('No asignado a este evento');
    }

    const stats = await this.getSellerStats(sellerId, raffleId);
    const earned = round2(
      stats.totalRevenue * (assignment.commissionPercent / 100),
    );

    return {
      raffleId: assignment.raffle.id,
      raffleTitle: assignment.raffle.title,
      commissionPercent: assignment.commissionPercent,
      shareSlug: assignment.shareSlug,
      isActive: assignment.isActive,
      label: assignment.label,
      notes: assignment.notes,
      seller: sanitizeUser(assignment.seller),
      stats: {
        sold: stats.sold,
        pending: stats.pending,
        rejected: stats.rejected,
        earned,
        totalRevenue: stats.totalRevenue,
        pendingRevenue: stats.pendingRevenue,
        operations: stats.operations,
      },
    };
  }

  async getSellersForRaffle(creatorId: string, raffleId: string) {
    const raffle = await this.raffleRepo.findOne({
      where: { id: raffleId, creator: { id: creatorId } },
    });

    if (!raffle) {
      throw new NotFoundException('Evento no encontrado');
    }

    const assignments = await this.assignmentRepo.find({
      where: {
        raffle: { id: raffleId },
      },
      relations: ['seller', 'raffle'],
      order: { createdAt: 'DESC' },
    });

    return Promise.all(
      assignments.map(async (assignment) => {
        const stats = await this.getSellerStats(assignment.seller.id, raffleId);
        const earned = round2(
          stats.totalRevenue * (assignment.commissionPercent / 100),
        );

        return {
          assignmentId: assignment.id,
          isActive: assignment.isActive,
          commissionPercent: assignment.commissionPercent,
          shareSlug: assignment.shareSlug,
          label: assignment.label,
          notes: assignment.notes,
          sellerId: assignment.seller.id,
          fullName: `${assignment.seller.firstName} ${assignment.seller.lastName}`.trim(),
          firstName: assignment.seller.firstName,
          lastName: assignment.seller.lastName,
          email: assignment.seller.email,
          stats: {
            sold: stats.sold,
            pending: stats.pending,
            rejected: stats.rejected,
            earned,
            totalRevenue: stats.totalRevenue,
            pendingRevenue: stats.pendingRevenue,
            operations: stats.operations,
          },
        };
      }),
    );
  }
}