import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type {
  Itinerary,
  ItinerarySummary,
  PlaceAlternative,
} from '@rong/shared-types';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AlternativesQueryDto } from './dto/alternatives.dto.js';
import { CreateItineraryDto } from './dto/create-itinerary.dto.js';
import { MoveItineraryDto } from './dto/move-itinerary.dto.js';
import { UpdateItineraryDto } from './dto/update-itinerary.dto.js';
import { ItinerariesService } from './itineraries.service.js';

@Controller('itineraries')
export class ItinerariesController {
  constructor(private readonly itineraries: ItinerariesService) {}

  /** Tạo lịch trình (F6). Chế độ AI mất vài giây tới vài chục giây. */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateItineraryDto,
  ): Promise<Itinerary> {
    return this.itineraries.create(user.userId, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ItinerarySummary[]> {
    return this.itineraries.list(user.userId);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Itinerary> {
    return this.itineraries.get(user.userId, id);
  }

  /** Sửa lịch trình (F8): gửi toàn bộ các ngày, server tính lại giờ và cảnh báo. */
  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateItineraryDto,
  ): Promise<Itinerary> {
    return this.itineraries.update(user.userId, id, dto);
  }

  /** Chuyển lịch trình vào nhóm hoặc ra khỏi nhóm (`groupId: null`). Chỉ người tạo. */
  @Patch(':id/group')
  move(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MoveItineraryDto,
  ): Promise<Itinerary> {
    return this.itineraries.move(user.userId, id, dto.groupId);
  }

  /** "Đổi điểm tương tự" (FR-8.3). */
  @Get(':id/alternatives')
  alternatives(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: AlternativesQueryDto,
  ): Promise<PlaceAlternative[]> {
    return this.itineraries.alternatives(user.userId, id, query.placeId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.itineraries.remove(user.userId, id);
  }
}
