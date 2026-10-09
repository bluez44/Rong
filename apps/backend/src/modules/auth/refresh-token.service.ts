import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import type { AuthConfig } from '../../config/configuration.js';
import { AUTH_CONFIG } from './auth.constants.js';
import { RefreshToken } from './entities/refresh-token.entity.js';

export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
}

/**
 * Vòng đời refresh token trong database: cấp, đổi sang token mới, thu hồi.
 *
 * Mỗi lần dùng, token cũ bị đánh dấu đã dùng và một token mới cùng họ được
 * cấp, hạn tính lại từ đầu (dùng app ít nhất một lần trong REFRESH_TOKEN_TTL_DAYS
 * ngày thì không phải đăng nhập lại). Một token đã dùng mà bị đưa ra lần nữa
 * nghĩa là có hai bên cùng giữ nó (bị lộ), nên cả họ bị thu hồi: kẻ trộm lẫn
 * chủ thật đều phải đăng nhập lại.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    @InjectRepository(RefreshToken)
    private readonly tokens: Repository<RefreshToken>,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  /** Token cho một lần đăng nhập mới (họ mới). Trả về token gốc, thứ không được ghi xuống database. */
  issue(userId: string): Promise<IssuedRefreshToken> {
    return this.insert(userId, randomUUID());
  }

  /**
   * Đổi token sang token mới cùng họ. Trả về null nếu token không tồn tại,
   * hết hạn, đã thu hồi, hay đã dùng (khi đó thu hồi cả họ).
   *
   * Đánh dấu đã dùng bằng một câu UPDATE có điều kiện `used_at IS NULL`, nên
   * hai request cùng một token chạy song song thì chỉ một bên đổi được.
   */
  async rotate(
    token: string,
  ): Promise<{ userId: string; refresh: IssuedRefreshToken } | null> {
    const tokenHash = hashToken(token);
    const result = await this.tokens
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ usedAt: () => 'now()' })
      .where('token_hash = :tokenHash', { tokenHash })
      .andWhere('used_at IS NULL')
      .andWhere('revoked_at IS NULL')
      .andWhere('expires_at > now()')
      .returning('"user_id", "family_id"')
      .execute();

    const row = (
      result.raw as Array<{ user_id: string; family_id: string }>
    )[0];
    if (row !== undefined) {
      return {
        userId: row.user_id,
        refresh: await this.insert(row.user_id, row.family_id),
      };
    }

    const reused = await this.tokens.findOneBy({ tokenHash });
    if (reused?.usedAt && reused.revokedAt === null) {
      this.logger.warn(
        `Refresh token đã dùng bị đưa ra lần nữa (user ${reused.userId}); thu hồi cả họ ${reused.familyId}.`,
      );
      await this.revokeFamily(reused.familyId);
    }
    return null;
  }

  /** Đăng xuất: thu hồi cả họ của token này. Token lạ thì bỏ qua. */
  async revoke(token: string): Promise<void> {
    const row = await this.tokens.findOneBy({ tokenHash: hashToken(token) });
    if (row) await this.revokeFamily(row.familyId);
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.tokens.update(
      { familyId, revokedAt: IsNull() },
      { revokedAt: () => 'now()' },
    );
  }

  private async insert(
    userId: string,
    familyId: string,
  ): Promise<IssuedRefreshToken> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    );
    await this.tokens.insert({
      userId,
      familyId,
      tokenHash: hashToken(token),
      expiresAt,
    });
    return { token, expiresAt };
  }
}

/** SHA-256 trơn là đủ: token có 256 bit ngẫu nhiên, khác mã 6 chữ số của OneTimeTokenService. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
