import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import { User } from './entities/user.entity';
import { Raffle } from './entities/raffle.entity';
import { Ticket } from './entities/ticket.entity';
import { Prize } from './entities/prize.entity';
import { SellerAssignment } from './entities/seller-assignment.entity';

// NUEVAS ENTIDADES
import { RafflePurchase } from './entities/raffle-purchase.entity';
import { RafflePurchaseItem } from './entities/raffle-purchase-item.entity';
import { PaymentProof } from './entities/payment-proof.entity';
import { RaffleAccessPayment } from './entities/raffle-access-payment.entity';
import { WebhookEvent } from './entities/webhook-event.entity';

import { AuthModule } from './modules/auth/auth.module';
import { RafflesModule } from './modules/raffles/raffles.module';
import { SellersModule } from './modules/sellers/sellers.module';
import { WebsocketsModule } from './modules/websockets/websockets.module';
import { CronModule } from './modules/cron/cron.module';

// NUEVOS MÓDULOS
import { RafflePurchasesModule } from './modules/raffle-purchases/raffle-purchases.module';
import { RaffleAccessPaymentsModule } from './modules/raffle-access-payments/raffle-access-payments.module';
import { RaffleSeat } from './entities/raffle-seat.entity';
import { DoorAssignment } from './entities/door-assignment.entity';
import { AccessModule } from './modules/access/access.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,

      // ✅ IMPORTANTE: agregamos nuevas entidades
      entities: [
        User,
        Raffle,
        Ticket,
        Prize,
        SellerAssignment,
        RaffleSeat,
        RafflePurchase,
        DoorAssignment,
        RafflePurchaseItem,
        PaymentProof,
        RaffleAccessPayment,
        WebhookEvent,
      ],

      synchronize: true, // sigue igual por ahora
    }),

    AuthModule,
    RafflesModule,
    SellersModule,

    // ✅ nuevos módulos del nuevo flujo
    RafflePurchasesModule,
    RaffleAccessPaymentsModule,

    WebsocketsModule,
    CronModule,
    AccessModule,
    AdminModule,
  ],
})
export class AppModule {}