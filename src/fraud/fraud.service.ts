import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNumber, IsString } from 'class-validator';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { getDistance } from 'geolib';
import { format } from 'date-fns';
import { FlaggedTransaction, FraudReason } from './entities/flagged-transaction.entity';
import { AnalyseFraudDto } from './dto/analyse-fraud.dto';
import { Transaction } from '../transactions/entities/transaction.entity';
import { RedisService } from '../common/redis/redis.service';

export class TransactionDto {
  @IsString()
  transactionId: string;

  @IsString()
  userId: string;

  @IsNumber()
  amount: number;

  @IsString()
  timestamp: string | Date;

  @IsString()
  merchant: string;

  @IsString()
  location: string;
}

export interface FraudCheckResult {
  isFraud: boolean;
  reasons: FraudReason[];
  riskScore: number;
  metadata: Record<string, any>;
}

@Injectable()
export class FraudService {
  private readonly logger = new Logger(FraudService.name);
  private readonly MAX_TXN_PER_MINUTE: number;
  private readonly MAX_DAILY_AMOUNT: number;
  private readonly GEO_WINDOW_MS: number;

  constructor(
    @InjectRepository(FlaggedTransaction)
    private readonly flaggedRepo: Repository<FlaggedTransaction>,
    @InjectRepository(Transaction)
    private readonly txnRepo: Repository<Transaction>,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    this.MAX_TXN_PER_MINUTE = +this.config.get('FRAUD_MAX_TXN_PER_MINUTE', 5);
    this.MAX_DAILY_AMOUNT   = +this.config.get('FRAUD_MAX_DAILY_AMOUNT', 10000);
    this.GEO_WINDOW_MS      = +this.config.get('FRAUD_LOCATION_WINDOW_MINUTES', 2) * 60 * 1000;
  }

  async analyse(dto: AnalyseFraudDto) {
    const reasons: string[] = [];
    let riskScore = 0;

    // BASIC RULES (real logic, no hardcoding response)

    // 1. High amount rule
    if (dto.amount >= 1000) {
      reasons.push('HIGH_AMOUNT');
      riskScore += 40;
    }

    // 2. Geo missing check
    if (!dto.latitude || !dto.longitude) {
      reasons.push('MISSING_GEO');
      riskScore += 20;
    }

    // 3. Time sanity check (future timestamp)
    const txTime = new Date(dto.timestamp).getTime();
    const now = Date.now();

    if (txTime > now) {
      reasons.push('FUTURE_TRANSACTION');
      riskScore += 30;
    }

    return {
      isFraud: riskScore >= 70,
      reasons,
      riskScore,
      metadata: {
        evaluatedAt: new Date().toISOString(),
      },
    };
  }

  /** Main entry point — runs all 3 rules in parallel. */
  async analyseTransaction(txn: TransactionDto): Promise<FraudCheckResult> {
    const ts    = new Date(txn.timestamp);
    const nowMs = ts.getTime();
    const dateKey = format(ts, 'yyyy-MM-dd');
    const { lat, lng } = this.parseLocation(txn.location);

    const result: FraudCheckResult = {
      isFraud: false, reasons: [], riskScore: 0, metadata: {},
    };

    // All three checks run at the same time
    await Promise.all([
      this.checkVelocity(txn, nowMs, result),
      this.checkDailyLimit(txn, dateKey, result),
      this.checkGeoVelocity(txn, lat, lng, nowMs, result),
    ]);

    // Update Redis AFTER checks so this txn counts in the NEXT request
    await this.updateState(txn, lat, lng, nowMs, dateKey);

    if (result.isFraud) {
      await this.persist(txn, ts, lat, lng, result);
    }

    return result;
  }

  // ── Rule 1: Velocity ─────────────────────────────────────────────────────
  private async checkVelocity(
    txn: TransactionDto, nowMs: number, result: FraudCheckResult,
  ): Promise<void> {
    const count = await this.redis.slidingWindowCount(
      `vel:${txn.userId}`, txn.transactionId, nowMs, 60_000, 300,
    );
    if (count > this.MAX_TXN_PER_MINUTE) {
      result.isFraud = true;
      result.reasons.push(FraudReason.HIGH_VELOCITY);
      result.metadata.velocityCount = count;
      result.riskScore = Math.max(result.riskScore, 0.85);
      this.logger.warn(`HIGH_VELOCITY user=${txn.userId} count=${count}`);
    }
  }

  // ── Rule 2: Daily limit ──────────────────────────────────────────────────
  private async checkDailyLimit(
    txn: TransactionDto, dateKey: string, result: FraudCheckResult,
  ): Promise<void> {
    const current  = await this.redis.getDailyTotal(txn.userId, dateKey);
    const newTotal = current + Number(txn.amount);
    if (newTotal > this.MAX_DAILY_AMOUNT) {
      result.isFraud = true;
      result.reasons.push(FraudReason.DAILY_LIMIT_EXCEEDED);
      result.metadata.dailyTotal = newTotal;
      result.metadata.dailyLimit = this.MAX_DAILY_AMOUNT;
      result.riskScore = Math.max(result.riskScore, 0.75);
      this.logger.warn(`DAILY_LIMIT user=${txn.userId} total=${newTotal}`);
    }
  }

