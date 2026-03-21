import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Raffle } from '../../entities/raffle.entity';
import { Ticket } from '../../entities/ticket.entity';
import { User } from '../../entities/user.entity';
import { RaffleSeat } from '../../entities/raffle-seat.entity';
import { RafflePurchase } from '../../entities/raffle-purchase.entity';
import { RafflePurchaseItem } from '../../entities/raffle-purchase-item.entity';
import { PaymentProof } from '../../entities/payment-proof.entity';
import { RaffleAccessPayment } from '../../entities/raffle-access-payment.entity';

import { WebsocketsModule } from '../websockets/websockets.module';
import { RafflePurchasesController } from './raffle-purchases.controller';
import { RafflePurchasesService } from './raffle-purchases.service';
import { ProofAnalysisService } from './proof-analysis.service';
import { RafflePurchasesExpirationCron } from './raffle-purchases.expiration.cron';

@Module({
  imports: [
    ConfigModule,
    WebsocketsModule,
    TypeOrmModule.forFeature([
      Raffle,
      Ticket,
      User,
      RaffleSeat,
      RafflePurchase,
      RafflePurchaseItem,
      PaymentProof,
      RaffleAccessPayment,
    ]),
  ],
  controllers: [RafflePurchasesController],
  providers: [
    RafflePurchasesService,
    ProofAnalysisService,
    RafflePurchasesExpirationCron,
  ],
  exports: [RafflePurchasesService],
})
export class RafflePurchasesModule {}