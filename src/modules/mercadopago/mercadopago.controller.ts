import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  SetMetadata,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';

import { MercadoPagoService } from './mercadopago.service';
import { RifaGateway } from '../websockets/rifa.gateway';

@Controller('api/mp')
export class MercadoPagoController {
  constructor(
    private readonly mpService: MercadoPagoService,
    private readonly wsGateway: RifaGateway,
    private readonly configService: ConfigService,
  ) {}

  @Get('auth-url')
  getAuthUrl(@Query('userId') userId: string) {
    return { url: this.mpService.getOAuthUrl(userId) };
  }

  @SetMetadata('isPublic', true)
  @Get('callback')
  async webhookCallback(
    @Query('code') code: string,
    @Query('state') userId: string,
    @Res() res: Response,
  ) {
    const frontUrl =
      this.configService.get<string>('FRONTEND_URL') ||
      'http://localhost:5173';

    if (!code) {
      return res.redirect(`${frontUrl}/create?error=mp_auth_failed`);
    }

    try {
      await this.mpService.linkAccount(code, userId);
      return res.redirect(`${frontUrl}/create?mp_linked=true`);
    } catch (e) {
      return res.redirect(`${frontUrl}/create?error=mp_link_error`);
    }
  }

  @Post('checkout')
  createCheckout(
    @Body()
    body: {
      ticketId: string;
      buyerName: string;
      buyerPhone: string;
      buyerEmail?: string;
      sellerId?: string;
    },
  ) {
    return this.mpService.createCheckout(
      body.ticketId,
      body.buyerName,
      body.buyerPhone,
      body.sellerId,
      body.buyerEmail,
    );
  }

  @SetMetadata('isPublic', true)
  @Post('webhook')
  async webhook(
    @Body() body: any,
    @Query() query: any,
    @Res() res: Response,
  ) {
    // Respondemos rápido a MP
    res.status(200).send('OK');

    try {
      const paymentId =
        body?.data?.id ||
        body?.id ||
        query?.['data.id'] ||
        query?.id;

      if (!paymentId) return;

      const result = await this.mpService.processPaymentWebhook(
        String(paymentId),
      );

      if (result?.raffleId) {
        this.wsGateway.server.emit(`raffle-${result.raffleId}-update`, {
          number: result.number,
          status: result.status,
          financials: result.financials,
        });
      }
    } catch (err) {
      console.error('Error procesando webhook MP:', err);
    }
  }
}