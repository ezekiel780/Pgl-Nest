import { Entity, Column, PrimaryColumn, Index, CreateDateColumn } from 'typeorm';

@Entity('transactions')
@Index('IDX_transactions_user_timestamp', ['userId', 'timestamp'])
@Index('IDX_transactions_userId', ['userId'])
@Index('IDX_transactions_timestamp', ['timestamp'])
export class Transaction {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  transactionId: string;

  @Column({ type: 'varchar', length: 64 })
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

  @Column({
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
    select: false,
  })
  geoPoint: string;

  @CreateDateColumn()
  createdAt: Date;
}
