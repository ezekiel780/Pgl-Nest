import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { createReadStream } from 'fs';
import * as fs from 'fs';
import { Transaction } from '../transactions/entities/transaction.entity';
import { FraudService, TransactionDto } from '../fraud/fraud.service';
import { QueueProducerService } from '../queue/queue-producer.service';

export interface IngestionResult {
  processed: number;
  flagged: number;
  errors: number;
  durationMs: number;
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private readonly BATCH_SIZE = 500;

  constructor(
    @InjectRepository(Transaction)
    private readonly txnRepo: Repository<Transaction>,
    private readonly fraudService: FraudService,
    private readonly dataSource: DataSource,
    @Optional() private readonly queue: QueueProducerService,
  ) {
    if (this.queue) {
      this.logger.log('Ingestion mode: BullMQ queue');
    } else {
      this.logger.log('Ingestion mode: direct fraud checks');
    }
  }

  async processJsonFile(filePath: string): Promise<IngestionResult> {
    const start = Date.now();
    const result: IngestionResult = {
      processed: 0,
      flagged: 0,
      errors: 0,
      durationMs: 0,
    };
    this.logger.log(`Ingesting: ${filePath}`);

    return new Promise(async (resolve, reject) => {
      let batch: TransactionDto[] = [];

      const { parser } = await import('stream-json');
      const { streamArray } = await import('stream-json/streamers/StreamArray');

      const pipeline = createReadStream(filePath).pipe(parser()).pipe(streamArray());

      pipeline.on('data', async ({ value }) => {
        batch.push(value);
        if (batch.length >= this.BATCH_SIZE) {
          pipeline.pause();
          const current = [...batch];
          batch = [];
          await this.processBatch(current, result);
          pipeline.resume();
        }
      });

      pipeline.on('end', async () => {
        if (batch.length > 0) await this.processBatch(batch, result);
        result.durationMs = Date.now() - start;
        this.logger.log(
          `Done: ${result.processed} processed, ${result.flagged} flagged in ${result.durationMs}ms`,
        );
        resolve(result);
      });

      pipeline.on('error', reject);
    });
  }

  private async processBatch(
    batch: TransactionDto[],
    result: IngestionResult,
  ): Promise<void> {
    const entities = batch.map((txn) => {
      const { lat, lng } = this.fraudService.parseLocation(txn.location);
      return {
        transactionId: txn.transactionId,
        userId: txn.userId,
        amount: txn.amount,
        timestamp: new Date(txn.timestamp),
        merchant: txn.merchant,
        location: txn.location,
        latitude: lat,
        longitude: lng,
      };
    });

    try {
      await this.dataSource
        .createQueryBuilder()
        .insert()
        .into(Transaction)
        .values(entities)
        .orIgnore()
        .execute();
      result.processed += batch.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Bulk insert error: ${message}`);
      result.errors += batch.length;
      return;
    }

    if (this.queue) {
      try {
        await this.queue.publishBatch(batch);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`BullMQ publish failed (non-fatal): ${message}`);
        await this.runDirectChecks(batch, result);
      }
    } else {
      await this.runDirectChecks(batch, result);
    }
  }

  private async runDirectChecks(
    batch: TransactionDto[],
    result: IngestionResult,
  ): Promise<void> {
    const CONCURRENCY = 20;
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const checks = await Promise.allSettled(
        batch
          .slice(i, i + CONCURRENCY)
          .map((txn) => this.fraudService.analyseTransaction(txn)),
      );
      checks.forEach((r) => {
        if (r.status === 'fulfilled' && r.value.isFraud) result.flagged++;
        if (r.status === 'rejected') result.errors++;
      });
    }
  }

  async ingestBatch(transactions: TransactionDto[]): Promise<IngestionResult> {
    const start = Date.now();
    const result: IngestionResult = {
      processed: 0,
      flagged: 0,
      errors: 0,
      durationMs: 0,
    };
    for (let i = 0; i < transactions.length; i += this.BATCH_SIZE) {
      await this.processBatch(transactions.slice(i, i + this.BATCH_SIZE), result);
    }
    result.durationMs = Date.now() - start;
    return result;
  }

  async generateSampleData(count: number, outputPath: string): Promise<void> {
    const merchants = ['Amazon', 'Walmart', 'Shell', 'Apple Store', 'Starbucks'];
    const locations = [
      '40.7128,-74.0060',
      '34.0522,-118.2437',
      '6.5244,3.3792',
      '51.5074,-0.1278',
      '48.8566,2.3522',
    ];
    const userIds = Array.from({ length: 100 }, (_, i) =>
      `user_${String(i + 1).padStart(4, '0')}`,
    );
    const stream = fs.createWriteStream(outputPath);
    stream.write('[\n');
    for (let i = 0; i < count; i++) {
      const userId = userIds[Math.floor(Math.random() * userIds.length)];
      const txn = {
        transactionId: `txn_${String(i + 1).padStart(8, '0')}`,
        userId,
        amount: parseFloat((Math.random() * 5000 + 1).toFixed(2)),
        timestamp: new Date(Date.now() - Math.random() * 86400000).toISOString(),
        merchant: merchants[Math.floor(Math.random() * merchants.length)],
        location: locations[Math.floor(Math.random() * locations.length)],
      };
      stream.write(JSON.stringify(txn));
      if (i < count - 1) stream.write(',\n');
    }
    stream.write('\n]');
    await new Promise((r) => stream.end(r));
    this.logger.log(`Generated ${count} transactions -> ${outputPath}`);
  }
}
