import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KafkaProducerService } from './kafka-producer.service';
import { KafkaConsumerService } from './kafka-consumer.service';
import { FraudModule } from '../fraud/fraud.module';

const toNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

@Global()
@Module({
  imports: [FraudModule],
  providers: [
    {
      provide: 'KAFKA_CLIENT',
      inject: [ConfigService],
      useFactory: async (cfg: ConfigService) => {
        const { Kafka } = await import('kafkajs');
        return new Kafka({
          clientId: cfg.getOrThrow<string>('KAFKA_CLIENT_ID'),
          brokers: cfg
            .getOrThrow<string>('KAFKA_BROKERS')
            .split(',')
            .map((broker) => broker.trim())
            .filter(Boolean),
          retry: {
            initialRetryTime: toNumber(cfg.get<string>('KAFKA_RETRY_INITIAL_MS'), 300),
            retries: toNumber(cfg.get<string>('KAFKA_RETRY_COUNT'), 8),
          },
          logLevel: toNumber(cfg.get<string>('KAFKA_LOG_LEVEL'), 1),
        });
      },
    },
    KafkaProducerService,
    KafkaConsumerService,
  ],
  exports: [KafkaProducerService],
})
export class KafkaModule {}
