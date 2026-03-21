import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';

import { Raffle } from '../../entities/raffle.entity';
import { RaffleAccessPayment } from '../../entities/raffle-access-payment.entity';
import { WebhookEvent } from '../../entities/webhook-event.entity';
import { RafflePurchaseItem } from '../../entities/raffle-purchase-item.entity';

import { RaffleAccessPaymentStatus } from '../../common/enums/raffle-access-payment-status.enum';
import { RafflePurchaseStatus } from '../../common/enums/raffle-purchase-status.enum';

import { CreateRaffleAccessPaymentDto } from './dto/create-raffle-access-payment.dto';
import { RAFFLE_ACCESS_PLANS, resolveRaffleAccessPlan } from './raffle-access-plans';

@Injectable()
export class RaffleAccessPaymentsService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,

    @InjectRepository(Raffle)
    private readonly raffleRepo: Repository<Raffle>,

    @InjectRepository(RaffleAccessPayment)
    private readonly accessPaymentRepo: Repository<RaffleAccessPayment>,

    @InjectRepository(WebhookEvent)
    private readonly webhookEventRepo: Repository<WebhookEvent>,

    @InjectRepository(RafflePurchaseItem)
    private readonly purchaseItemRepo: Repository<RafflePurchaseItem>,
  ) {}

  getPlans() {
    return RAFFLE_ACCESS_PLANS;
  }

  async getRaffleUnlockStatus(creatorId: string, raffleId: string) {
    const raffle = await this.raffleRepo.findOne({
      where: { id: raffleId, creator: { id: creatorId } },
      relations: ['creator'],
    });

    if (!raffle) {
      throw new NotFoundException('Rifa no encontrada');
    }

    const confirmedNumbers = await this.countConfirmedNumbers(raffle.id);

    const latestPaid = await this.accessPaymentRepo.findOne({
      where: {
        raffle: { id: raffle.id },
        status: RaffleAccessPaymentStatus.PAID,
      },
      order: { createdAt: 'DESC' },
    });

    const plan = resolveRaffleAccessPlan(raffle.totalNumbers);

    return {
      raffleId: raffle.id,
      totalNumbers: raffle.totalNumbers,
      confirmedNumbers,
      freeLimit: 20,
      requiresUnlockPayment: confirmedNumbers >= 20 && !latestPaid,
      unlocked: !!latestPaid,
      currentPlan: plan,
      latestPaidUnlock: latestPaid
        ? {
            id: latestPaid.id,
            amount: Number(latestPaid.amount),
            status: latestPaid.status,
            paidAt: latestPaid.paidAt,
          }
        : null,
    };
  }

  async createCheckout(creatorId: string, body: CreateRaffleAccessPaymentDto) {
    const raffle = await this.raffleRepo.findOne({
      where: { id: body.raffleId, creator: { id: creatorId } },
      relations: ['creator'],
    });

    if (!raffle) {
      throw new NotFoundException('Rifa no encontrada');
    }

    const existingPaid = await this.accessPaymentRepo.findOne({
      where: {
        raffle: { id: raffle.id },
        status: RaffleAccessPaymentStatus.PAID,
      },
      order: { createdAt: 'DESC' },
    });

    if (existingPaid) {
      return {
        alreadyUnlocked: true,
        paymentId: existingPaid.id,
        amount: Number(existingPaid.amount),
        status: existingPaid.status,
      };
    }

    const existingPending = await this.accessPaymentRepo.findOne({
      where: {
        raffle: { id: raffle.id },
        status: RaffleAccessPaymentStatus.PENDING,
      },
      order: { createdAt: 'DESC' },
    });

    if (existingPending?.mp_init_point) {
      return {
        paymentId: existingPending.id,
        raffleId: raffle.id,
        amount: Number(existingPending.amount),
        checkoutUrl: existingPending.mp_init_point,
        preferenceId: existingPending.mp_preference_id,
        pendingAlreadyExists: true,
      };
    }

    const mpAccessToken = this.configService.get<string>('MP_ACCESS_TOKEN');
    if (!mpAccessToken) {
      throw new BadRequestException('Falta configurar MP_ACCESS_TOKEN');
    }

    const backendUrl = this.getBackendUrl();
    const frontendUrl = this.getFrontendUrl();
    const plan = resolveRaffleAccessPlan(raffle.totalNumbers);

    const payment = this.accessPaymentRepo.create({
      raffle: { id: raffle.id } as Raffle,
      creator: { id: creatorId } as any,
      planType: plan.key,
      maxNumbers: plan.maxNumbers,
      amount: plan.amount.toFixed(2),
      status: RaffleAccessPaymentStatus.PENDING,
      mp_preference_id: null,
      mp_payment_id: null,
      mp_payment_status: null,
      mp_init_point: null,
      paidAt: null,
      checkoutExpiresAt: null,
    });

    const saved = await this.accessPaymentRepo.save(payment);

    const preference = {
      items: [
        {
          title: `Desbloqueo - Pago por unica vez suscripcion app`,
          quantity: 1,
          unit_price: plan.amount,
          currency_id: 'ARS',
        },
      ],
      external_reference: saved.id,
      notification_url: `${backendUrl}/api/raffle-access-payments/webhook`,
      back_urls: {
        success: `${frontendUrl}/dashboard/raffles/${raffle.id}?unlock=success`,
        failure: `${frontendUrl}/dashboard/raffles/${raffle.id}?unlock=failure`,
        pending: `${frontendUrl}/dashboard/raffles/${raffle.id}?unlock=pending`,
      },
      auto_return: 'approved',
      metadata: {
        type: 'raffle_unlock',
        raffle_id: raffle.id,
        creator_id: creatorId,
        total_numbers: raffle.totalNumbers,
        plan_key: plan.key,
      },
    };

    const response = await firstValueFrom(
      this.httpService.post(
        'https://api.mercadopago.com/checkout/preferences',
        preference,
        {
          headers: {
            Authorization: `Bearer ${mpAccessToken}`,
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    saved.mp_preference_id = response.data?.id || null;
    saved.mp_init_point = response.data?.init_point || null;
    saved.checkoutExpiresAt = response.data?.expiration_date_to
      ? new Date(response.data.expiration_date_to)
      : null;

    await this.accessPaymentRepo.save(saved);

    return {
      paymentId: saved.id,
      raffleId: raffle.id,
      amount: plan.amount,
      plan,
      checkoutUrl: saved.mp_init_point,
      preferenceId: saved.mp_preference_id,
    };
  }

  async processWebhook(rawBody: any, rawQuery: any) {
    const paymentId =
      rawBody?.data?.id ||
      rawBody?.id ||
      rawQuery?.['data.id'] ||
      rawQuery?.id;

    const topic =
      rawBody?.type ||
      rawBody?.topic ||
      rawQuery?.type ||
      rawQuery?.topic ||
      'unknown';

    const event = this.webhookEventRepo.create({
      provider: 'mercadopago',
      externalEventId: paymentId ? String(paymentId) : null,
      eventType: topic ? String(topic) : null,
      payload: {
        body: rawBody || null,
        query: rawQuery || null,
      },
      processed: false,
      processedAt: null,
      errorMessage: null,
    });

    const savedEvent = await this.webhookEventRepo.save(event);

    if (!paymentId) {
      savedEvent.errorMessage = 'Webhook sin paymentId';
      await this.webhookEventRepo.save(savedEvent);
      return null;
    }

    const mpAccessToken = this.configService.get<string>('MP_ACCESS_TOKEN');
    if (!mpAccessToken) {
      savedEvent.errorMessage = 'Falta configurar MP_ACCESS_TOKEN';
      await this.webhookEventRepo.save(savedEvent);
      throw new BadRequestException('Falta configurar MP_ACCESS_TOKEN');
    }

    try {
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
        savedEvent.errorMessage = `Payment ${paymentId} sin external_reference`;
        await this.webhookEventRepo.save(savedEvent);
        return null;
      }

      const unlockPayment = await this.accessPaymentRepo.findOne({
        where: { id: externalReference },
        relations: ['raffle', 'creator'],
      });

      if (!unlockPayment) {
        savedEvent.errorMessage = `No existe raffle_access_payment ${externalReference}`;
        await this.webhookEventRepo.save(savedEvent);
        return null;
      }

      unlockPayment.mp_payment_id = String(paymentId);
      unlockPayment.mp_payment_status = payment?.status
        ? String(payment.status)
        : null;

      const status = String(payment?.status || '');

      if (status === 'approved') {
        unlockPayment.status = RaffleAccessPaymentStatus.PAID;
        unlockPayment.paidAt = payment?.date_approved
          ? new Date(payment.date_approved)
          : new Date();
      } else if (status === 'cancelled') {
        unlockPayment.status = RaffleAccessPaymentStatus.CANCELLED;
      } else if (
        status === 'rejected' ||
        status === 'refunded' ||
        status === 'charged_back'
      ) {
        unlockPayment.status = RaffleAccessPaymentStatus.FAILED;
      } else if (status === 'expired') {
        unlockPayment.status = RaffleAccessPaymentStatus.EXPIRED;
      } else {
        unlockPayment.status = RaffleAccessPaymentStatus.PENDING;
      }

      await this.accessPaymentRepo.save(unlockPayment);

      savedEvent.processed = true;
      savedEvent.processedAt = new Date();
      savedEvent.errorMessage = null;
      await this.webhookEventRepo.save(savedEvent);

      return {
        paymentId: unlockPayment.id,
        raffleId: unlockPayment.raffle.id,
        status: unlockPayment.status,
        mpPaymentStatus: unlockPayment.mp_payment_status,
        paidAt: unlockPayment.paidAt,
      };
    } catch (error: any) {
      savedEvent.errorMessage =
        error?.response?.data
          ? JSON.stringify(error.response.data)
          : error?.message || 'Error desconocido procesando webhook';
      await this.webhookEventRepo.save(savedEvent);
      throw error;
    }
  }

  private async countConfirmedNumbers(raffleId: string) {
    return this.purchaseItemRepo
      .createQueryBuilder('item')
      .innerJoin('item.purchase', 'purchase')
      .innerJoin('purchase.raffle', 'raffle')
      .where('raffle.id = :raffleId', { raffleId })
      .andWhere('purchase.status IN (:...statuses)', {
        statuses: [
          RafflePurchaseStatus.APPROVED,
          RafflePurchaseStatus.AUTO_APPROVED,
        ],
      })
      .getCount();
  }

  private getBackendUrl() {
    return (
      this.configService.get<string>('BACKEND_URL') ||
      this.configService.get<string>('API_BASE_URL') ||
      'http://localhost:3000'
    ).replace(/\/+$/, '');
  }

  private getFrontendUrl() {
    return (
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173'
    ).replace(/\/+$/, '');
  }
}