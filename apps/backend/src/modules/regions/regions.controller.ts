import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type { RegionDetail, RegionSearchResult } from '@rong/shared-types';

import { SearchRegionsDto } from './dto/region.dto.js';
import { RegionsService } from './regions.service.js';

@Controller('regions')
export class RegionsController {
  constructor(private readonly regions: RegionsService) {}

  /** Gợi ý vùng theo từ khóa — gọi được ở mỗi lần gõ phím (chỉ đọc database). */
  @Get('search')
  search(@Query() dto: SearchRegionsDto): Promise<RegionSearchResult[]> {
    return this.regions.search(dto.q, dto.online ?? false);
  }

  /** Chi tiết vùng kèm ranh giới GeoJSON. Lần đầu có thể chậm vì phải tải ranh giới từ OSM. */
  @Get(':id')
  detail(@Param('id', new ParseUUIDPipe()) id: string): Promise<RegionDetail> {
    return this.regions.getDetail(id);
  }
}
