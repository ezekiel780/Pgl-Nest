import { Test, TestingModule } from '@nestjs/testing';
import { FraudService } from './fraud.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FlaggedTransaction, FraudReason } from './entities/flagged-transaction.entity';
import { Transaction } from '../transactions/entities/transaction.entity';
import { RedisService } from '../common/redis/redis.service';
import { ConfigService } from '@nestjs/config';

const mockFlaggedRepo = {
  create: jest.fn((d) => d),
  save:   jest.fn(),
  findAndCount: jest.fn().mockResolvedValue([[], 0]),
  count:  jest.fn().mockResolvedValue(0),
  createQueryBuilder: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
  }),
};

const mockRedis = {
  slidingWindowCount: jest.fn().mockResolvedValue(1),
  getDailyTotal:      jest.fn().mockResolvedValue(0),
  getLastLocation:    jest.fn().mockResolvedValue(null),
  incrementDailyTotal: jest.fn().mockResolvedValue(100),
  setLastLocation:    jest.fn().mockResolvedValue(undefined),
};

const mockConfig = {
  get: (key: string, def: any) =>
    ({ FRAUD_MAX_TXN_PER_MINUTE: '5', FRAUD_MAX_DAILY_AMOUNT: '10000',
       FRAUD_LOCATION_WINDOW_MINUTES: '2' }[key] ?? def),
};

const baseTxn = {
  transactionId: 'txn_001', userId: 'user_001', amount: 100,
  timestamp: new Date().toISOString(), merchant: 'Amazon',
  location: '40.7128,-74.0060',
};

describe('FraudService', () => {
  let service: FraudService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FraudService,
        { provide: getRepositoryToken(FlaggedTransaction), useValue: mockFlaggedRepo },
        { provide: getRepositoryToken(Transaction),        useValue: {} },
        { provide: RedisService,   useValue: mockRedis },
        { provide: ConfigService,  useValue: mockConfig },
      ],
    }).compile();
    service = module.get<FraudService>(FraudService);
    jest.clearAllMocks();
  });

  it('clean transaction → isFraud=false', async () => {
    const result = await service.analyseTransaction(baseTxn);
    expect(result.isFraud).toBe(false);
  });

  it('flags HIGH_VELOCITY when count > 5', async () => {
    mockRedis.slidingWindowCount.mockResolvedValue(6);
    const result = await service.analyseTransaction(baseTxn);
    expect(result.isFraud).toBe(true);
    expect(result.reasons).toContain(FraudReason.HIGH_VELOCITY);
  });

  it('flags DAILY_LIMIT_EXCEEDED when total > $10,000', async () => {
    mockRedis.getDailyTotal.mockResolvedValue(9950);
    const result = await service.analyseTransaction({ ...baseTxn, amount: 100 });
    expect(result.reasons).toContain(FraudReason.DAILY_LIMIT_EXCEEDED);
  });

  it('flags GEO_VELOCITY when location changes within 2 minutes', async () => {
    mockRedis.getLastLocation.mockResolvedValue({
      lat: 34.0522, lng: -118.2437, // LA
      ts: Date.now() - 60_000,      // 1 min ago
    });
    // New York — ~4,000 km from LA
    const result = await service.analyseTransaction({ ...baseTxn, location: '40.7128,-74.0060' });
    expect(result.reasons).toContain(FraudReason.GEO_VELOCITY);
  });

  it('does NOT flag GEO_VELOCITY if previous location is outside window', async () => {
    mockRedis.getLastLocation.mockResolvedValue({
      lat: 34.0522, lng: -118.2437,
      ts: Date.now() - 10 * 60_000, // 10 min ago — outside 2-min window
    });
    const result = await service.analyseTransaction(baseTxn);
    expect(result.reasons).not.toContain(FraudReason.GEO_VELOCITY);
  });

  describe('parseLocation', () => {
    it('parses valid lat,lng strings', () => {
      expect(service.parseLocation('40.7128,-74.0060')).toEqual({ lat: 40.7128, lng: -74.006 });
    });
    it('returns nulls for non-coordinate strings', () => {
      expect(service.parseLocation('Lagos')).toEqual({ lat: null, lng: null });
    });
  });
});
