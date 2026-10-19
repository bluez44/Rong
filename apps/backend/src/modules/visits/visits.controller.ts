import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { PendingVisitReview } from '@rong/shared-types';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { RecommendationsQueue } from '../recommendations/queue/recommendations-queue.js';
import { ReviewVisitsDto } from './dto/review-visits.dto.js';
import { VisitsService } from './visits.service.js';

@Controller('visits')
export class VisitsController {
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
    await this.recommendations.enqueue({
      name: 'generate-user-themes',
      data: { userId: user.userId },
    });
  }
}
