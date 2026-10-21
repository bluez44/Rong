import { Inject, Injectable } from '@nestjs/common';

import type { OpenDataConfig } from '../../config/configuration.js';
import { ThrottledHttp } from './http.js';
import type { NominatimResult, NominatimReverse } from './open-data.types.js';

export const OPEN_DATA_CONFIG = 'OPEN_DATA_CONFIG';

/**
 * Cổng duy nhất ra OSM Nominatim (tìm điểm đến). Không có AI ở đây: mọi thứ
 * là truy vấn có cấu trúc. Giống `google/`, gom về một chỗ để kiểm soát giới
 * hạn tần suất (1 request/giây) và User-Agent theo chính sách OSM.
 *
 * Khung bao tỉnh được sinh sẵn trong `regions/seed/province-bboxes.ts`, nên
 * app không gọi Overpass lúc chạy.
 */
@Injectable()
export class OpenDataService {
  private readonly http: ThrottledHttp;

  constructor(
    @Inject(OPEN_DATA_CONFIG) private readonly config: OpenDataConfig,
  ) {
    this.http = new ThrottledHttp(`Rong/0.1 (${config.contactEmail})`, {
      [new URL(config.nominatimUrl).host]: 1100,
    });
  }

  /** Tìm địa danh trong Việt Nam. Chỉ gọi khi người dùng bấm tìm, không gọi khi đang gõ. */
  searchPlaces(query: string, limit = 8): Promise<NominatimResult[]> {
    const url = new URL('/search', this.config.nominatimUrl);
    url.search = new URLSearchParams({
      q: query,
      countrycodes: 'vn',
      format: 'jsonv2',
      addressdetails: '1',
      'accept-language': 'vi',
      limit: String(limit),
    }).toString();
    return this.http.getJson<NominatimResult[]>(url.toString());
  }

  /**
   * Địa chỉ của một tọa độ (màn ghim vị trí). Cùng hàng đợi 1 request/giây với `searchPlaces`; chờ tối đa 3 giây.
   * Lỗi hay hết giờ thì null.
   */
  reverse(lat: number, lng: number): Promise<NominatimReverse | null> {
    const url = new URL('/reverse', this.config.nominatimUrl);
    url.search = new URLSearchParams({
      lat: String(lat),
      lon: String(lng),
      format: 'jsonv2',
      zoom: '18',
      addressdetails: '1',
      'accept-language': 'vi',
    }).toString();
    return this.http
      .getJson<NominatimReverse>(url.toString(), {}, REVERSE_TIMEOUT_MS)
      .catch(() => null);
  }
}

const REVERSE_TIMEOUT_MS = 3000;
