import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type { ItineraryShareLink, PublicItinerary } from '@rong/shared-types';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/public.decorator.js';
import { ShareLinksService } from './share-links.service.js';

/** Link xem lịch trình trên web — FR-10.3. Trang `/t/[token]` của apps/web gọi route công khai. */
@Controller()
export class ShareLinksController {
  constructor(private readonly links: ShareLinksService) {}

  @Post('itineraries/:id/share-link')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ItineraryShareLink> {
    return this.links.create(user.userId, id);
  }

  @Delete('itineraries/:id/share-link')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.links.revoke(user.userId, id);
  }

  @Public()
  @Get('public/itineraries/:token')
  view(@Param('token') token: string): Promise<PublicItinerary> {
    return this.links.getPublic(token);
  }
}
