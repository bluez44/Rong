import { Injectable } from '@nestjs/common';
import type { ReverseGeocodeResponse } from '@rong/shared-types';

import { OpenDataService } from '../open-data/open-data.service.js';
import { PlaceSearchLimiter } from './place-search-limiter.js';
import { cacheKey, formatAddress } from './reverse-geocode.js';

const CACHE_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 5000;
/** Mỗi người 60 lần mỗi giờ: màn ghim chỉ hỏi khi ghim đứng yên 1 giây. */
const LIMIT_PER_HOUR = 60;

/**
 * Địa chỉ dưới ghim (màn ghim vị trí) qua Nominatim reverse. Không bao giờ báo lỗi: quá giới hạn, Nominatim lỗi
 * hay hết giờ đều trả `{ address: null }`, app khi đó chỉ hiện tọa độ.
 */
@Injectable()
export class ReverseGeocodeService {
  private readonly cache = new Map<
    string,
    { address: string | null; at: number }
  >();
  private readonly limiter = new PlaceSearchLimiter(
    LIMIT_PER_HOUR,
    60 * 60 * 1000,
  );

  constructor(private readonly openData: OpenDataService) {}

  async lookup(
    userId: string,
    lat: number,
    lng: number,
  ): Promise<ReverseGeocodeResponse> {
    const key = cacheKey(lat, lng);
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return { address: hit.address };
    if (!this.limiter.tryConsume(userId)) return { address: null };

    const result = await this.openData.reverse(lat, lng);
    if (!result) return { address: null };
    const address = formatAddress(result.address);
    // Map giữ thứ tự thêm vào: đầy thì bỏ mục cũ nhất.
    if (this.cache.size >= CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { address, at: Date.now() });
    return { address };
  }
}
