import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';

import {
  OneTimeToken,
  type OneTimeTokenPurpose,
} from './entities/one-time-token.entity.js';

/**
 * SHA-256 chứ không phải argon2: token là 256 bit ngẫu nhiên do máy sinh,
 * không có không gian nhỏ để dò, nên băm chậm chỉ tốn thời gian vô ích.
 */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

@Injectable()
export class OneTimeTokenService {
  constructor(
    @InjectRepository(OneTimeToken)
    private readonly tokens: Repository<OneTimeToken>,
  ) {}

  /**
   * Sinh token mới và vô hiệu hóa mọi token cũ chưa dùng cùng mục đích, để chỉ
   * link trong email mới nhất còn hiệu lực. Trả về token gốc — thứ duy nhất
   * không bao giờ được ghi xuống database.
   */
  async issue(
    identityId: string,
    purpose: OneTimeTokenPurpose,
    ttlMs: number,
  ): Promise<string> {
    await this.tokens.delete({ identityId, purpose, usedAt: IsNull() });

    const raw = randomBytes(32).toString('base64url');
    await this.tokens.insert({
      identityId,
      purpose,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + ttlMs),
    });
    return raw;
  }

  /**
   * Đánh dấu token đã dùng và trả về identity mà nó thuộc về, hoặc null nếu
   * token sai, hết hạn hay đã dùng. Một câu UPDATE duy nhất nên hai request
   * đồng thời với cùng token không thể cùng thành công.
   */
  async consume(
    raw: string,
    purpose: OneTimeTokenPurpose,
  ): Promise<string | null> {
    const result = await this.tokens
      .createQueryBuilder()
      .update(OneTimeToken)
      .set({ usedAt: () => 'now()' })
      .where('token_hash = :hash', { hash: hashToken(raw) })
      .andWhere('purpose = :purpose', { purpose })
      .andWhere('used_at IS NULL')
      .andWhere('expires_at > now()')
      .returning('identity_id')
      .execute();

    const row = (result.raw as Array<{ identity_id: string }>)[0];
    return row?.identity_id ?? null;
  }

  /** Có token nào cùng mục đích được sinh trong khoảng `withinMs` vừa qua không. */
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
}
