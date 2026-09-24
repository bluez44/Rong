import { Inject, Injectable } from '@nestjs/common';

import type { OpenDataConfig } from '../../config/configuration.js';
import { ThrottledHttp } from './http.js';
import type {
  Bbox,
  NominatimResult,
  OverpassElement,
  WikidataInfo,
} from './open-data.types.js';

export const OPEN_DATA_CONFIG = 'OPEN_DATA_CONFIG';

/** Khung bao lãnh thổ đất liền và các đảo gần bờ của Việt Nam. */
const VIETNAM_BBOX: Bbox = [8.0, 102.0, 23.6, 110.0];

/**
 * Cổng duy nhất ra các dịch vụ dữ liệu mở (OSM Nominatim, Overpass, Wikidata).
 * Không có AI ở đây: mọi thứ là truy vấn có cấu trúc và thuật toán xử lý kết
 * quả. Giống `google/`, gom về một chỗ để kiểm soát giới hạn tần suất và ghi
 * công nguồn (ODbL).
 */
@Injectable()
export class OpenDataService {
  private readonly http: ThrottledHttp;
  private readonly boundaryListCache = new Map<
    string,
    { at: number; value: Promise<OverpassElement[]> }
  >();

  constructor(
    @Inject(OPEN_DATA_CONFIG) private readonly config: OpenDataConfig,
  ) {
    this.http = new ThrottledHttp(`Rong/0.1 (${config.contactEmail})`, {
      [new URL(config.nominatimUrl).host]: 1100,
      [new URL(config.overpassUrl).host]: 1000,
      [new URL(config.wikidataUrl).host]: 200,
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
   * Danh sách relation ranh giới hành chính ở một cấp, kèm tag và khung bao
   * (không kèm hình học), tùy chọn tại một thời điểm trong quá khứ. Nhẹ (vài
   * trăm KB), được cache trong bộ nhớ vì dùng lại cho mọi vùng cùng cấp.
   */
  listBoundaries(
    adminLevel: string,
    date?: string,
  ): Promise<OverpassElement[]> {
    const key = `${adminLevel}@${date ?? 'now'}`;
    const cached = this.boundaryListCache.get(key);
    if (cached && Date.now() - cached.at < 24 * 60 * 60 * 1000) {
      return cached.value;
    }

    const [s, w, n, e] = VIETNAM_BBOX;
    const value = this.overpass<{ elements: OverpassElement[] }>(
      `${this.header(60, date)}rel["boundary"="administrative"]["admin_level"~"^(${adminLevel})$"](${s},${w},${n},${e});out tags bb;`,
    ).then((body) => body.elements);
    value.catch(() => this.boundaryListCache.delete(key));
    this.boundaryListCache.set(key, { at: Date.now(), value });
    return value;
  }

  /** Các địa điểm có tên thuộc nhóm du lịch/dịch vụ trong một khung bao. */
  async placesInBbox(
    bbox: Bbox,
    filters: string[],
    cap: number,
  ): Promise<OverpassElement[]> {
    const box = bbox.join(',');
    const statements = filters
      .map((filter) => `nwr${filter}["name"](${box});`)
      .join('');
    const body = await this.overpass<{ elements: OverpassElement[] }>(
      `${this.header(180)}(${statements});out center tags ${cap};`,
    );
    return body.elements;
  }

  /** Số sitelink và mô tả ngắn của các thực thể Wikidata, theo lô 50. */
  async wikidata(ids: string[]): Promise<Map<string, WikidataInfo>> {
    const result = new Map<string, WikidataInfo>();
    for (let i = 0; i < ids.length; i += 50) {
      const url = new URL(this.config.wikidataUrl);
      url.search = new URLSearchParams({
        action: 'wbgetentities',
        ids: ids.slice(i, i + 50).join('|'),
        props: 'sitelinks|descriptions',
        languages: 'vi|en',
        format: 'json',
      }).toString();

      const body = await this.http.getJson<{
        entities?: Record<
          string,
          {
            sitelinks?: Record<string, unknown>;
            descriptions?: Record<string, { value: string }>;
          }
        >;
      }>(url.toString());

      for (const [id, entity] of Object.entries(body.entities ?? {})) {
        result.set(id, {
          sitelinks: Object.keys(entity.sitelinks ?? {}).length,
          description:
            entity.descriptions?.vi?.value ??
            entity.descriptions?.en?.value ??
            null,
        });
      }
    }
    return result;
  }

  private header(timeoutSeconds: number, date?: string): string {
    return `[out:json][timeout:${timeoutSeconds}]${date ? `[date:"${date}"]` : ''};`;
  }

  private overpass<T>(query: string): Promise<T> {
    return this.http.getJson<T>(
      this.config.overpassUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }).toString(),
      },
      200_000,
    );
  }
}
