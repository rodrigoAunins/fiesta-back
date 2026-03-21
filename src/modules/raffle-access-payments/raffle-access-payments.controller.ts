import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';

import { RaffleAccessPaymentsService } from './raffle-access-payments.service';
import { CreateRaffleAccessPaymentDto } from './dto/create-raffle-access-payment.dto';

@Controller('api/raffle-access-payments')
export class RaffleAccessPaymentsController {
  constructor(
    private readonly raffleAccessPaymentsService: RaffleAccessPaymentsService,
  ) {}

  @Get('plans')
  getPlans() {
    return this.raffleAccessPaymentsService.getPlans();
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('raffle/:raffleId/status')
  getRaffleUnlockStatus(@Req() req, @Param('raffleId') raffleId: string) {
    return this.raffleAccessPaymentsService.getRaffleUnlockStatus(
      req.user.id,
      raffleId,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('checkout')
  createCheckout(@Req() req, @Body() body: CreateRaffleAccessPaymentDto) {
    return this.raffleAccessPaymentsService.createCheckout(req.user.id, body);
  }

  @SetMetadata('isPublic', true)
  @Post('webhook')
  async webhook(
    @Body() body: any,
    @Query() query: any,
    @Res() res: Response,
  ) {
    res.status(200).send('OK');

    try {
      await this.raffleAccessPaymentsService.processWebhook(body, query);
    } catch (error) {
      console.error('Error procesando webhook de desbloqueo:', error);
    }
  }
}