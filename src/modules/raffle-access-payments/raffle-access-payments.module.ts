import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Raffle } from '../../entities/raffle.entity';
import { RaffleAccessPayment } from '../../entities/raffle-access-payment.entity';
import { WebhookEvent } from '../../entities/webhook-event.entity';
import { RafflePurchaseItem } from '../../entities/raffle-purchase-item.entity';

import { RaffleAccessPaymentsController } from './raffle-access-payments.controller';
import { RaffleAccessPaymentsService } from './raffle-access-payments.service';

@Module({
  imports: [
    HttpModule,
    ConfigModule,
    TypeOrmModule.forFeature([
      Raffle,
      RaffleAccessPayment,
      WebhookEvent,
      RafflePurchaseItem,
    ]),
  ],
  controllers: [RaffleAccessPaymentsController],
  providers: [RaffleAccessPaymentsService],
  exports: [RaffleAccessPaymentsService],
})
export class RaffleAccessPaymentsModule {}