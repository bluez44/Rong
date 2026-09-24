import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type { Itinerary, ItinerarySummary } from '@rong/shared-types';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CreateItineraryDto } from './dto/create-itinerary.dto.js';
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

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.itineraries.remove(user.userId, id);
  }
}
