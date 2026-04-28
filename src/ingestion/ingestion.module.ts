import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IngestionService } from './ingestion.service';
import { IngestionController } from './ingestion.controller';
import { Transaction } from '../transactions/entities/transaction.entity';
import { FraudModule } from '../fraud/fraud.module';

@Module({
  imports: [TypeOrmModule.forFeature([Transaction]), FraudModule],
  controllers: [IngestionController],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class IngestionModule {}
