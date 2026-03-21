import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccessService } from './access.service';
import { ValidateQrDto } from './dto/validate-qr.dto';
import { ValidateAccessCodeDto } from './dto/validate-access-code.dto';

type AuthRequest = Request & {
  user: {
    id: string;
    email: string;
    role: 'creator' | 'seller' | 'door';
    firstName?: string;
    lastName?: string;
    fullName?: string;
  };
};

@UseGuards(JwtAuthGuard)
@Controller('api/access')
export class AccessController {
  constructor(private readonly accessService: AccessService) {}

  @Post('validate-qr')
  validateQr(@Req() req: AuthRequest, @Body() body: ValidateQrDto) {
    return this.accessService.validateQr(req.user.id, req.user.role, body);
  }

  @Post('validate-code')
  validateCode(@Req() req: AuthRequest, @Body() body: ValidateAccessCodeDto) {
    return this.accessService.validateCode(req.user.id, req.user.role, body);
  }

  @Get('my-raffles')
  getMyRaffles(@Req() req: AuthRequest) {
    return this.accessService.getAccessibleRaffles(req.user.id, req.user.role);
  }

  @Get('raffle/:raffleId/recent-checkins')
  getRecentCheckins(@Req() req: AuthRequest, @Param('raffleId') raffleId: string) {
    return this.accessService.getRecentCheckins(req.user.id, req.user.role, raffleId);
  }
}