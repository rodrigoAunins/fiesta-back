import { IsUUID, IsOptional, IsBoolean } from 'class-validator';

export class CreateRaffleAccessPaymentDto {
  @IsUUID()
  raffleId: string;

  @IsOptional()
  @IsBoolean()
  forceUnlock?: boolean;

  @IsOptional()
  @IsBoolean()
  allowEarlyUnlock?: boolean;

  @IsOptional()
  @IsBoolean()
  ignoreFreeLimit?: boolean;

  @IsOptional()
  @IsBoolean()
  payBeforeThreshold?: boolean;
}