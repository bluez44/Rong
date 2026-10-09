import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity.js';

/**
 * Refresh token giữ đăng nhập (F11). Mỗi lần dùng thì đổi sang token mới cùng
 * `familyId`; xem RefreshTokenService. Chỉ lưu SHA-256 của token.
 */
@Entity('refresh_tokens')
@Index('idx_refresh_token_family', ['familyId'])
@Index('idx_refresh_token_user', ['userId'])
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'fk_refresh_token_user',
  })
  user?: User;

  /** Chuỗi token sinh ra từ cùng một lần đăng nhập; thu hồi thì thu hồi cả họ. */
  @Column({ name: 'family_id', type: 'uuid' })
  familyId!: string;

  @Column({ name: 'token_hash', type: 'text', unique: true })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  /** Đã đổi sang token mới. Đưa ra lần nữa là dùng lại token. */
  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
