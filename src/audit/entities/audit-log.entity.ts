import {
  Entity, Column, PrimaryGeneratedColumn,
  CreateDateColumn, Index,
} from 'typeorm';

export enum AuditAction {
  LOGIN             = 'LOGIN',
  LOGOUT            = 'LOGOUT',
  REGISTER          = 'REGISTER',
  PASSWORD_CHANGED  = 'PASSWORD_CHANGED',
  PASSWORD_RESET    = 'PASSWORD_RESET',
  ROLE_CHANGED      = 'ROLE_CHANGED',
  STATUS_CHANGED    = 'STATUS_CHANGED',
  PROFILE_UPDATED   = 'PROFILE_UPDATED',
}

@Entity('audit_logs')
@Index('IDX_audit_userId', ['userId'])
@Index('IDX_audit_action', ['action'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  userId: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  userEmail: string;

  @Column({ type: 'enum', enum: AuditAction })
  action: AuditAction;

  @Column({ type: 'jsonb', default: '{}' })
  metadata: Record<string, any>;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string;

  @CreateDateColumn()
  createdAt: Date;
}
