import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class FinalizeDrawWinnerDto {
  @IsUUID()
  prizeId: string;

  @IsUUID()
  ticketId: string;

  @IsString()
  @MaxLength(40)
  ticketNumber: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  buyerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  buyerPhone?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  drawOrder: number;
}

export class FinalizeDrawDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FinalizeDrawWinnerDto)
  winners: FinalizeDrawWinnerDto[];
}