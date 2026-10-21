import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type {
  CreateUserPlaceResponse,
  ReverseGeocodeResponse,
} from '@rong/shared-types';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import {
  CreateUserPlaceDto,
  UpdateUserPlaceDto,
} from './dto/create-user-place.dto.js';
import { ReverseGeocodeQueryDto } from './dto/reverse-geocode-query.dto.js';
import { ReverseGeocodeService } from './reverse-geocode.service.js';
import { UserPlacesService } from './user-places.service.js';

/**
 * Địa điểm tự ghim (spec 2026-10-21-user-pinned-places). Đăng ký trước `PlaceDetailController` để các route tĩnh
 * (`user`, `reverse-geocode`) không rơi vào `GET /places/:id`.
 */
@Controller('places')
export class UserPlacesController {
  constructor(
    private readonly userPlaces: UserPlacesService,
    private readonly reverse: ReverseGeocodeService,
  ) {}

  /** Địa chỉ dưới ghim ở màn ghim vị trí; `address: null` khi không tìm được. */
  @Get('reverse-geocode')
  reverseGeocode(
    @CurrentUser() user: AuthUser,
    @Query() query: ReverseGeocodeQueryDto,
  ): Promise<ReverseGeocodeResponse> {
    return this.reverse.lookup(user.userId, query.lat, query.lng);
  }

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
