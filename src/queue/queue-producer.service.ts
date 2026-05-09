import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { TransactionDto } from '../fraud/fraud.service';
import { TRANSACTIONS_QUEUE } from './queue.constants';

@Injectable()
export class QueueProducerService {
  private readonly logger = new Logger(QueueProducerService.name);

  constructor(
    @Inject(TRANSACTIONS_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Add a single transaction job to the queue.
   * BullMQ stores it in Redis — consumer picks it up immediately.
   */
  async publishTransaction(txn: TransactionDto): Promise<void> {
    await this.queue.add('analyse', txn, {
      removeOnComplete: true,
      removeOnFail: 1000,
    });
  }

  /**
   * Batch publish — adds all transactions as individual jobs.
   * BullMQ processes them concurrently based on consumer concurrency setting.
   */
  async publishBatch(txns: TransactionDto[]): Promise<void> {
    const jobs = txns.map((txn) => ({
      name: 'analyse',
      data: txn,
      opts: {
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    }));

    await this.queue.addBulk(jobs);
    this.logger.log(`Published ${txns.length} transactions to BullMQ queue`);
  }
}
