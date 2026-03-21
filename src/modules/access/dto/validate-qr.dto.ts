import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ValidateQrDto {
  @IsString()
  @MaxLength(180)
  qrToken: string;

  @IsOptional()
  @IsUUID()
  raffleId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  consumeEntry?: boolean;
}