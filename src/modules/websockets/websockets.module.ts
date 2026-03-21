import { Module } from '@nestjs/common';
import { RifaGateway } from './rifa.gateway';

@Module({
  providers: [RifaGateway],
  exports: [RifaGateway]
})
export class WebsocketsModule {}