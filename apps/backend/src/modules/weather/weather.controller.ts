import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type { RegionWeather } from '@rong/shared-types';

import { WeatherQueryDto } from './dto/weather-query.dto.js';
import { WeatherService } from './weather.service.js';

@Controller('regions')
export class WeatherController {
  constructor(private readonly weather: WeatherService) {}

  /** Thời tiết từng ngày của chuyến: dự báo (≤ 16 ngày tới) hoặc khí hậu theo tháng. */
  @Get(':id/weather')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: WeatherQueryDto,
  ): Promise<RegionWeather> {
    return this.weather.regionWeather(id, query.from, query.to);
  }
}
