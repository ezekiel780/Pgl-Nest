import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { FraudService, TransactionDto } from '../fraud/fraud.service';
import { FraudGateway } from '../gateway/fraud.gateway';

@Injectable()
export class QueueConsumerService implements OnModuleInit {
  private readonly logger = new Logger(QueueConsumerService.name);
  private worker: Worker;

  constructor(
    private readonly fraudService: FraudService,
    private readonly fraudGateway: FraudGateway,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const connection = this.config.get('REDIS_URL')
      ? { url: this.config.get('REDIS_URL') }
      : {
          host: this.config.get('REDIS_HOST', 'localhost'),
          port: +this.config.get('REDIS_PORT', 6379),
        };

    this.worker = new Worker(
      'transactions',
      async (job) => {
        const txn: TransactionDto = job.data;
        const result = await this.fraudService.analyseTransaction(txn);

        if (result.isFraud) {
          this.logger.warn(
            `FRAUD DETECTED | user=${txn.userId} | reasons=${result.reasons.join(',')} | risk=${result.riskScore}`,
          );

          // Push real-time alert to all connected browser clients
          this.fraudGateway.emitFraudAlert({
            transactionId: txn.transactionId,
            userId:        txn.userId,
            amount:        txn.amount,
            merchant:      txn.merchant,
            location:      txn.location,
            reasons:       result.reasons,
            riskScore:     result.riskScore,
            metadata:      result.metadata,
            timestamp:     new Date().toISOString(),
          });
        }
      },
      {
        connection,
        concurrency: 10, // process 10 jobs at once
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.debug(`Job ${job.id} completed`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} failed: ${err.message}`);
    });

    this.logger.log('BullMQ worker started — listening on queue: transactions');
  }
}
