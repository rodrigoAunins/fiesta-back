import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Ticket } from '../../entities/ticket.entity';
import { User } from '../../entities/user.entity';
import { MercadoPagoService } from './mercadopago.service';
import { MercadoPagoController } from './mercadopago.controller';
import { WebsocketsModule } from '../websockets/websockets.module';

@Module({
  imports: [
    HttpModule,
    TypeOrmModule.forFeature([Ticket, User]),
    WebsocketsModule,
  ],
  providers: [MercadoPagoService],
  controllers: [MercadoPagoController],
  exports: [MercadoPagoService],
})
export class MercadoPagoModule {}