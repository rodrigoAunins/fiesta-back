import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invitation } from '../../entities/invitation.entity';
import { InvitationAsset } from '../../entities/invitation-asset.entity';
import { EventGuest } from '../../entities/event-guest.entity';
import { Raffle } from '../../entities/raffle.entity';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invitation, InvitationAsset, Raffle, EventGuest]),
    AuthModule,
  ],
  controllers: [InvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
