import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { User } from '../../users/entities/user.entity.js';

export const AUTH_PROVIDERS = ['password', 'google', 'apple'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

/**
 * Một cách người dùng chứng minh danh tính. Một `user` có nhiều identity.
 *
 * Thêm Google sau này chỉ là insert một dòng `provider='google'` trỏ về cùng
 * `user_id` (tìm qua `email` đã xác minh), không cần migration.
 */
@Entity('auth_identities')
@Unique('uq_identity_provider_account', ['provider', 'providerAccountId'])
@Check(
  'chk_password_needs_hash',
  `"provider" <> 'password' OR "password_hash" IS NOT NULL`,
)
export class AuthIdentity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_identity_user')
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, (user) => user.identities, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'fk_identity_user' })
  user?: User;

  @Column({
    name: 'provider',
    type: 'enum',
    enum: AUTH_PROVIDERS,
    enumName: 'auth_provider',
  })
  provider!: AuthProvider;

  /** Email đã chuẩn hóa với `password`; `sub` của nhà cung cấp với OAuth. */
  @Column({ name: 'provider_account_id', type: 'text' })
  providerAccountId!: string;

  /** Đã chuẩn hóa. Không unique: một người có thể có identity password và google cùng email. */
  @Index('idx_identity_email')
  @Column({ name: 'email', type: 'text', nullable: true })
  email!: string | null;

  /** NULL nghĩa là chưa xác minh — identity `password` chưa xác minh thì không đăng nhập được. */
  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt!: Date | null;

  /** Chỉ có với `provider='password'`. */
  @Column({ name: 'password_hash', type: 'text', nullable: true })
  passwordHash!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
