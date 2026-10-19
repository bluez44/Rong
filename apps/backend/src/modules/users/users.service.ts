import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { PlaceCategory, UserProfile } from '@rong/shared-types';
import { Repository } from 'typeorm';

import type { AuthIdentity } from '../auth/entities/auth-identity.entity.js';
import { User } from './entities/user.entity.js';

/**
 * Email hiển thị của một user: ưu tiên email đã xác minh, vì khi có nhiều
 * identity (password + google) chúng có thể khác nhau.
 */
export function toProfile(user: User, identities: AuthIdentity[]): UserProfile {
  const primary =
    identities.find((identity) => identity.email && identity.emailVerifiedAt) ??
    identities.find((identity) => identity.email);

  return {
    id: user.id,
    displayName: user.displayName,
    email: primary?.email ?? null,
    emailVerified: primary?.emailVerifiedAt != null,
    createdAt: user.createdAt.toISOString(),
    interests: user.interests ?? [],
  };
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async getProfile(userId: string): Promise<UserProfile> {
    const user = await this.users.findOne({
      where: { id: userId },
      relations: { identities: true },
    });

    // Token còn hạn nhưng tài khoản đã bị xóa.
    if (user === null) {
      throw new UnauthorizedException();
    }
    return toProfile(user, user.identities ?? []);
  }

  /**
   * Đổi tên hiển thị và/hoặc sở thích. `interestsChanged` để nơi gọi đẩy job
   * sinh lại chủ đề gợi ý (spec 2026-10-19-home-recommendations).
   */
  async updateProfile(
    userId: string,
    patch: { displayName?: string; interests?: PlaceCategory[] },
  ): Promise<{ profile: UserProfile; interestsChanged: boolean }> {
    if (patch.displayName === undefined && patch.interests === undefined) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'EMPTY_UPDATE',
        message: 'Không có gì để cập nhật.',
      });
    }
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new UnauthorizedException();

    const interests =
      patch.interests === undefined ? undefined : [...new Set(patch.interests)];
    const interestsChanged =
      interests !== undefined &&
      (interests.length !== user.interests.length ||
        interests.some((c) => !user.interests.includes(c)));

    await this.users.update(userId, {
      ...(patch.displayName !== undefined && {
        displayName: patch.displayName,
      }),
      ...(interests !== undefined && { interests }),
    });
    return { profile: await this.getProfile(userId), interestsChanged };
  }

  /**
   * Xóa hẳn, không xóa mềm: mọi bảng tham chiếu user (auth_identities →
   * one_time_tokens, itineraries, saved_places) đều ON DELETE CASCADE.
   */
  async deleteAccount(userId: string): Promise<void> {
    await this.users.delete(userId);
  }
}
