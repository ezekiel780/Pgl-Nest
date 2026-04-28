import * as dotenv from 'dotenv';
dotenv.config();

import { DataSource } from 'typeorm';
import { Transaction } from './transactions/entities/transaction.entity';
import { FlaggedTransaction } from './fraud/entities/flagged-transaction.entity';

const toBoolean = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined) return fallback;
  return value === 'true';
};

const toNumber = (value: string | undefined, fallback?: number): number => {
  const parsed = Number(value);

  if (Number.isFinite(parsed)) {
    return parsed;
  }

  if (fallback !== undefined) {
    return fallback;
  }

  throw new Error(`Invalid numeric environment value: ${value}`);
};

const databaseUrl = process.env.DATABASE_URL;
const sslEnabled = toBoolean(process.env.DB_SSL_ENABLED, false);

export const AppDataSource = new DataSource({
  type: (process.env.DB_TYPE || 'postgres') as 'postgres',
  ...(databaseUrl
    ? { url: databaseUrl }
    : {
        host: process.env.DB_HOST,
        port: toNumber(process.env.DB_PORT),
        username: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
      }),

  entities: [Transaction, FlaggedTransaction],

  migrations: ['src/migrations/*.ts'],

  synchronize: toBoolean(process.env.DB_SYNCHRONIZE, false),
  logging: toBoolean(process.env.DB_LOGGING, false),
  ssl: sslEnabled
    ? {
        rejectUnauthorized: toBoolean(
          process.env.DB_SSL_REJECT_UNAUTHORIZED,
          false,
        ),
      }
    : false,
  extra: {
    max: toNumber(process.env.DB_POOL_MAX, 20),
  },
});
