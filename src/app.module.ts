import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FraudModule } from './fraud/fraud.module';
import { TransactionsModule } from './transactions/transactions.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { RedisModule } from './common/redis/redis.module';
import { KafkaModule } from './kafka/kafka.module';             // ← NEW
import { Transaction } from './transactions/entities/transaction.entity';
import { FlaggedTransaction } from './fraud/entities/flagged-transaction.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        host: cfg.get('DB_HOST', 'localhost'),
        port: +cfg.get('DB_PORT', 5432),
        username: cfg.get('DB_USERNAME', 'fraud_user'),
        password: cfg.get('DB_PASSWORD', 'fraud_pass'),
        database: cfg.get('DB_NAME', 'fraud_db'),
        entities: [Transaction, FlaggedTransaction],
        synchronize: false,
        logging: cfg.get('DB_LOGGING', 'false') === 'true',
        extra: { max: 20 },
      }),
    }),

    RedisModule,
    KafkaModule,           // ← NEW
    TransactionsModule,
    FraudModule,
    IngestionModule,
  ],
})
export class AppModule {}
