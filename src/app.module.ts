import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DoorAssignment } from './entities/door-assignment.entity';
import { EventGuest } from './entities/event-guest.entity';
import { GlobalCatalogItem } from './entities/global-catalog-item.entity';
import { Invitation } from './entities/invitation.entity';
import { InvitationAsset } from './entities/invitation-asset.entity';
import { PaymentProof } from './entities/payment-proof.entity';
import { Prize } from './entities/prize.entity';
import { RaffleAccessPayment } from './entities/raffle-access-payment.entity';
import { RafflePurchaseItem } from './entities/raffle-purchase-item.entity';
import { RafflePurchase } from './entities/raffle-purchase.entity';
import { RaffleSeat } from './entities/raffle-seat.entity';
import { Raffle } from './entities/raffle.entity';
import { SellerAssignment } from './entities/seller-assignment.entity';
import { Ticket } from './entities/ticket.entity';
import { User } from './entities/user.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { AccessModule } from './modules/access/access.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { CronModule } from './modules/cron/cron.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { RaffleAccessPaymentsModule } from './modules/raffle-access-payments/raffle-access-payments.module';
import { RafflePurchasesModule } from './modules/raffle-purchases/raffle-purchases.module';
import { RafflesModule } from './modules/raffles/raffles.module';
import { SellersModule } from './modules/sellers/sellers.module';
import { WebsocketsModule } from './modules/websockets/websockets.module';

function normalizeDatabaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (/^dpg-[a-z0-9-]+-a$/i.test(url.hostname)) {
      url.hostname = `${url.hostname}.oregon-postgres.render.com`;
    }
    return url.toString();
  } catch {
    return value;
  }
}

function isRenderDatabaseUrl(value: string): boolean {
  try {
    return normalizeDatabaseUrl(value).includes('.render.com');
  } catch {
    return false;
  }
}

const normalizedDatabaseUrl = process.env.DATABASE_URL
  ? normalizeDatabaseUrl(process.env.DATABASE_URL)
  : undefined;
const isProduction = process.env.NODE_ENV === 'production';
const databaseSslEnabled =
  process.env.DB_SSL === 'true' ||
  (normalizedDatabaseUrl ? isRenderDatabaseUrl(normalizedDatabaseUrl) : false) ||
  (isProduction && process.env.DB_SSL !== 'false' && Boolean(normalizedDatabaseUrl));

const databaseConfig = normalizedDatabaseUrl
  ? {
      type: 'postgres' as const,
      url: normalizedDatabaseUrl,
      ssl: databaseSslEnabled ? { rejectUnauthorized: false } : false,
      extra: databaseSslEnabled ? { ssl: { rejectUnauthorized: false } } : undefined,
    }
  : {
      type: 'postgres' as const,
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    };

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),
    ScheduleModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
    TypeOrmModule.forRoot({
      ...databaseConfig,
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
        Invitation,
        InvitationAsset,
        GlobalCatalogItem,
        EventGuest,
      ],
      synchronize: process.env.TYPEORM_SYNCHRONIZE !== 'false',
    }),
    AuthModule,
    RafflesModule,
    SellersModule,
    RafflePurchasesModule,
    RaffleAccessPaymentsModule,
    WebsocketsModule,
    CronModule,
    AccessModule,
    AdminModule,
    InvitationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
