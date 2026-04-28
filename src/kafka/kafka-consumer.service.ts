import {
  Injectable, Inject, Logger,
  OnModuleInit, OnModuleDestroy,
} from '@nestjs/common';
import type { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { FraudService, TransactionDto } from '../fraud/fraud.service';

@Injectable()
export class KafkaConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerService.name);
  private consumer: Consumer;
  private isRunning = false;

  constructor(
    @Inject('KAFKA_CLIENT') private readonly kafka: Kafka,
    private readonly fraudService: FraudService,
  ) {}

  async onModuleInit() {
    this.consumer = this.kafka.consumer({
      groupId: 'fraud-detection-group',
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxBytesPerPartition: 1048576, // 1MB per partition per fetch
    });

    await this.consumer.connect();

    await this.consumer.subscribe({
      topic: 'transactions',
      fromBeginning: false, // only new messages
    });

    this.isRunning = true;
    this.logger.log('Kafka consumer connected → topic: transactions');

    // Run the consumer loop in the background
    this.consumer
      .run({
        partitionsConsumedConcurrently: 4,  // process 4 partitions at once
        eachMessage: (payload) => this.handleMessage(payload),
      })
      .catch((err) => this.logger.error(`Consumer error: ${err.message}`));
  }

  private async handleMessage(payload: EachMessagePayload): Promise<void> {
    const { topic, partition, message } = payload;

    if (!message.value) return;

    try {
      const txn: TransactionDto = JSON.parse(message.value.toString());

      const result = await this.fraudService.analyseTransaction(txn);

      if (result.isFraud) {
        this.logger.warn(
          `FRAUD DETECTED | user=${txn.userId} | reasons=${result.reasons.join(',')} | risk=${result.riskScore} | partition=${partition} | offset=${message.offset}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to process message offset=${message.offset} partition=${partition}: ${err.message}`,
      );
    }
  }

  async onModuleDestroy() {
    this.isRunning = false;
    await this.consumer.disconnect();
    this.logger.log('Kafka consumer disconnected');
  }
}
