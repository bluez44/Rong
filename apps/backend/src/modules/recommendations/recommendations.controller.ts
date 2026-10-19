import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import type { Itinerary, ItineraryDraft, RecommendationFeed } from '@rong/shared-types';
import type { Response } from 'express';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { FeedQueryDto } from './dto/feed-query.dto.js';
import { PreviewDraftDto } from './dto/preview-draft.dto.js';
import { SaveDraftDto } from './dto/save-draft.dto.js';
import { RecommendationsService } from './recommendations.service.js';

@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Get()
  feed(@CurrentUser() user: AuthUser, @Query() q: FeedQueryDto): Promise<RecommendationFeed> {
    return this.recommendations.feed(user.userId, q.theme ?? 'default', q.retry === '1');
  }

  @Get(':id')
  draft(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ItineraryDraft> {
    return this.recommendations.draft(user.userId, id);
  }

  @Post(':id/preview')
  preview(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PreviewDraftDto,
  ): Promise<ItineraryDraft> {
    return this.recommendations.preview(user.userId, id, dto);
  }

  /** 201 khi vừa tạo lịch trình, 200 khi gợi ý này đã được lưu trước đó. */
  @Post(':id/save')
  async save(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveDraftDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Itinerary> {
    const { itinerary, created } = await this.recommendations.save(user.userId, id, dto);
    res.status(created ? 201 : 200);
    return itinerary;
  }
}
