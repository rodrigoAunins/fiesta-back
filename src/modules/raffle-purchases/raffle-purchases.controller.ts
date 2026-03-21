import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RafflePurchasesService } from './raffle-purchases.service';
import { ReserveRafflePurchaseDto } from './dto/reserve-raffle-purchase.dto';
import { AttachPaymentProofDto } from './dto/attach-payment-proof.dto';
import { ApproveRafflePurchaseDto } from './dto/approve-raffle-purchase.dto';
import { RejectRafflePurchaseDto } from './dto/reject-raffle-purchase.dto';

@Controller('api/raffle-purchases')
export class RafflePurchasesController {
  constructor(
    private readonly rafflePurchasesService: RafflePurchasesService,
  ) {}

  @Post('reserve')
  reserve(@Body() body: ReserveRafflePurchaseDto) {
    return this.rafflePurchasesService.reservePurchase(body);
  }

  @Post(':purchaseId/proof')
  attachProof(
    @Param('purchaseId') purchaseId: string,
    @Body() body: AttachPaymentProofDto,
  ) {
    return this.rafflePurchasesService.attachProof(purchaseId, body);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post(':purchaseId/approve')
  approve(
    @Req() req,
    @Param('purchaseId') purchaseId: string,
    @Body() body: ApproveRafflePurchaseDto,
  ) {
    return this.rafflePurchasesService.approvePurchase(
      req.user.id,
      purchaseId,
      body,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post(':purchaseId/reject')
  reject(
    @Req() req,
    @Param('purchaseId') purchaseId: string,
    @Body() body: RejectRafflePurchaseDto,
  ) {
    return this.rafflePurchasesService.rejectPurchase(
      req.user.id,
      purchaseId,
      body,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('raffle/:raffleId')
  getCreatorPurchases(@Req() req, @Param('raffleId') raffleId: string) {
    return this.rafflePurchasesService.getCreatorPurchases(
      req.user.id,
      raffleId,
    );
  }

  @Get(':purchaseId')
  getOne(@Param('purchaseId') purchaseId: string) {
    return this.rafflePurchasesService.getPurchaseById(purchaseId);
  }
}