import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectRafflePurchaseDto {
  @IsString()
  @MaxLength(1000)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewNotes?: string;
}