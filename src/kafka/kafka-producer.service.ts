import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import type { Kafka, Producer } from 'kafkajs';
import { TransactionDto } from '../fraud/fraud.service';

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private producer: Producer;

  constructor(@Inject('KAFKA_CLIENT') private readonly kafka: Kafka) {}

  async onModuleInit() {
    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30000,
    });
    await this.producer.connect();
    this.logger.log('Kafka producer connected');
  }

  async onModuleDestroy() {
    await this.producer.disconnect();
  }

  /**
   * Publish a single transaction to the 'transactions' topic.
   * Keyed by userId so all events for the same user go to the same partition
   * — this guarantees ordering for the sliding-window consumer.
   */
  async publishTransaction(txn: TransactionDto): Promise<void> {
    await this.producer.send({
      topic: 'transactions',
      messages: [
        {
          key: txn.userId,                        // same user → same partition
          value: JSON.stringify(txn),
          headers: { source: 'fraud-api', timestamp: Date.now().toString() },
        },
      ],
    });
  }

  /**
   * Batch publish — used by the ingestion service for high-throughput ingest.
   * Groups all messages in a single Kafka batch for efficiency.
   */
  async publishBatch(txns: TransactionDto[]): Promise<void> {
    await this.producer.send({
      topic: 'transactions',
      messages: txns.map((txn) => ({
        key: txn.userId,
        value: JSON.stringify(txn),
        headers: { source: 'fraud-api-batch' },
      })),
    });
    this.logger.log(`Published ${txns.length} transactions to Kafka`);
  }
}
