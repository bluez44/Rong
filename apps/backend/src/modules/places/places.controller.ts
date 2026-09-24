import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type { AttributedPage, PlaceListItem } from '@rong/shared-types';

import { ListPlacesDto } from './dto/list-places.dto.js';
import { PlacesService } from './places.service.js';

@Controller('regions')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  /**
   * Địa điểm trong vùng người dùng đã chọn. Lần đầu mở một vùng (hoặc sau
   * PLACES_REFRESH_DAYS ngày) sẽ chậm vài giây vì phải tải từ OSM.
   */
  @Get(':id/places')
  list(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() dto: ListPlacesDto,
  ): Promise<AttributedPage<PlaceListItem>> {
    return this.places.listForRegion(id, dto);
  }
}
