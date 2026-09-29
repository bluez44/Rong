import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type { PlacesPage } from '@rong/shared-types';

import { ListPlacesDto } from './dto/list-places.dto.js';
import { PlacesV2Service } from './places-v2.service.js';

@Controller('v2/regions')
export class PlacesV2Controller {
  constructor(private readonly places: PlacesV2Service) {}

  /**
   * Địa điểm trong vùng, do agent LangChain tìm web và đọc bài viết (thay cho
   * OSM ở v1). Một trang duy nhất, không có id; `cursor` và `limit` bị bỏ qua.
   */
  @Get(':id/places')
  list(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() dto: ListPlacesDto,
  ): Promise<PlacesPage> {
    return this.places.listForRegion(id, dto);
  }
}
