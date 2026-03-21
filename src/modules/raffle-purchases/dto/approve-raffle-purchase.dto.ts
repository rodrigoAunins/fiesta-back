import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveRafflePurchaseDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewNotes?: string;
}