import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import type { CreateUserPlaceResponse } from '@rong/shared-types';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import {
  CreateUserPlaceDto,
  UpdateUserPlaceDto,
} from './dto/create-user-place.dto.js';
import { UserPlacesService } from './user-places.service.js';

/**
 * Địa điểm tự ghim (spec 2026-10-21-user-pinned-places). Đăng ký trước `PlaceDetailController` để các route tĩnh
 * (`user`, `reverse-geocode`) không rơi vào `GET /places/:id`.
 */
@Controller('places')
export class UserPlacesController {
  constructor(private readonly userPlaces: UserPlacesService) {}

  @Post('user')
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateUserPlaceDto,
  ): Promise<CreateUserPlaceResponse> {
    return this.userPlaces.create(user.userId, dto);
  }

  @Patch('user/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserPlaceDto,
  ): Promise<void> {
    return this.userPlaces.update(user.userId, id, dto);
  }
}
