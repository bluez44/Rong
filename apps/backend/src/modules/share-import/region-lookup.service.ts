import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import type { Bbox } from '../regions/bbox.js';
import { searchKey } from '../regions/search-text.js';

export interface RegionRef {
  id: string;
  name: string;
  bbox: Bbox;
}

/** Chỉ điểm đến và tỉnh theo ranh giới hiện hành: "Muốn đi" nhóm theo nơi người dùng sẽ đi, không theo phường. */
const ELIGIBLE = `r.boundary_version = 'current'
  AND (r.type = 'destination' OR r.level = 'province')
  AND r.bbox_south IS NOT NULL`;

@Injectable()
export class RegionLookupService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** Vùng khớp tên AI đọc được (không gọi Nominatim). */
  async findByHint(hint: string): Promise<RegionRef | null> {
    const key = searchKey(hint);
    if (!key) return null;
    const [row] = (await this.db.query(
      `SELECT r.id, r.name, r.bbox_south, r.bbox_west, r.bbox_north, r.bbox_east
         FROM regions r
        WHERE ${ELIGIBLE}
          AND (r.search_name = $1 OR r.search_name % $1
               OR EXISTS (SELECT 1 FROM region_aliases a WHERE a.region_id = r.id AND a.search_alias = $1))
        ORDER BY (r.search_name = $1) DESC, similarity(r.search_name, $1) DESC,
                 (r.type = 'destination') DESC
        LIMIT 1`,
      [key],
    )) as Array<{
      id: string;
      name: string;
      bbox_south: number;
      bbox_west: number;
      bbox_north: number;
      bbox_east: number;
    }>;
    return row
      ? {
          id: row.id,
          name: row.name,
          bbox: [row.bbox_south, row.bbox_west, row.bbox_north, row.bbox_east],
        }
      : null;
  }

  /** Vùng (điểm đến hoặc tỉnh) có bbox nhỏ nhất chứa điểm; null nếu không có. */
  async assign(points: Array<{ lat: number; lng: number }>): Promise<Array<string | null>> {
    if (points.length === 0) return [];
    const rows = (await this.db.query(
      `SELECT n.idx, m.id
         FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS n(lat, lng, idx)
         LEFT JOIN LATERAL (
           SELECT r.id FROM regions r
            WHERE ${ELIGIBLE}
              AND n.lat BETWEEN r.bbox_south AND r.bbox_north
              AND n.lng BETWEEN r.bbox_west AND r.bbox_east
            ORDER BY (r.bbox_north - r.bbox_south) * (r.bbox_east - r.bbox_west)
            LIMIT 1
         ) m ON true
        ORDER BY n.idx`,
      [points.map((p) => p.lat), points.map((p) => p.lng)],
    )) as Array<{ idx: string; id: string | null }>;
    return rows.map((row) => row.id);
  }

  /** "Tên, Tỉnh" cho mỗi vùng. */
  async names(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = (await this.db.query(
      `SELECT r.id, r.name, p.name AS parent_name
         FROM regions r LEFT JOIN regions p ON p.id = r.parent_id
        WHERE r.id = ANY($1::uuid[])`,
      [ids],
    )) as Array<{ id: string; name: string; parent_name: string | null }>;
    return new Map(rows.map((r) => [r.id, r.parent_name ? `${r.name}, ${r.parent_name}` : r.name]));
  }
}
