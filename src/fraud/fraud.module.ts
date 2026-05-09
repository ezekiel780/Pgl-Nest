import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FraudService } from './fraud.service';
import { FraudController } from './fraud.controller';
import { FlaggedTransaction } from './entities/flagged-transaction.entity';
import { Transaction } from '../transactions/entities/transaction.entity';
import { GatewayModule } from '../gateway/gateway.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([FlaggedTransaction, Transaction]),
    GatewayModule,
    forwardRef(() => QueueModule),
  ],
  controllers: [FraudController],
  providers: [FraudService],
  exports: [FraudService],
})
export class FraudModule {}
