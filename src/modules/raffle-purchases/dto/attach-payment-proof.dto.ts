import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AttachPaymentProofDto {
  @IsString()
  fileBase64: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fileMimeType?: string;

  @IsOptional()
  @IsString()
  rawExtractedText?: string;
}