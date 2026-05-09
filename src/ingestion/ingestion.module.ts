import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { IngestionService } from './ingestion.service';
import { IngestionController } from './ingestion.controller';
import { Transaction } from '../transactions/entities/transaction.entity';
import { FraudModule } from '../fraud/fraud.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Transaction]),
    FraudModule,
    QueueModule,
  ],
  controllers: [IngestionController],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class IngestionModule {}
