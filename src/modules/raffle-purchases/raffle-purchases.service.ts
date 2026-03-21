import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import * as QRCode from 'qrcode';
import { randomBytes } from 'crypto';

import { Raffle } from '../../entities/raffle.entity';
import { Ticket } from '../../entities/ticket.entity';
import { User } from '../../entities/user.entity';
import { RaffleSeat } from '../../entities/raffle-seat.entity';
import { RafflePurchase } from '../../entities/raffle-purchase.entity';
import { RafflePurchaseItem } from '../../entities/raffle-purchase-item.entity';
import { PaymentProof } from '../../entities/payment-proof.entity';
import { RaffleAccessPayment } from '../../entities/raffle-access-payment.entity';

import { PaymentMethod } from '../../common/enums/payment-method.enum';
import { RafflePurchaseStatus } from '../../common/enums/raffle-purchase-status.enum';
import { PaymentProofReviewStatus } from '../../common/enums/payment-proof-review-status.enum';
import { RaffleAccessPaymentStatus } from '../../common/enums/raffle-access-payment-status.enum';
import { RafflePurchaseItemStatus } from '../../common/enums/raffle-purchase-item-status.enum';

import { ReserveRafflePurchaseDto } from './dto/reserve-raffle-purchase.dto';
import { AttachPaymentProofDto } from './dto/attach-payment-proof.dto';
import { ApproveRafflePurchaseDto } from './dto/approve-raffle-purchase.dto';
import { RejectRafflePurchaseDto } from './dto/reject-raffle-purchase.dto';
import { ProofAnalysisService } from './proof-analysis.service';
import { RifaGateway } from '../websockets/rifa.gateway';

type NormalizedAttendee = {
  fullName: string;
  phone: string;
  email: string | null;
};

