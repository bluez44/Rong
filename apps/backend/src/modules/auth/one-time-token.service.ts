import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';

import type { AuthConfig } from '../../config/configuration.js';
import { AUTH_CONFIG } from './auth.constants.js';
import {
  OneTimeToken,
  type OneTimeTokenPurpose,
} from './entities/one-time-token.entity.js';

/**
 * Số lần nhập sai tối đa cho một mã. Mã 6 chữ số chỉ có 1.000.000 khả năng,
 * nên giới hạn này mới là thứ khiến việc dò mã vô vọng (5 / 1.000.000).
 */
export const MAX_CODE_ATTEMPTS = 5;

@Injectable()
export class OneTimeTokenService {
  constructor(
    @InjectRepository(OneTimeToken)
    private readonly tokens: Repository<OneTimeToken>,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  /**
   * Sinh mã 6 chữ số mới và xóa mọi mã cũ chưa dùng cùng mục đích, để mỗi
   * identity chỉ có tối đa một mã còn hiệu lực. Trả về mã gốc — thứ không bao
   * giờ được ghi xuống database.
   */
  async issueCode(
    identityId: string,
    purpose: OneTimeTokenPurpose,
    ttlMs: number,
  ): Promise<string> {
    await this.tokens.delete({ identityId, purpose, usedAt: IsNull() });

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.tokens.insert({
      identityId,
      purpose,
      tokenHash: this.hashCode(identityId, purpose, code),
      expiresAt: new Date(Date.now() + ttlMs),
    });
    return code;
  }

  /**
   * Kiểm tra mã và đánh dấu đã dùng nếu đúng.
   *
   * Mỗi lần thử (kể cả lần đúng) tăng `attempts` bằng một câu UPDATE có điều
   * kiện `attempts < MAX` trước khi so mã. Dòng bị khóa trong lúc UPDATE, nên
   * dù bắn hàng trăm request song song cũng chỉ tối đa MAX lần được so.
   */
  async verifyCode(
    identityId: string,
    purpose: OneTimeTokenPurpose,
    code: string,
  ): Promise<boolean> {
    const attempt = await this.tokens
      .createQueryBuilder()
      .update(OneTimeToken)
      .set({ attempts: () => 'attempts + 1' })
      .where('identity_id = :identityId', { identityId })
      .andWhere('purpose = :purpose', { purpose })
      .andWhere('used_at IS NULL')
      .andWhere('expires_at > now()')
      .andWhere('attempts < :max', { max: MAX_CODE_ATTEMPTS })
      .returning('"id", "token_hash"')
      .execute();

    const row = (attempt.raw as Array<{ id: string; token_hash: string }>)[0];
    if (row === undefined) {
      return false;
    }

    const expected = Buffer.from(row.token_hash, 'hex');
    const actual = Buffer.from(this.hashCode(identityId, purpose, code), 'hex');
    if (!timingSafeEqual(expected, actual)) {
      return false;
    }

    const used = await this.tokens.update(
      { id: row.id, usedAt: IsNull() },
      { usedAt: () => 'now()' },
    );
    return used.affected === 1;
  }

  /** Có mã nào cùng mục đích được sinh trong khoảng `withinMs` vừa qua không. */
  async issuedRecently(
    identityId: string,
    purpose: OneTimeTokenPurpose,
    withinMs: number,
  ): Promise<boolean> {
    return this.tokens.exists({
      where: {
        identityId,
        purpose,
        createdAt: MoreThan(new Date(Date.now() - withinMs)),
      },
    });
  }

  /**
   * HMAC với khóa bí mật chứ không phải SHA-256 trơn: 6 chữ số chỉ có một
   * triệu khả năng, lộ database thì SHA-256 dò ngược ra ngay. Gắn identity và
   * mục đích vào đầu vào để hai người trùng mã vẫn ra hai hash khác nhau.
   */
  private hashCode(
    identityId: string,
    purpose: OneTimeTokenPurpose,
    code: string,
  ): string {
    return createHmac('sha256', this.config.jwtSecret)
      .update(`${identityId}:${purpose}:${code}`)
      .digest('hex');
  }
}
