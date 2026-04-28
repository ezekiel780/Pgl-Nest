import {
  Entity, Column, PrimaryGeneratedColumn,
  Index, CreateDateColumn,
} from 'typeorm';

export enum FraudReason {
  HIGH_VELOCITY        = 'HIGH_VELOCITY',
  DAILY_LIMIT_EXCEEDED = 'DAILY_LIMIT_EXCEEDED',
  GEO_VELOCITY         = 'GEO_VELOCITY',
}

@Entity('flagged_transactions')
@Index(['userId'])
@Index(['transactionId'])
@Index(['reason'])
export class FlaggedTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  @Index()
  transactionId: string;

  @Column({ type: 'varchar', length: 64 })
  @Index()
  userId: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Column({ type: 'timestamptz' })
  timestamp: Date;

  @Column({ type: 'varchar', length: 255 })
  merchant: string;

  @Column({ type: 'varchar', length: 255 })
  location: string;

  @Column({ type: 'float', nullable: true })
  latitude: number;

  @Column({ type: 'float', nullable: true })
  longitude: number;

  @Column({ type: 'enum', enum: FraudReason })
  reason: FraudReason;

  /** Extra context — velocity count, daily total, distance km, etc. */
  @Column({ type: 'jsonb', default: '{}' })
  metadata: Record<string, any>;

  @Column({ type: 'float', default: 1.0 })
  riskScore: number;

  @CreateDateColumn()
  flaggedAt: Date;
}
