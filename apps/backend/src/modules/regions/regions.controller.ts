import { Controller, Get, Query } from '@nestjs/common';
import type { RegionSearchResult } from '@rong/shared-types';

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
}
