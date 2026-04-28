import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transaction } from './entities/transaction.entity';

@Injectable()
export class TransactionsService {
  constructor(
    @InjectRepository(Transaction)
    private readonly repo: Repository<Transaction>,
  ) {}

  async findByUser(userId: string, limit = 100): Promise<Transaction[]> {
    return this.repo.find({
      where: { userId },
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }

  async findById(transactionId: string): Promise<Transaction | null> {
    return this.repo.findOne({ where: { transactionId } });
  }

  async count(): Promise<number> {
    return this.repo.count();
  }
}
