import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { UserProfile } from '@rong/shared-types';
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
}
