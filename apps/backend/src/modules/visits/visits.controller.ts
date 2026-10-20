import { Body, Controller, Get, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';
import type { PendingVisitReview } from '@rong/shared-types';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { RecommendationsQueue } from '../recommendations/queue/recommendations-queue.js';
import { ReviewVisitsDto } from './dto/review-visits.dto.js';
import { VisitsService } from './visits.service.js';

@Controller('visits')
export class VisitsController {
  private readonly logger = new Logger(VisitsController.name);

  constructor(
    private readonly visits: VisitsService,
    private readonly recommendations: RecommendationsQueue,
  ) {}

  @Get('pending')
  pending(@CurrentUser() user: AuthUser): Promise<PendingVisitReview[]> {
    return this.visits.pending(user.userId);
  }

  @Post('review')
  @HttpCode(HttpStatus.NO_CONTENT)
  async review(
    @CurrentUser() user: AuthUser,
    @Body() dto: ReviewVisitsDto,
  ): Promise<void> {
    await this.visits.review(user.userId, dto.itineraryId, dto.visitedPlaceIds);
    // Không chờ: hàng đợi lỗi (Redis) không được làm hỏng hay treo request.
    void this.recommendations
      .enqueue({ name: 'generate-user-themes', data: { userId: user.userId } })
      .catch((error: unknown) =>
        this.logger.error(`Không đẩy được job chủ đề cho ${user.userId}: ${(error as Error).message}`),
      );
  }
}
