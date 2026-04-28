import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KafkaProducerService } from './kafka-producer.service';
import { KafkaConsumerService } from './kafka-consumer.service';
import { FraudModule } from '../fraud/fraud.module';

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
          clientId: 'fraud-detection',
          brokers: cfg.get('KAFKA_BROKERS', 'localhost:9092').split(','),
          retry: { initialRetryTime: 300, retries: 8 },
          logLevel: 1, // WARN only — suppress INFO noise
        });
      },
    },
    KafkaProducerService,
    KafkaConsumerService,
  ],
  exports: [KafkaProducerService],
})
export class KafkaModule {}
