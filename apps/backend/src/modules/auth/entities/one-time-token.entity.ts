import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { AuthIdentity } from './auth-identity.entity.js';

export const ONE_TIME_TOKEN_PURPOSES = [
  'email_verification',
  'password_reset',
] as const;
export type OneTimeTokenPurpose = (typeof ONE_TIME_TOKEN_PURPOSES)[number];

/**
 * Token dùng một lần gửi qua email: xác minh email, và sau này là đặt lại mật
 * khẩu. Chỉ lưu SHA-256 của token — lộ database cũng không có link dùng được.
 */
@Entity('one_time_tokens')
@Index('idx_one_time_token_identity', ['identityId', 'purpose'])
export class OneTimeToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'identity_id', type: 'uuid' })
  identityId!: string;

  @ManyToOne(() => AuthIdentity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'identity_id',
    foreignKeyConstraintName: 'fk_one_time_token_identity',
  })
  identity?: AuthIdentity;

  @Column({
    name: 'purpose',
    type: 'enum',
    enum: ONE_TIME_TOKEN_PURPOSES,
    enumName: 'one_time_token_purpose',
  })
  purpose!: OneTimeTokenPurpose;

  @Column({ name: 'token_hash', type: 'text', unique: true })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
