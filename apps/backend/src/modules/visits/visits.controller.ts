import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { PendingVisitReview } from '@rong/shared-types';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ReviewVisitsDto } from './dto/review-visits.dto.js';
import { VisitsService } from './visits.service.js';

@Controller('visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Get('pending')
  pending(@CurrentUser() user: AuthUser): Promise<PendingVisitReview[]> {
    return this.visits.pending(user.userId);
  }

  @Post('review')
  @HttpCode(HttpStatus.NO_CONTENT)
  review(
    @CurrentUser() user: AuthUser,
    @Body() dto: ReviewVisitsDto,
  ): Promise<void> {
    return this.visits.review(user.userId, dto.itineraryId, dto.visitedPlaceIds);
  }
}
