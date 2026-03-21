import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '../../../common/enums/payment-method.enum';

export class ReserveRafflePurchaseAttendeeDto {
  @IsString()
  @MaxLength(160)
  fullName: string;

  @IsString()
  @MaxLength(40)
  phone: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string;
}

export class ReserveRafflePurchaseDto {
  @IsUUID()
  raffleId: string;

  // ===== NUEVO FRONT =====

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReserveRafflePurchaseAttendeeDto)
  attendees?: ReserveRafflePurchaseAttendeeDto[];

  @IsOptional()
  @IsString()
  @MaxLength(40)
  eventType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  tableId?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  seatIds?: string[];

  // ===== LEGACY / BACKWARD COMPAT =====

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  ticketIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(160)
  buyerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  buyerPhone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  buyerEmail?: string;

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @IsOptional()
  @IsUUID()
  sellerId?: string;
}