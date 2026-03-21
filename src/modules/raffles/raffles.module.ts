import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RafflesController } from './raffles.controller';
import { RafflesService } from './raffles.service';

import { User } from '../../entities/user.entity';
import { Raffle } from '../../entities/raffle.entity';
import { Ticket } from '../../entities/ticket.entity';
import { Prize } from '../../entities/prize.entity';
import { SellerAssignment } from '../../entities/seller-assignment.entity';
import { DoorAssignment } from '../../entities/door-assignment.entity';
import { RaffleSeat } from '../../entities/raffle-seat.entity';
import { RafflePurchaseItem } from '../../entities/raffle-purchase-item.entity';
import { RaffleAccessPayment } from '../../entities/raffle-access-payment.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Raffle,
      Ticket,
      Prize,
      SellerAssignment,
      DoorAssignment,
      RaffleSeat,
      RafflePurchaseItem,
      RaffleAccessPayment,
    ]),
  ],
  controllers: [RafflesController],
  providers: [RafflesService],
  exports: [RafflesService],
})
export class RafflesModule {}