  // ── Rule 3: Geo-velocity ─────────────────────────────────────────────────
  private async checkGeoVelocity(
    txn: TransactionDto,
    lat: number | null,
    lng: number | null,
    nowMs: number,
    result: FraudCheckResult,
  ): Promise<void> {
    if (lat === null || lng === null) return;
    const last = await this.redis.getLastLocation(txn.userId);
    if (!last) return;
    if (nowMs - last.ts > this.GEO_WINDOW_MS) return; // outside window

    const distanceMeters = getDistance(
      { latitude: last.lat, longitude: last.lng },
      { latitude: lat, longitude: lng },
    );

    if (distanceMeters > 1000) {
      result.isFraud = true;
      result.reasons.push(FraudReason.GEO_VELOCITY);
      result.metadata.distanceKm      = (distanceMeters / 1000).toFixed(2);
      result.metadata.timeDiffSeconds = ((nowMs - last.ts) / 1000).toFixed(1);
      result.metadata.prevLocation    = `${last.lat},${last.lng}`;
      result.riskScore = Math.max(result.riskScore, 0.95);
      this.logger.warn(`GEO_VELOCITY user=${txn.userId} dist=${distanceMeters}m`);
    }
  }

  // ── Update Redis state ───────────────────────────────────────────────────
  private async updateState(
    txn: TransactionDto, lat: number | null,
    lng: number | null, nowMs: number, dateKey: string,
  ): Promise<void> {
    const tasks: Promise<any>[] = [
      this.redis.incrementDailyTotal(txn.userId, dateKey, Number(txn.amount)),
    ];
    if (lat !== null && lng !== null) {
      tasks.push(this.redis.setLastLocation(txn.userId, lat, lng, nowMs, 300));
    }
    await Promise.all(tasks);
  }

  // ── Persist flags ────────────────────────────────────────────────────────
  private async persist(
    txn: TransactionDto, ts: Date,
    lat: number | null, lng: number | null,
    result: FraudCheckResult,
  ): Promise<void> {
    const entities = result.reasons.map((reason) =>
      this.flaggedRepo.create({
        transactionId: txn.transactionId,
        userId:        txn.userId,
        amount:        txn.amount,
        timestamp:     ts,
        merchant:      txn.merchant,
        location:      txn.location,
        latitude:      lat,
        longitude:     lng,
        reason,
        metadata:      result.metadata,
        riskScore:     result.riskScore,
      }),
    );
    await this.flaggedRepo.save(entities, { chunk: 100 });
  }

  // ── API helpers ──────────────────────────────────────────────────────────
  async getFlaggedByUser(userId: string, page = 1, limit = 50) {
    const [data, total] = await this.flaggedRepo.findAndCount({
      where: { userId },
      order: { flaggedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      data, total, page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getAllFlagged(page = 1, limit = 100, reason?: FraudReason) {
    const where: any = {};
    if (reason) where.reason = reason;
    const [data, total] = await this.flaggedRepo.findAndCount({
      where,
      order: { flaggedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total };
  }

  async getHeatmapData() {
    return this.flaggedRepo
      .createQueryBuilder('f')
      .select('f.userId', 'userId')
      .addSelect('f.latitude', 'lat')
      .addSelect('f.longitude', 'lng')
      .addSelect('COUNT(*)', 'count')
      .where('f.latitude IS NOT NULL')
      .andWhere('f.longitude IS NOT NULL')
      .groupBy('f.userId, f.latitude, f.longitude')
      .orderBy('count', 'DESC')
      .limit(500)
      .getRawMany()
      .then((rows) =>
        rows.map((r) => ({
          userId: r.userId,
          lat:    parseFloat(r.lat),
          lng:    parseFloat(r.lng),
          count:  parseInt(r.count, 10),
        })),
      );
  }

  async getStats() {
    const total = await this.flaggedRepo.count();
    const byReason = await this.flaggedRepo
      .createQueryBuilder('f')
      .select('f.reason', 'reason')
      .addSelect('COUNT(*)', 'count')
      .groupBy('f.reason')
      .getRawMany();
    const topUsers = await this.flaggedRepo
      .createQueryBuilder('f')
      .select('f.userId', 'userId')
      .addSelect('COUNT(*)', 'count')
      .addSelect('MAX(f.riskScore)', 'maxRisk')
      .groupBy('f.userId')
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany();
    return { total, byReason, topUsers };
  }

  // ── Utility ──────────────────────────────────────────────────────────────
  parseLocation(location: string): { lat: number | null; lng: number | null } {
    if (!location) return { lat: null, lng: null };
    const parts = location.split(',').map((s) => parseFloat(s.trim()));
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return { lat: parts[0], lng: parts[1] };
    }
    return { lat: null, lng: null };
  }
}
