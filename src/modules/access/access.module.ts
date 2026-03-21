import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccessController } from './access.controller';
import { AccessService } from './access.service';

import { Raffle } from '../../entities/raffle.entity';
import { User } from '../../entities/user.entity';
import { DoorAssignment } from '../../entities/door-assignment.entity';
import { RafflePurchase } from '../../entities/raffle-purchase.entity';
import { RafflePurchaseItem } from '../../entities/raffle-purchase-item.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Raffle,
      User,
      DoorAssignment,
      RafflePurchase,
      RafflePurchaseItem,
    ]),
  ],
  controllers: [AccessController],
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}