import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SellersController } from './sellers.controller';
import { SellersService } from './sellers.service';

import { User } from '../../entities/user.entity';
import { Raffle } from '../../entities/raffle.entity';
import { SellerAssignment } from '../../entities/seller-assignment.entity';
import { RafflePurchase } from '../../entities/raffle-purchase.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Raffle,
      SellerAssignment,
      RafflePurchase,
    ]),
  ],
  controllers: [SellersController],
  providers: [SellersService],
  exports: [SellersService],
})
export class SellersModule {}