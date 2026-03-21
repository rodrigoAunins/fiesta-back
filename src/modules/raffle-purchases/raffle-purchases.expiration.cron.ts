import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RafflePurchase } from '../../entities/raffle-purchase.entity';
import { Ticket } from '../../entities/ticket.entity';
import { RafflePurchaseStatus } from '../../common/enums/raffle-purchase-status.enum';
import { RifaGateway } from '../websockets/rifa.gateway';

@Injectable()
export class RafflePurchasesExpirationCron {
  private readonly logger = new Logger(RafflePurchasesExpirationCron.name);

  constructor(
    @InjectRepository(RafflePurchase)
    private readonly purchaseRepo: Repository<RafflePurchase>,
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    private readonly rifaGateway: RifaGateway,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expireReservations() {
    const now = new Date();

    const candidates = await this.purchaseRepo.find({
      where: [
        { status: RafflePurchaseStatus.RESERVED },
      ],
      relations: ['raffle', 'items', 'items.ticket'],
    });

    const toExpire = candidates.filter(
      (purchase) => purchase.expiresAt && purchase.expiresAt <= now,
    );

    if (!toExpire.length) return;

    for (const purchase of toExpire) {
      purchase.status = RafflePurchaseStatus.EXPIRED;
      purchase.reviewNotes = 'Reserva expirada automáticamente por tiempo.';

      await this.purchaseRepo.save(purchase);

      const tickets = purchase.items.map((item) => item.ticket);
      for (const ticket of tickets) {
        ticket.status = 'available';
        ticket.lockedAt = null;
        ticket.buyerName = null;
        ticket.buyerPhone = null;
        ticket.buyerEmail = null;
        await this.ticketRepo.save(ticket);

        this.rifaGateway.server.emit(`raffle-${purchase.raffle.id}-update`, {
          number: ticket.number,
          status: 'available',
        });
      }

      this.rifaGateway.server.emit(`raffle-${purchase.raffle.id}-purchase-update`, {
        purchaseId: purchase.id,
        status: purchase.status,
      });

      this.logger.log(
        `Reserva expirada automáticamente | purchase=${purchase.id} | raffle=${purchase.raffle.id}`,
      );
    }
  }
}