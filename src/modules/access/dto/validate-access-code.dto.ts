import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ValidateAccessCodeDto {
  @IsString()
  @MaxLength(80)
  accessCode: string;

  @IsOptional()
  @IsUUID()
  raffleId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  consumeEntry?: boolean;
}