import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';

import { Ticket } from '../../entities/ticket.entity';
import { User } from '../../entities/user.entity';
// IMPORTANTE: Importa tu RifaGateway. Ajusta la ruta según tu estructura.
import { RifaGateway } from '../websockets/rifa.gateway';

@Injectable()
export class MercadoPagoService {
  private readonly logger = new Logger(MercadoPagoService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @InjectRepository(Ticket) private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    // NUEVO: Inyecta el RifaGateway en el constructor
    private readonly rifaGateway: RifaGateway,
  ) {}

  /**
   * 1. Genera la URL para que el usuario autorice a tu plataforma.
   */
  getOAuthUrl(userId: string) {
    const appId = this.configService.get<string>('MP_APP_ID');
    const redirectUri = this.configService.get<string>('MP_REDIRECT_URI');

    if (!appId || !redirectUri) {
      throw new BadRequestException(
        'Falta configurar MP_APP_ID o MP_REDIRECT_URI',
      );
    }

    return `https://auth.mercadopago.com/authorization?client_id=${appId}&response_type=code&platform_id=mp&state=${userId}&redirect_uri=${redirectUri}`;
  }

  /**
   * 2. Intercambia el code por access_token / refresh_token del usuario.
   */
  async linkAccount(code: string, userId: string) {
    const clientSecret = this.configService.get<string>('MP_CLIENT_SECRET');
    const clientId = this.configService.get<string>('MP_APP_ID');
    const redirectUri = this.configService.get<string>('MP_REDIRECT_URI');

    if (!clientSecret || !clientId || !redirectUri) {
      throw new BadRequestException(
        'Faltan credenciales de Mercado Pago para vincular cuentas',
      );
    }

    const response = await firstValueFrom(
      this.httpService.post('https://api.mercadopago.com/oauth/token', {
        client_secret: clientSecret,
        client_id: clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    );

    await this.userRepo.update(userId, {
      mp_access_token: response.data.access_token,
      mp_refresh_token: response.data.refresh_token,
      mp_user_id: response.data.user_id?.toString?.() || null,
    });

    return { linked: true };
  }

  /**
   * 3. Genera el checkout con fee de plataforma.
   */
  async createCheckout(
    ticketId: string,
    buyerName: string,
    buyerPhone: string,
    sellerId?: string,
    buyerEmail?: string,
  ) {
    const ticket = await this.ticketRepo.findOne({
      where: { id: ticketId },
      relations: ['raffle', 'raffle.creator'],
    });

    if (!ticket) {
      throw new NotFoundException('Ticket no encontrado.');
    }

    if (ticket.status !== 'available') {
      throw new BadRequestException(
        'El ticket ya no está disponible para compra.',
      );
    }

    const creator = (ticket as any).raffle?.creator;
    const creatorAccessToken = creator?.mp_access_token || null;

    if (!creatorAccessToken) {
      throw new BadRequestException(
        'El organizador no tiene Mercado Pago vinculado correctamente.',
      );
    }

    const accessToken = creatorAccessToken;

    const ticketPrice = this.toNumber((ticket as any).raffle?.ticketPrice, 0);

    const rafflePlatformFeeRate = this.toNumber(
      (ticket as any).raffle?.platformFeeRate,
      NaN,
    );

    const envPlatformFeeRate = this.toNumber(
      this.configService.get<string>('PLATFORM_FEE_RATE'),
      0.05,
    );

    const platformFeeRate = Number.isFinite(rafflePlatformFeeRate)
      ? rafflePlatformFeeRate
      : envPlatformFeeRate;

    const platformFeeAmount = this.round2(ticketPrice * platformFeeRate);

    // --- LÓGICA DE BLOQUEO TEMPORAL ---
    ticket.status = 'pending';
    ticket.buyerName = buyerName || null;
    ticket.buyerPhone = buyerPhone || null;
    (ticket as any).buyerEmail = buyerEmail || null;
    ticket.lockedAt = new Date();

    await this.ticketRepo.save(ticket);

    // NUEVO: Emitir eventos de WebSocket para bloqueo y FOMO
    const raffleId = (ticket as any).raffle?.id;
    if (raffleId) {
      // 1. Actualizar grilla a 'pending' (gris)
      this.rifaGateway.server.emit(`raffle-${raffleId}-update`, {
        number: ticket.number,
        status: 'pending',
      });
      // 2. Enviar mensaje FOMO
      this.rifaGateway.server.emit(`raffle-${raffleId}-fomo`, {
        message: `🛒 ${buyerName || 'Alguien'} está reservando el número ${ticket.number}...`,
      });
    }

    const frontendUrl = this.getFrontendUrl();
    const backendUrl = this.getBackendUrl();

    const preference = {
      items: [
        {
          title: `Ticket #${ticket.number} - ${(ticket as any).raffle?.title}`,
          unit_price: ticketPrice,
          quantity: 1,
          currency_id: 'ARS',
        },
      ],

      marketplace_fee: platformFeeAmount,
      external_reference: ticket.id,

      metadata: {
        seller_id: sellerId || null,
        raffle_id: raffleId,
        ticket_number: ticket.number,
        platform_fee_amount: platformFeeAmount,
        platform_fee_rate: platformFeeRate,
      },

      notification_url: `${backendUrl}/api/mp/webhook`,
      back_urls: {
        success: `${frontendUrl}/raffle/${raffleId}?status=success`,
        failure: `${frontendUrl}/raffle/${raffleId}?status=error`,
        pending: `${frontendUrl}/raffle/${raffleId}?status=pending`,
      },
      auto_return: 'approved',

      payer: {
        name: buyerName || undefined,
        email: buyerEmail || undefined,
      },
    };

    this.logger.log(
      `Preparando cobro MP | ticket=${ticket.id} | raffle=${raffleId} | organizer=${creator?.id} | price=${ticketPrice} | marketplace_fee=${platformFeeAmount} | sellerToken=${creatorAccessToken ? 'OAUTH_OK' : 'NO_OAUTH'}`,
    );

    try {
      const res = await firstValueFrom(
        this.httpService.post(
          'https://api.mercadopago.com/checkout/preferences',
          preference,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      this.logger.log(
        `Preference MP creada | preference_id=${res.data?.id} | init_point_ok=${!!res.data?.init_point} | collector_id=${res.data?.collector_id} | marketplace_fee=${platformFeeAmount}`,
      );

      return res.data.init_point;
    } catch (e: any) {
      // En caso de error en MP, liberamos el ticket
      ticket.status = 'available';
      ticket.lockedAt = null;
      await this.ticketRepo.save(ticket);

      // NUEVO: Notificar al front que vuelve a estar disponible
      if (raffleId) {
        this.rifaGateway.server.emit(`raffle-${raffleId}-update`, {
          number: ticket.number,
          status: 'available',
        });
      }

      this.logger.error(
        `Error al crear preferencia en MP: ${
          JSON.stringify(e?.response?.data) || e?.message
        }`,
      );

      throw new BadRequestException(
        'No se pudo generar el link de pago. Intentá más tarde.',
      );
    }
  }

  /**
   * 4. Procesa un pago a partir del paymentId del webhook
   */
  async processPaymentWebhook(paymentId: string) {
    const mpAccessToken = this.configService.get<string>('MP_ACCESS_TOKEN');

    if (!mpAccessToken) {
      throw new BadRequestException('Falta MP_ACCESS_TOKEN');
    }

    const paymentRes = await firstValueFrom(
      this.httpService.get(
        `https://api.mercadopago.com/v1/payments/${paymentId}`,
        {
          headers: {
            Authorization: `Bearer ${mpAccessToken}`,
          },
        },
      ),
    );

    const payment = paymentRes.data;
    const externalReference = payment?.external_reference
      ? String(payment.external_reference)
      : '';

    if (!externalReference) {
      this.logger.warn(
        `Payment ${paymentId} sin external_reference. Se ignora.`,
      );
      return null;
    }

    const ticket = await this.ticketRepo.findOne({
      where: { id: externalReference },
      relations: ['raffle'],
    });

    if (!ticket) {
      this.logger.warn(
        `No se encontró ticket con id ${externalReference} para payment ${paymentId}`,
      );
      return null;
    }

    const raffleId = (ticket as any).raffle?.id; // Guardamos el ID para usarlo luego

    const grossAmount =
      this.toNumber(payment?.transaction_details?.total_paid_amount) ||
      this.toNumber(payment?.transaction_amount);

    const organizerNetAmount =
      this.toNumber(payment?.transaction_details?.net_received_amount);

    const realApplicationFee = this.toNumber(payment?.application_fee, 0);
    const appFeeAmount = realApplicationFee;

    this.logger.log(
      `Webhook payment=${paymentId} | status=${payment?.status} | gross=${grossAmount} | net=${organizerNetAmount} | application_fee=${realApplicationFee}`,
    );

    if (payment?.status === 'approved' && realApplicationFee <= 0) {
      this.logger.error(
        `Pago aprobado sin application_fee real. Mercado Pago no aplicó split fee para este cobro. Revisar habilitación de cuenta MP.`,
      );
    }

    let mpFeeAmount = this.round2(
      grossAmount - organizerNetAmount - appFeeAmount,
    );

    if (mpFeeAmount < 0) {
      mpFeeAmount = 0;
    }

    const status = String(payment?.status || '');

    (ticket as any).mp_payment_id = paymentId;
    (ticket as any).mp_payment_status = status;
    (ticket as any).mp_payment_method_id = payment?.payment_method_id
      ? String(payment.payment_method_id)
      : null;
    (ticket as any).mp_payment_type_id = payment?.payment_type_id
      ? String(payment.payment_type_id)
      : null;

    (ticket as any).gross_amount = grossAmount.toFixed(2);
    (ticket as any).mp_fee_amount = mpFeeAmount.toFixed(2);
    (ticket as any).platform_fee_amount = appFeeAmount.toFixed(2);
    (ticket as any).organizer_net_amount = organizerNetAmount.toFixed(2);

    // --- LÓGICA DE ACTUALIZACIÓN FINAL DE ESTADO ---
    if (status === 'approved') {
      ticket.status = 'sold';
      ticket.lockedAt = null;
      (ticket as any).approvedAt = payment?.date_approved
        ? new Date(payment.date_approved)
        : new Date();

      if (payment?.metadata?.seller_id) {
        ticket.soldBySeller = { id: payment.metadata.seller_id } as any;
      }
    } else if (status === 'pending' || status === 'in_process') {
      ticket.status = 'pending';
    } else if (
      status === 'rejected' ||
      status === 'cancelled' ||
      status === 'refunded' ||
      status === 'charged_back'
    ) {
      // Si el pago falla o se cancela, el ticket vuelve a estar disponible
      ticket.status = 'available';
      ticket.lockedAt = null;
    }

    await this.ticketRepo.save(ticket);

    // NUEVO: Emitir evento WebSocket para actualizar el estado final en la grilla
    if (raffleId) {
      // Esto notificará 'sold' (amarillo) o 'available' (verde) según corresponda
      this.rifaGateway.server.emit(`raffle-${raffleId}-update`, {
        number: ticket.number,
        status: ticket.status,
      });
    }

    return {
      raffleId: raffleId,
      number: ticket.number,
      status: ticket.status,
      financials: {
        grossAmount,
        mpFeeAmount,
        platformFeeAmount: appFeeAmount,
        organizerNetAmount,
      },
    };
  }

  private getFrontendUrl() {
    return (
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173'
    ).replace(/\/+$/, '');
  }

  private getBackendUrl() {
    return (
      this.configService.get<string>('BACKEND_URL') ||
      this.configService.get<string>('API_BASE_URL') ||
      'http://localhost:3000'
    ).replace(/\/+$/, '');
  }

  private toNumber(value: unknown, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  private round2(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}