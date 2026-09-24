import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import type { PlaceDetail, PlacesPage } from '@rong/shared-types';

import { ListPlacesDto } from './dto/list-places.dto.js';
import { PlacesService } from './places.service.js';

@Controller('regions')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  /**
   * Địa điểm trong vùng người dùng đã chọn. Lần đầu mở một vùng (hoặc sau
   * PLACES_REFRESH_DAYS ngày) sẽ chậm vài giây vì phải tải từ OSM. OSM lỗi mà
   * chưa có dữ liệu thì trả kết quả Gemini + Google Maps (`source`).
   */
  @Get(':id/places')
  list(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() dto: ListPlacesDto,
  ): Promise<PlacesPage> {
    return this.places.listForRegion(id, dto);
  }
}

@Controller('places')
export class PlaceDetailController {
  constructor(private readonly places: PlacesService) {}

  /**
   * Chi tiết địa điểm (F5). Phần `google` được gọi theo thời gian thực mỗi lần
   * mở; client không được lưu hay cache nó quá phiên xem (PRD 7.4).
   */
  @Get(':id')
  detail(@Param('id', new ParseUUIDPipe()) id: string): Promise<PlaceDetail> {
    return this.places.getDetail(id);
  }
}
