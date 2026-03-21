import { IsIn, IsOptional } from 'class-validator';

export class AdminOverviewQueryDto {
  @IsOptional()
  @IsIn(['7d', '30d', '90d'])
  range?: '7d' | '30d' | '90d';
}