import { Module } from '@nestjs/common';
import { FraudGateway } from './fraud.gateway';

@Module({
  providers: [FraudGateway],
  exports: [FraudGateway],
})
export class GatewayModule {}
