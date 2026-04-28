import * as dotenv from 'dotenv';
dotenv.config();

import { DataSource } from 'typeorm';
import { Transaction } from './transactions/entities/transaction.entity';
import { FlaggedTransaction } from './fraud/entities/flagged-transaction.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  username: process.env.DB_USER,
  password: String(process.env.DB_PASS), // 🔥 FORCE STRING
  database: process.env.DB_NAME,

  entities: [Transaction, FlaggedTransaction],

  migrations: ['src/migrations/*.ts'],

  synchronize: false,
});
