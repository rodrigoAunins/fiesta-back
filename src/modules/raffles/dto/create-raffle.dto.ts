import {
  IsArray,
  IsBoolean,
  IsHexColor,
  IsInt,
  IsNumber,
  IsNumberString,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

function toOptionalNumber(value: unknown) {
  if (value === '' || value === null || value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

class CreatePrizeDto {
  @IsString()
  @MaxLength(160)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  desc?: string;

  @IsOptional()
  @IsUrl({}, { message: 'El video debe ser una URL válida' })
  video?: string;

  @IsOptional()
  @IsString()
  image?: string;
}

class CreateSeatDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sectionLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  tableLabel?: string;

  @IsOptional()
  @Transform(({ value }) => toOptionalNumber(value))
  @IsNumber()
  x?: number;

  @IsOptional()
  @Transform(({ value }) => toOptionalNumber(value))
  @IsNumber()
  y?: number;

  @IsOptional()
  @Transform(({ value }) => toOptionalNumber(value))
  @IsNumber()
  width?: number;

  @IsOptional()
  @Transform(({ value }) => toOptionalNumber(value))
  @IsNumber()
  height?: number;

  @IsOptional()
  @Transform(({ value }) => toOptionalNumber(value))
  @IsNumber()
  rotation?: number;

  @IsOptional()
  @Transform(({ value }) => toOptionalNumber(value))
  @IsNumber()
  @Min(0)
  priceOverride?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}

export class CreateRaffleDto {
  @IsString()
  @MaxLength(160)
  title: string;

  @IsString()
  drawDate: string;

  @IsOptional()
  @IsNumberString()
  desiredNetGoal?: string;

  @IsOptional()
  @Transform(({ value }) => toOptionalNumber(value))
  @IsInt()
  @Min(0)
  totalNumbers?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  desc?: string;

  @IsOptional()
  @IsNumberString()
  minDraw?: string;

  @IsOptional()
  @Transform(({ value }) => toOptionalNumber(value))
  @IsNumber()
  @Min(0)
  ticketPrice?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  transferAlias?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  allowTransfer?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  allowCash?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  allowGuests?: boolean;

  @IsOptional()
  @Transform(({ value }) => toOptionalNumber(value))
  @IsInt()
  @Min(0)
  guestsPerTicket?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isPaid?: boolean;

  @IsOptional()
  @Transform(({ value }) => toOptionalNumber(value))
  @IsInt()
  @Min(0)
  maxCapacity?: number;

  @IsOptional()
  @Transform(({ value }) => toOptionalNumber(value))
  @IsInt()
  @Min(0)
  estimatedAttendanceCapacity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  eventType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  mode?: string;

  @IsOptional()
  @Transform(({ value }) => toOptionalNumber(value))
  @IsInt()
  @Min(0)
  tableCount?: number;

  @IsOptional()
  @Transform(({ value }) => toOptionalNumber(value))
  @IsInt()
  @Min(0)
  chairsPerTable?: number;

  @IsOptional()
  @IsString()
  coverImage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  themeName?: string;

  @IsOptional()
  @IsHexColor()
  themePrimaryColor?: string;

  @IsOptional()
  @IsHexColor()
  themeSecondaryColor?: string;

  @IsOptional()
  @IsHexColor()
  themeAccentColor?: string;

  @IsOptional()
  @IsHexColor()
  themeTextColor?: string;

  @IsOptional()
  @IsHexColor()
  themeCardColor?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePrizeDto)
  prizes?: CreatePrizeDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSeatDto)
  seats?: CreateSeatDto[];
}