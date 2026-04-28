import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FraudModule } from './fraud/fraud.module';
import { TransactionsModule } from './transactions/transactions.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { RedisModule } from './common/redis/redis.module';
import { Transaction } from './transactions/entities/transaction.entity';
import { FlaggedTransaction } from './fraud/entities/flagged-transaction.entity';

const toBoolean = (value: string): boolean => value === 'true';

const toNumber = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric environment value: ${value}`);
  }
  return parsed;
};

const getKafkaModule = () => {
  if (process.env.KAFKA_ENABLED === 'true') {
    const { KafkaModule } = require('./kafka/kafka.module');
    return [KafkaModule];
  }
  return [];
};

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const databaseUrl = cfg.get<string>('DATABASE_URL');

        return {
          type: 'postgres',
          ...(databaseUrl
            ? { url: databaseUrl }
            : {
                host: cfg.getOrThrow<string>('DB_HOST'),
                port: toNumber(cfg.getOrThrow<string>('DB_PORT')),
                username: cfg.getOrThrow<string>('DB_USER'),
                password: cfg.getOrThrow<string>('DB_PASS'),
                database: cfg.getOrThrow<string>('DB_NAME'),
              }),
          entities: [Transaction, FlaggedTransaction],
          synchronize: toBoolean(cfg.getOrThrow<string>('DB_SYNCHRONIZE')),
          logging: toBoolean(cfg.getOrThrow<string>('DB_LOGGING')),
          ssl: toBoolean(cfg.getOrThrow<string>('DB_SSL_ENABLED'))
            ? {
                rejectUnauthorized: toBoolean(
                  cfg.getOrThrow<string>('DB_SSL_REJECT_UNAUTHORIZED'),
                ),
              }
            : false,
          extra: { max: toNumber(cfg.getOrThrow<string>('DB_POOL_MAX')) },
        };
      },
    }),

    RedisModule,
    TransactionsModule,
    FraudModule,
    IngestionModule,
    ...getKafkaModule(),
  ],
})
export class AppModule {}
