import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

import { User } from '../../entities/user.entity';
import { Raffle } from '../../entities/raffle.entity';
import { Ticket } from '../../entities/ticket.entity';
import { Prize } from '../../entities/prize.entity';
import { SellerAssignment } from '../../entities/seller-assignment.entity';
import { DoorAssignment } from '../../entities/door-assignment.entity';
import { RaffleSeat } from '../../entities/raffle-seat.entity';
import { RafflePurchase } from '../../entities/raffle-purchase.entity';
import { RafflePurchaseItem } from '../../entities/raffle-purchase-item.entity';
import { PaymentProof } from '../../entities/payment-proof.entity';
import { RaffleAccessPayment } from '../../entities/raffle-access-payment.entity';
import { WebhookEvent } from '../../entities/webhook-event.entity';
import { GlobalCatalogItem } from '../../entities/global-catalog-item.entity';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      User,
      Raffle,
      Ticket,
      Prize,
      SellerAssignment,
      DoorAssignment,
      RaffleSeat,
      RafflePurchase,
      RafflePurchaseItem,
      PaymentProof,
      RaffleAccessPayment,
      WebhookEvent,
      GlobalCatalogItem,
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}