@Injectable()
export class RafflePurchasesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly proofAnalysisService: ProofAnalysisService,
    private readonly rifaGateway: RifaGateway,

    @InjectRepository(Raffle)
    private readonly raffleRepo: Repository<Raffle>,

    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(RaffleSeat)
    private readonly seatRepo: Repository<RaffleSeat>,

    @InjectRepository(RafflePurchase)
    private readonly purchaseRepo: Repository<RafflePurchase>,

    @InjectRepository(RafflePurchaseItem)
    private readonly purchaseItemRepo: Repository<RafflePurchaseItem>,

    @InjectRepository(PaymentProof)
    private readonly paymentProofRepo: Repository<PaymentProof>,

    @InjectRepository(RaffleAccessPayment)
    private readonly accessPaymentRepo: Repository<RaffleAccessPayment>,
  ) {}

  async reservePurchase(data: ReserveRafflePurchaseDto) {
    const raffle = await this.raffleRepo.findOne({
      where: { id: data.raffleId },
      relations: ['creator'],
    });

    if (!raffle) {
      throw new NotFoundException('Evento no encontrado');
    }

    await this.assertRaffleCanKeepSelling(raffle.id);

    const attendees = this.normalizeAttendees(data);
    const requestedQuantity = this.resolveRequestedQuantity(data, attendees.length);
    const normalizedAttendees = this.expandAttendees(attendees, requestedQuantity);

    const { tickets, seatsByTicketId } = await this.resolveTicketsForReservation(
      raffle.id,
      data,
      requestedQuantity,
    );

    if (tickets.length !== requestedQuantity) {
      throw new BadRequestException(
        'No pudimos resolver la cantidad exacta de accesos solicitados.',
      );
    }

    const seller =
      data.sellerId
        ? await this.userRepo.findOne({ where: { id: data.sellerId } })
        : null;

    const ticketPrice = this.toNumber(raffle.ticketPrice);
    const totalAmount = this.round2(ticketPrice * tickets.length);
    const isFree = ticketPrice <= 0;

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.getReservationMinutes() * 60 * 1000,
    );

    const initialStatus = isFree
      ? RafflePurchaseStatus.AUTO_APPROVED
      : data.paymentMethod === PaymentMethod.CASH
        ? RafflePurchaseStatus.PENDING_CASH_CONFIRMATION
        : RafflePurchaseStatus.RESERVED;

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const buyer = normalizedAttendees[0];

      const purchase = qr.manager.create(RafflePurchase, {
        raffle: { id: raffle.id },
        buyerName: buyer.fullName,
        buyerPhone: buyer.phone,
        buyerEmail: buyer.email,
        paymentMethod: data.paymentMethod,
        status: initialStatus,
        totalAmount: totalAmount.toFixed(2),
        ticketCount: tickets.length,
        reservedAt: now,
        expiresAt:
          isFree || data.paymentMethod === PaymentMethod.CASH ? null : expiresAt,
        submittedAt: isFree ? now : null,
        reviewedAt: isFree ? now : null,
        approvedAt: isFree ? now : null,
        rejectedAt: null,
        autoApproved: isFree,
        reviewNotes: isFree ? 'Aprobado automáticamente por acceso gratuito' : null,
        rejectionReason: null,
        createdBySeller: seller ? ({ id: seller.id } as User) : null,
        approvedBy: null,
      });

      const savedPurchase = await qr.manager.save(purchase);

      const items: RafflePurchaseItem[] = [];

      for (let index = 0; index < tickets.length; index++) {
        const ticket = tickets[index];
        const attendee = normalizedAttendees[index];
        const seat = seatsByTicketId.get(ticket.id) || null;
        const accessCode = this.generateAccessCode();
        const qrToken = this.generateQrToken();

        const item = qr.manager.create(RafflePurchaseItem, {
          purchase: savedPurchase,
          ticket: { id: ticket.id } as Ticket,
          seat: seat ? ({ id: seat.id } as RaffleSeat) : null,
          ticketNumber: ticket.number,
          publicLabel: seat?.label || ticket.number,
          unitPrice: ticketPrice.toFixed(2),

          attendeeName: attendee.fullName,
          attendeePhone: attendee.phone,
          attendeeEmail: attendee.email,

          seatLabel: seat?.label || null,
          sectionLabel: seat?.sectionLabel || null,
          tableLabel: seat?.tableLabel || null,

          accessCode,
          qrToken,

          status: isFree
            ? RafflePurchaseItemStatus.APPROVED
            : RafflePurchaseItemStatus.RESERVED,

          approvedAt: isFree ? now : null,
          rejectedAt: null,
          checkedInAt: null,
          checkedInBy: null,
        });

        items.push(item);

        ticket.buyerName = attendee.fullName;
        ticket.buyerPhone = attendee.phone;
        ticket.buyerEmail = attendee.email;

        if (isFree) {
          ticket.status = 'sold';
          ticket.lockedAt = null;
          ticket.approvedAt = now;
        } else {
          ticket.status = 'pending';
          ticket.lockedAt = now;
          ticket.approvedAt = null;
        }
      }

      await qr.manager.save(items);
      await qr.manager.save(tickets);

      await qr.commitTransaction();

      for (const ticket of tickets) {
        this.rifaGateway.server.emit(`raffle-${raffle.id}-update`, {
          number: ticket.number,
          status: ticket.status,
        });
      }

      this.rifaGateway.server.emit(`raffle-${raffle.id}-purchase-update`, {
        purchaseId: savedPurchase.id,
        status: savedPurchase.status,
      });

      return this.getPurchaseById(savedPurchase.id);
    } catch (error) {
      await qr.rollbackTransaction();
      throw error;
    } finally {
      await qr.release();
    }
  }

