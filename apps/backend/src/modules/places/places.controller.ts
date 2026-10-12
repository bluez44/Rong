import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import type {
  GooglePlacePreviewResponse,
  PlaceDetail,
  PlaceSearchResponse,
  PlacesPage,
  SaveGooglePlaceResponse,
} from '@rong/shared-types';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ListPlacesDto } from './dto/list-places.dto.js';
import { PlaceSearchDto } from './dto/place-search.dto.js';
import { SaveGooglePlaceDto } from './dto/save-google-place.dto.js';
import { PlaceSearchService } from './place-search.service.js';
import { PlacesService } from './places.service.js';

@Controller('regions')
export class PlacesController {
  constructor(
    private readonly places: PlacesService,
    private readonly placeSearch: PlaceSearchService,
  ) {}

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

  /** Tìm địa điểm theo tên trong vùng: danh mục khi gõ, thêm Google Maps khi `online`. */
  @Get(':id/places/search')
  search(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() dto: PlaceSearchDto,
  ): Promise<PlaceSearchResponse> {
    return this.placeSearch.search(user.userId, id, dto.q, dto.online ?? false);
  }
}

@Controller('places')
export class PlaceDetailController {
  constructor(
    private readonly places: PlacesService,
    private readonly placeSearch: PlaceSearchService,
  ) {}

  /**
   * Xem trước một kết quả Google chưa lưu. Đã có trong DB thì chỉ trả
   * `{ placeId }`; chưa có thì nội dung Google trực tiếp, không ghi DB (PRD 7.4).
   */
  @Get('google/:googlePlaceId')
  preview(
    @Param('googlePlaceId') googlePlaceId: string,
  ): Promise<GooglePlacePreviewResponse> {
    return this.placeSearch.preview(googlePlaceId);
  }

  /** Lưu một kết quả Google vào "Muốn đi" với tên và loại người dùng xác nhận. */
  @Post('google')
  save(
    @CurrentUser() user: AuthUser,
    @Body() dto: SaveGooglePlaceDto,
  ): Promise<SaveGooglePlaceResponse> {
    return this.placeSearch.save(user.userId, dto);
  }

  /**
   * Chi tiết địa điểm (F5). Phần `google` được gọi theo thời gian thực mỗi lần
   * mở; client không được lưu hay cache nó quá phiên xem (PRD 7.4).
   */
  @Get(':id')
  detail(@Param('id', new ParseUUIDPipe()) id: string): Promise<PlaceDetail> {
    return this.places.getDetail(id);
  }
}
