import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { AuthIdentity } from '../../auth/entities/auth-identity.entity.js';

/**
 * Một con người. Cách người đó đăng nhập (mật khẩu, Google, Apple…) nằm ở
 * `auth_identities`, không nằm ở đây — xem spec S1 mục 2.1.
 */
@Entity('users')
@Index('idx_users_guest_last_seen', ['isGuest', 'lastSeenAt'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'display_name', type: 'text', nullable: true })
  displayName!: string | null;

  /** Chưa dùng: dành cho luồng tài khoản dùng thử (spec S1 mục 5). */
  @Column({ name: 'is_guest', type: 'boolean', default: false })
  isGuest!: boolean;

  /** FR-6.5 — hạn mức lượt tạo lịch trình AI mỗi tháng. Thực thi ở S6. */
  @Column({ name: 'ai_generations_used', type: 'int', default: 0 })
  aiGenerationsUsed!: number;

  @Column({ name: 'ai_quota_period_start', type: 'date', nullable: true })
  aiQuotaPeriodStart!: string | null;

  @Column({ name: 'last_seen_at', type: 'timestamptz', default: () => 'now()' })
  lastSeenAt!: Date;

  @OneToMany('AuthIdentity', (identity: AuthIdentity) => identity.user)
  identities?: AuthIdentity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
