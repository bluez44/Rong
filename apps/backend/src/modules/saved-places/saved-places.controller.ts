import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import type { SavedPlace } from '@rong/shared-types';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SavePlaceDto } from './dto/save-place.dto.js';
import { SavedPlacesService } from './saved-places.service.js';

/** Danh sách "Muốn đi" của người dùng (F9). PUT/DELETE đều idempotent. */
@Controller('saved-places')
export class SavedPlacesController {
  constructor(private readonly saved: SavedPlacesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<SavedPlace[]> {
    return this.saved.list(user.userId);
  }

  @Put(':placeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  save(
    @CurrentUser() user: AuthUser,
    @Param('placeId', new ParseUUIDPipe()) placeId: string,
    @Body() dto: SavePlaceDto,
  ): Promise<void> {
    return this.saved.save(user.userId, placeId, dto.regionId);
  }

  @Delete(':placeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('placeId', new ParseUUIDPipe()) placeId: string,
  ): Promise<void> {
    return this.saved.remove(user.userId, placeId);
  }
}
