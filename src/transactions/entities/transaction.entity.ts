import { Entity, Column, PrimaryColumn, Index, CreateDateColumn } from 'typeorm';

@Entity('transactions')
@Index(['userId', 'timestamp'])
@Index(['userId'])
export class Transaction {
  @PrimaryColumn({ name: 'transaction_id', type: 'varchar', length: 64 })
  transactionId: string;

  @Column({ name: 'user_id', type: 'varchar', length: 64 })
  @Index()
  userId: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Column({ type: 'timestamptz' })
  @Index()
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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
