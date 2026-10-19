import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import type { UserProfile } from '@rong/shared-types';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { RecommendationsQueue } from '../recommendations/queue/recommendations-queue.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly recommendations: RecommendationsQueue,
  ) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<UserProfile> {
    return this.users.getProfile(user.userId);
  }

  @Patch('me')
  async update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfile> {
    const { profile, interestsChanged } = await this.users.updateProfile(user.userId, dto);
    if (interestsChanged) {
      await this.recommendations.enqueue({
        name: 'generate-user-themes',
        data: { userId: user.userId },
      });
    }
    return profile;
  }

  /** F11: xóa tài khoản và toàn bộ dữ liệu (lịch trình, "Muốn đi", cách đăng nhập). */
  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser): Promise<void> {
    return this.users.deleteAccount(user.userId);
  }
}