async attachProof(purchaseId: string, data: AttachPaymentProofDto) {
  const purchase = await this.purchaseRepo.findOne({
    where: { id: purchaseId },
    relations: ['raffle', 'raffle.creator', 'items', 'items.ticket'],
  });

  if (!purchase) {
    throw new NotFoundException('Compra no encontrada');
  }

  if (purchase.paymentMethod !== PaymentMethod.TRANSFER) {
    throw new BadRequestException(
      'Solo las compras por transferencia aceptan comprobante',
    );
  }

  if (
    [
      RafflePurchaseStatus.APPROVED,
      RafflePurchaseStatus.AUTO_APPROVED,
      RafflePurchaseStatus.REJECTED,
      RafflePurchaseStatus.EXPIRED,
      RafflePurchaseStatus.CANCELLED,
    ].includes(purchase.status)
  ) {
    throw new BadRequestException('Esta compra ya no admite cambios');
  }

  if (data.fileBase64) {
    const cleanBase64 = data.fileBase64.replace(/^data:(.*?);base64,/, '');
    const sizeInBytes = Buffer.byteLength(cleanBase64, 'base64');
    const maxSizeInBytes = 150 * 1024;

    if (sizeInBytes > maxSizeInBytes) {
      const sizeInKB = (sizeInBytes / 1024).toFixed(2);
      throw new BadRequestException(
        `El archivo supera el límite permitido (Máximo: 150 KB, Recibido: ${sizeInKB} KB).`,
      );
    }
  }

  const expectedAlias =
    ((purchase.raffle as any)?.transferAlias ||
      (purchase.raffle as any)?.paymentAlias ||
      (purchase.raffle as any)?.alias ||
      '') as string;

  const analysis = this.proofAnalysisService.analyze({
    rawText: data.rawExtractedText || '',
    buyerName: purchase.buyerName,
    expectedAmount: this.toNumber(purchase.totalAmount),
    expectedAlias,
  });

  const qr = this.dataSource.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();

  try {
    const proof = qr.manager.create(PaymentProof, {
      purchase,
      fileName: data.fileName || null,
      fileMimeType: data.fileMimeType || null,
      fileBase64: data.fileBase64,
      rawExtractedText: analysis.rawExtractedText || null,
      normalizedExtractedText: analysis.normalizedExtractedText || null,
      detectedAmount:
        analysis.detectedAmount !== null ? analysis.detectedAmount.toFixed(2) : null,
      detectedPayerName: analysis.detectedPayerName,
      detectedDestinationAlias: analysis.detectedDestinationAlias,
      ocrConfidence: analysis.ocrConfidence.toFixed(2),
      validationScore: analysis.validationScore.toFixed(2),
      analysisSummary: analysis.analysisSummary,
      reviewStatus: analysis.reviewStatus,
      autoApproved: analysis.autoApprove,
    });

    await qr.manager.save(PaymentProof, proof);

    const submittedAt = new Date();

    if (analysis.autoApprove) {
      const approvedAt = new Date();

      purchase.status = RafflePurchaseStatus.AUTO_APPROVED;
      purchase.autoApproved = true;
      purchase.submittedAt = submittedAt;
      purchase.reviewedAt = approvedAt;
      purchase.approvedAt = approvedAt;
      purchase.reviewNotes = 'Aprobado automáticamente por score OCR';

      for (const item of purchase.items) {
        item.status = RafflePurchaseItemStatus.APPROVED;
        item.approvedAt = approvedAt;
        item.rejectedAt = null;

        item.ticket.status = 'sold';
        item.ticket.lockedAt = null;
        item.ticket.approvedAt = approvedAt;
      }

      await qr.manager.save(RafflePurchaseItem, purchase.items);
      await qr.manager.save(
        Ticket,
        purchase.items.map((item) => item.ticket),
      );

      await qr.manager.update(RafflePurchase, purchase.id, {
        status: purchase.status,
        autoApproved: purchase.autoApproved,
        submittedAt: purchase.submittedAt,
        reviewedAt: purchase.reviewedAt,
        approvedAt: purchase.approvedAt,
        reviewNotes: purchase.reviewNotes,
      });
    } else {
      purchase.status = RafflePurchaseStatus.UNDER_REVIEW;
      purchase.autoApproved = false;
      purchase.submittedAt = submittedAt;

      await qr.manager.update(RafflePurchase, purchase.id, {
        status: purchase.status,
        autoApproved: purchase.autoApproved,
        submittedAt: purchase.submittedAt,
      });
    }

    await qr.commitTransaction();

    for (const item of purchase.items) {
      this.rifaGateway.server.emit(`raffle-${purchase.raffle.id}-update`, {
        number: item.ticket.number,
        status: item.ticket.status,
      });
    }

    this.rifaGateway.server.emit(`raffle-${purchase.raffle.id}-purchase-update`, {
      purchaseId: purchase.id,
      status: purchase.status,
    });

    return this.getPurchaseById(purchase.id);
  } catch (error) {
    await qr.rollbackTransaction();
    throw error;
  } finally {
    await qr.release();
  }
}

  async approvePurchase(
    creatorId: string,
    purchaseId: string,
    data: ApproveRafflePurchaseDto,
  ) {
    const purchase = await this.purchaseRepo.findOne({
      where: { id: purchaseId },
      relations: [
        'raffle',
        'raffle.creator',
        'items',
        'items.ticket',
        'proofs',
      ],
    });

    if (!purchase) {
      throw new NotFoundException('Compra no encontrada');
    }

    if (purchase.raffle.creator.id !== creatorId) {
      throw new BadRequestException('No tenés permisos para aprobar esta compra');
    }

    if (
      [
        RafflePurchaseStatus.APPROVED,
        RafflePurchaseStatus.AUTO_APPROVED,
        RafflePurchaseStatus.REJECTED,
        RafflePurchaseStatus.EXPIRED,
        RafflePurchaseStatus.CANCELLED,
      ].includes(purchase.status)
    ) {
      throw new BadRequestException('Esta compra ya no se puede aprobar');
    }

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const approvedAt = new Date();

      purchase.status = RafflePurchaseStatus.APPROVED;
      purchase.autoApproved = false;
      purchase.reviewedAt = approvedAt;
      purchase.approvedAt = approvedAt;
      purchase.reviewNotes = data.reviewNotes?.trim() || null;
      purchase.approvedBy = { id: creatorId } as User;

      for (const item of purchase.items) {
        item.status = RafflePurchaseItemStatus.APPROVED;
        item.approvedAt = approvedAt;
        item.rejectedAt = null;

        item.ticket.status = 'sold';
        item.ticket.lockedAt = null;
        item.ticket.approvedAt = approvedAt;
      }

      const latestProof = [...(purchase.proofs || [])].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      )[0];

      if (latestProof) {
        latestProof.reviewStatus = PaymentProofReviewStatus.MANUAL_APPROVED;
        await qr.manager.save(latestProof);
      }

      await qr.manager.save(purchase.items);
      await qr.manager.save(purchase.items.map((item) => item.ticket));
      await qr.manager.save(purchase);

      await qr.commitTransaction();

      for (const item of purchase.items) {
        this.rifaGateway.server.emit(`raffle-${purchase.raffle.id}-update`, {
          number: item.ticket.number,
          status: 'sold',
        });
      }

      this.rifaGateway.server.emit(`raffle-${purchase.raffle.id}-purchase-update`, {
        purchaseId: purchase.id,
        status: purchase.status,
      });

      return this.getPurchaseById(purchase.id);
    } catch (error) {
      await qr.rollbackTransaction();
      throw error;
    } finally {
      await qr.release();
    }
  }

  async rejectPurchase(
    creatorId: string,
    purchaseId: string,
    data: RejectRafflePurchaseDto,
  ) {
    const purchase = await this.purchaseRepo.findOne({
      where: { id: purchaseId },
      relations: [
        'raffle',
        'raffle.creator',
        'items',
        'items.ticket',
        'proofs',
      ],
    });

    if (!purchase) {
      throw new NotFoundException('Compra no encontrada');
    }

    if (purchase.raffle.creator.id !== creatorId) {
      throw new BadRequestException('No tenés permisos para rechazar esta compra');
    }

    if (
      [
        RafflePurchaseStatus.APPROVED,
        RafflePurchaseStatus.AUTO_APPROVED,
        RafflePurchaseStatus.REJECTED,
        RafflePurchaseStatus.EXPIRED,
        RafflePurchaseStatus.CANCELLED,
      ].includes(purchase.status)
    ) {
      throw new BadRequestException('Esta compra ya no se puede rechazar');
    }

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const rejectedAt = new Date();

      purchase.status = RafflePurchaseStatus.REJECTED;
      purchase.autoApproved = false;
      purchase.reviewedAt = rejectedAt;
      purchase.rejectedAt = rejectedAt;
      purchase.rejectionReason = data.reason.trim();
      purchase.reviewNotes = data.reviewNotes?.trim() || null;
      purchase.approvedBy = { id: creatorId } as User;

      for (const item of purchase.items) {
        item.status = RafflePurchaseItemStatus.REJECTED;
        item.rejectedAt = rejectedAt;
        item.approvedAt = null;

        item.ticket.status = 'available';
        item.ticket.lockedAt = null;
        item.ticket.approvedAt = null;
        item.ticket.buyerName = null;
        item.ticket.buyerPhone = null;
        item.ticket.buyerEmail = null;
      }

      const latestProof = [...(purchase.proofs || [])].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      )[0];

      if (latestProof) {
        latestProof.reviewStatus = PaymentProofReviewStatus.MANUAL_REJECTED;
        await qr.manager.save(latestProof);
      }

      await qr.manager.save(purchase.items);
      await qr.manager.save(purchase.items.map((item) => item.ticket));
      await qr.manager.save(purchase);

      await qr.commitTransaction();

      for (const item of purchase.items) {
        this.rifaGateway.server.emit(`raffle-${purchase.raffle.id}-update`, {
          number: item.ticket.number,
          status: 'available',
        });
      }

      this.rifaGateway.server.emit(`raffle-${purchase.raffle.id}-purchase-update`, {
        purchaseId: purchase.id,
        status: purchase.status,
      });

      return this.getPurchaseById(purchase.id);
    } catch (error) {
      await qr.rollbackTransaction();
      throw error;
    } finally {
      await qr.release();
    }
  }

  async getCreatorPurchases(creatorId: string, raffleId: string) {
    const raffle = await this.raffleRepo.findOne({
      where: { id: raffleId, creator: { id: creatorId } },
    });

    if (!raffle) {
      throw new NotFoundException('Evento no encontrado');
    }

    const purchases = await this.purchaseRepo
      .createQueryBuilder('purchase')
      .leftJoinAndSelect('purchase.items', 'items')
      .leftJoinAndSelect('items.ticket', 'ticket')
      .leftJoinAndSelect('items.seat', 'seat')
      .leftJoinAndSelect('purchase.proofs', 'proofs')
      .addSelect('proofs.fileBase64')
      .leftJoinAndSelect('purchase.approvedBy', 'approvedBy')
      .leftJoinAndSelect('purchase.createdBySeller', 'createdBySeller')
      .leftJoin('purchase.raffle', 'raffle')
      .where('raffle.id = :raffleId', { raffleId })
      .orderBy('purchase.createdAt', 'DESC')
      .getMany();

    return Promise.all(purchases.map((purchase) => this.mapPurchase(purchase)));
  }

  async getPurchaseById(purchaseId: string) {
    const purchase = await this.purchaseRepo
      .createQueryBuilder('purchase')
      .leftJoinAndSelect('purchase.raffle', 'raffle')
      .leftJoinAndSelect('purchase.items', 'items')
      .leftJoinAndSelect('items.ticket', 'ticket')
      .leftJoinAndSelect('items.seat', 'seat')
      .leftJoinAndSelect('purchase.proofs', 'proofs')
      .addSelect('proofs.fileBase64')
      .leftJoinAndSelect('purchase.approvedBy', 'approvedBy')
      .leftJoinAndSelect('purchase.createdBySeller', 'createdBySeller')
      .where('purchase.id = :purchaseId', { purchaseId })
      .getOne();

    if (!purchase) {
      throw new NotFoundException('Compra no encontrada');
    }

    return this.mapPurchase(purchase);
  }

  private normalizeAttendees(data: ReserveRafflePurchaseDto): NormalizedAttendee[] {
    const fromAttendees = Array.isArray(data.attendees)
      ? data.attendees
          .map((att) => ({
            fullName: String(att?.fullName || '').trim(),
            phone: String(att?.phone || '').trim(),
            email: att?.email ? String(att.email).trim().toLowerCase() : null,
          }))
          .filter((att) => !!att.fullName && !!att.phone)
      : [];

    if (fromAttendees.length > 0) {
      return fromAttendees;
    }

    const legacyName = String(data.buyerName || '').trim();
    const legacyPhone = String(data.buyerPhone || '').trim();
    const legacyEmail = data.buyerEmail
      ? String(data.buyerEmail).trim().toLowerCase()
      : null;

    if (legacyName && legacyPhone) {
      return [
        {
          fullName: legacyName,
          phone: legacyPhone,
          email: legacyEmail,
        },
      ];
    }

    throw new BadRequestException(
      'Completá al menos una persona con nombre y WhatsApp para continuar.',
    );
  }

  private resolveRequestedQuantity(
    data: ReserveRafflePurchaseDto,
    attendeesLength: number,
  ) {
    if (Array.isArray(data.ticketIds) && data.ticketIds.length > 0) {
      return [...new Set(data.ticketIds)].length;
    }

    if (Array.isArray(data.seatIds) && data.seatIds.length > 0) {
      return [...new Set(data.seatIds)].length;
    }

    if (Number.isFinite(Number(data.quantity)) && Number(data.quantity) > 0) {
      return Number(data.quantity);
    }

    return attendeesLength;
  }

  private expandAttendees(
    attendees: NormalizedAttendee[],
    requestedQuantity: number,
  ): NormalizedAttendee[] {
    if (requestedQuantity <= 0) {
      throw new BadRequestException('La cantidad solicitada debe ser mayor a 0.');
    }

    if (attendees.length === requestedQuantity) {
      return attendees;
    }

    if (attendees.length === 1 && requestedQuantity > 1) {
      return Array.from({ length: requestedQuantity }, () => ({
        ...attendees[0],
      }));
    }

    throw new BadRequestException(
      'La cantidad de personas cargadas no coincide con la cantidad de accesos seleccionados.',
    );
  }

  private async resolveTicketsForReservation(
    raffleId: string,
    data: ReserveRafflePurchaseDto,
    requestedQuantity: number,
  ) {
    const seatsByTicketId = new Map<string, RaffleSeat>();

    if (Array.isArray(data.ticketIds) && data.ticketIds.length > 0) {
      const uniqueTicketIds = [...new Set(data.ticketIds)];

      const tickets = await this.ticketRepo.find({
        where: {
          id: In(uniqueTicketIds),
          raffle: { id: raffleId },
        },
        relations: ['raffle', 'seat'],
        order: { number: 'ASC' },
      });

      if (tickets.length !== uniqueTicketIds.length) {
        throw new BadRequestException(
          'Uno o más accesos seleccionados no existen en este evento.',
        );
      }

      const unavailable = tickets.filter((ticket) => ticket.status !== 'available');
      if (unavailable.length > 0) {
        throw new BadRequestException(
          `Uno o más accesos ya no están disponibles: ${unavailable
            .map((t) => t.number)
            .join(', ')}`,
        );
      }

      for (const ticket of tickets) {
        if ((ticket as any).seat) {
          seatsByTicketId.set(ticket.id, (ticket as any).seat);
        }
      }

      return { tickets, seatsByTicketId };
    }

    if (Array.isArray(data.seatIds) && data.seatIds.length > 0) {
      const uniqueSeatIds = [...new Set(data.seatIds)];

      const tickets = await this.ticketRepo
        .createQueryBuilder('ticket')
        .leftJoinAndSelect('ticket.seat', 'seat')
        .innerJoin('ticket.raffle', 'raffle')
        .where('raffle.id = :raffleId', { raffleId })
        .andWhere('seat.id IN (:...seatIds)', { seatIds: uniqueSeatIds })
        .orderBy('ticket.number', 'ASC')
        .getMany();

      if (tickets.length !== uniqueSeatIds.length) {
        throw new BadRequestException(
          'Uno o más lugares seleccionados ya no existen o no están disponibles.',
        );
      }

      const unavailable = tickets.filter((ticket) => ticket.status !== 'available');
      if (unavailable.length > 0) {
        throw new BadRequestException(
          'Uno o más lugares elegidos ya fueron reservados por otra persona.',
        );
      }

      for (const ticket of tickets) {
        if ((ticket as any).seat) {
          seatsByTicketId.set(ticket.id, (ticket as any).seat);
        }
      }

      return { tickets, seatsByTicketId };
    }

    const tickets = await this.ticketRepo
      .createQueryBuilder('ticket')
      .leftJoinAndSelect('ticket.seat', 'seat')
      .innerJoin('ticket.raffle', 'raffle')
      .where('raffle.id = :raffleId', { raffleId })
      .andWhere('ticket.status = :status', { status: 'available' })
      .orderBy('ticket.number', 'ASC')
      .take(requestedQuantity)
      .getMany();

    if (tickets.length !== requestedQuantity) {
      throw new BadRequestException(
        'No hay suficientes lugares disponibles para completar tu solicitud.',
      );
    }

    for (const ticket of tickets) {
      if ((ticket as any).seat) {
        seatsByTicketId.set(ticket.id, (ticket as any).seat);
      }
    }

    return { tickets, seatsByTicketId };
  }

  private async assertRaffleCanKeepSelling(raffleId: string) {
    const confirmedNumbers = await this.purchaseItemRepo
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

    if (confirmedNumbers < 20) {
      return;
    }

    const paidUnlock = await this.accessPaymentRepo.findOne({
      where: {
        raffle: { id: raffleId },
        status: RaffleAccessPaymentStatus.PAID,
      },
      order: { createdAt: 'DESC' },
    });

    if (!paidUnlock) {
      throw new BadRequestException(
        'Este evento alcanzó el límite gratuito de 20 accesos confirmados. Para seguir vendiendo debés desbloquearlo.',
      );
    }
  }

  private async mapPurchase(purchase: RafflePurchase) {
    const items = [...(purchase.items || [])].sort((a, b) =>
      a.ticketNumber.localeCompare(b.ticketNumber),
    );

    const latestProof = [...(purchase.proofs || [])].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];

    const firstItem = items[0] || null;
    const qrBase64 = firstItem?.qrToken
      ? await this.buildQrBase64(firstItem.qrToken)
      : null;

    const seatLabels = items
      .map((item) => item.seatLabel)
      .filter((value): value is string => !!value);

    const tableName = firstItem?.tableLabel || null;

    return {
      id: purchase.id,
      raffleId: purchase.raffle?.id,
      buyerName: purchase.buyerName,
      buyerPhone: purchase.buyerPhone,
      buyerEmail: purchase.buyerEmail,
      paymentMethod: purchase.paymentMethod,
      status: purchase.status,
      totalAmount: this.toNumber(purchase.totalAmount),
      ticketCount: purchase.ticketCount,
      reservedAt: purchase.reservedAt,
      expiresAt: purchase.expiresAt,
      submittedAt: purchase.submittedAt,
      reviewedAt: purchase.reviewedAt,
      approvedAt: purchase.approvedAt,
      rejectedAt: purchase.rejectedAt,
      autoApproved: purchase.autoApproved,
      reviewNotes: purchase.reviewNotes,
      rejectionReason: purchase.rejectionReason,

      accessCode: firstItem?.accessCode || null,
      qrToken: firstItem?.qrToken || null,
      qrBase64,
      qrUrl: null,

      tableName,
      seatLabels,

      attendees: items.map((item) => ({
        fullName: item.attendeeName,
        phone: item.attendeePhone,
        email: item.attendeeEmail,
        accessCode: item.accessCode,
        seatLabel: item.seatLabel,
        sectionLabel: item.sectionLabel,
        tableLabel: item.tableLabel,
        status: item.status,
      })),

      createdBySeller: purchase.createdBySeller
        ? {
            id: purchase.createdBySeller.id,
            firstName: purchase.createdBySeller.firstName,
            lastName: purchase.createdBySeller.lastName,
            email: purchase.createdBySeller.email,
          }
        : null,

      approvedBy: purchase.approvedBy
        ? {
            id: purchase.approvedBy.id,
            firstName: purchase.approvedBy.firstName,
            lastName: purchase.approvedBy.lastName,
            email: purchase.approvedBy.email,
          }
        : null,

      numbers: items.map((item) => ({
        itemId: item.id,
        ticketId: item.ticket?.id,
        number: item.ticketNumber,
        unitPrice: this.toNumber(item.unitPrice),
        accessCode: item.accessCode,
        qrToken: item.qrToken,
        attendeeName: item.attendeeName,
        attendeePhone: item.attendeePhone,
        attendeeEmail: item.attendeeEmail,
        seatLabel: item.seatLabel,
        sectionLabel: item.sectionLabel,
        tableLabel: item.tableLabel,
        status: item.status,
      })),

      latestProof: latestProof
        ? {
            id: latestProof.id,
            fileName: latestProof.fileName,
            fileMimeType: latestProof.fileMimeType,
            fileBase64: latestProof.fileBase64,
            base64: latestProof.fileBase64,
            imageBase64: latestProof.fileBase64,
            previewBase64: latestProof.fileBase64,
            rawExtractedText: latestProof.rawExtractedText,
            normalizedExtractedText: latestProof.normalizedExtractedText,
            detectedAmount: latestProof.detectedAmount
              ? this.toNumber(latestProof.detectedAmount)
              : null,
            detectedPayerName: latestProof.detectedPayerName,
            detectedDestinationAlias: latestProof.detectedDestinationAlias,
            ocrConfidence: this.toNumber(latestProof.ocrConfidence),
            validationScore: this.toNumber(latestProof.validationScore),
            analysisSummary: latestProof.analysisSummary,
            reviewStatus: latestProof.reviewStatus,
            autoApproved: latestProof.autoApproved,
            createdAt: latestProof.createdAt,
          }
        : null,
    };
  }

  private async buildQrBase64(qrToken: string) {
    const payload = `PL|ACCESS|${qrToken}`;
    return QRCode.toDataURL(payload, {
      margin: 1,
      width: 420,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    });
  }

  private generateAccessCode() {
    return `EV-${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private generateQrToken() {
    return randomBytes(24).toString('hex');
  }

  private getReservationMinutes() {
    const raw = Number(
      this.configService.get<string>('RAFFLE_RESERVATION_MINUTES') || 15,
    );
    return Number.isFinite(raw) && raw > 0 ? raw : 15;
  }

  private toNumber(value: unknown, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  private round2(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}