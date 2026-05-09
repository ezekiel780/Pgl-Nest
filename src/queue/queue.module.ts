import { Module, forwardRef } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { QueueProducerService } from './queue-producer.service';
import { QueueConsumerService } from './queue-consumer.service';
import { FraudModule } from '../fraud/fraud.module';
import { GatewayModule } from '../gateway/gateway.module';
import { TRANSACTIONS_QUEUE } from './queue.constants';

@Module({
  imports: [GatewayModule, forwardRef(() => FraudModule)],
  providers: [
    {
      provide: TRANSACTIONS_QUEUE,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) =>
        new Queue('transactions', {
          connection: cfg.get('REDIS_URL')
            ? { url: cfg.get('REDIS_URL') }
            : {
                host: cfg.get('REDIS_HOST', 'localhost'),
                port: +cfg.get('REDIS_PORT', 6379),
              },
        }),
    },
    QueueProducerService,
    QueueConsumerService,
  ],
  exports: [QueueProducerService],
})
export class QueueModule {}
