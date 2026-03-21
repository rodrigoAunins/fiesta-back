import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Ticket } from '../../entities/ticket.entity';
import { RifaGateway } from '../websockets/rifa.gateway';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(@InjectRepository(Ticket) private ticketRepo: Repository<Ticket>, private wsGateway: RifaGateway) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async releasePendingTickets() {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const abandonedTickets = await this.ticketRepo.find({ where: { status: 'pending', lockedAt: LessThan(tenMinutesAgo) }, relations: ['raffle'] });

    for (const ticket of abandonedTickets) {
      ticket.status = 'available'; ticket.lockedAt = null; ticket.buyerName = null; ticket.buyerPhone = null;
      await this.ticketRepo.save(ticket);
      this.wsGateway.server.emit(`raffle-${ticket.raffle.id}-update`, { number: ticket.number, status: 'available' });
    }
    if (abandonedTickets.length > 0) this.logger.log(`Se liberaron ${abandonedTickets.length} tickets abandonados.`);
  }
}