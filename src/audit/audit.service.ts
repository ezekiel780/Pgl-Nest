import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, AuditAction } from './entities/audit-log.entity';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  async log(
    action: AuditAction,
    userId: string,
    userEmail: string,
    metadata: Record<string, any> = {},
    ipAddress?: string,
  ): Promise<void> {
    const entry = this.repo.create({
      action,
      userId,
      userEmail,
      metadata,
      ipAddress,
    });
    await this.repo.save(entry);
  }

  async findAll(page = 1, limit = 50): Promise<{
    data: AuditLog[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const [data, total] = await this.repo.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }
}
