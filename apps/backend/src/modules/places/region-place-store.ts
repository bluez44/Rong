import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  ArticleSource,
  PlaceCategory,
  PlaceImage,
} from '@rong/shared-types';
import { DataSource, type EntityManager } from 'typeorm';

import { searchKey } from '../regions/search-text.js';
import { GOOGLE_LOCATION_TTL_DAYS } from './place-location.service.js';

export interface WebPlaceInput {
  name: string;
  category: PlaceCategory;
  address: string | null;
  description: string | null;
  /** "HH:mm-HH:mm" (cú pháp opening_hours OSM hợp lệ), null nếu không rõ. */
  openingHours: string | null;
  articles: ArticleSource[];
  /** Ảnh từ bài viết (`groundedImage`), null nếu không có. */
  image: PlaceImage | null;
  location:
    | { source: 'google'; placeId: string; lat: number; lng: number }
    | { source: 'ai'; lat: number; lng: number };
}

export type ListState = {
  status: 'ready' | 'building' | 'failed';
  expiresAt: Date | null;
  sources: ArticleSource[];
} | null;

export interface StoredPlaceRow {
  id: string;
  name: string;
  category: PlaceCategory;
  address: string | null;
  description: string | null;
  lat: number | null;
  lng: number | null;
  location_source: 'google' | 'ai';
  google_place_id: string | null;
  opening_hours: string | null;
  rank: number;
  articles: ArticleSource[];
  image: PlaceImage | null;
}

/**
 * Danh sách địa điểm đã tổng hợp của mỗi vùng (`region_place_lists`,
 * `region_places`) và các dòng `places.source = 'web'` của nó.
 *
 * Mỗi `google_place_id` chỉ một dòng: đã có (người dùng lưu, hoặc vùng khác)
 * thì dùng lại, không đổi tên. Dòng tọa độ AI được nhận lại theo tên (bỏ dấu)
 * trong danh sách cũ của vùng, để làm mới không sinh dòng trùng.
 */
@Injectable()
export class RegionPlaceStore {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async state(regionId: string): Promise<ListState> {
    const [row] = (await this.db.query(
      `SELECT status, expires_at, sources FROM region_place_lists WHERE region_id = $1`,
      [regionId],
    )) as Array<{
      status: 'ready' | 'building' | 'failed';
      expires_at: Date | null;
      sources: ArticleSource[];
    }>;
    return row
      ? { status: row.status, expiresAt: row.expires_at, sources: row.sources }
      : null;
  }

  /** Chỉ đánh dấu khi chưa có danh sách: vùng đã `ready` thì giữ nguyên trong lúc làm mới. */
  async markBuilding(regionId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO region_place_lists (region_id, status) VALUES ($1, 'building')
       ON CONFLICT (region_id) DO UPDATE SET status = 'building', error_code = NULL
        WHERE region_place_lists.status <> 'ready'`,
      [regionId],
    );
  }

  /** Lỗi khi đã có danh sách thì giữ `ready` (vẫn phục vụ bản cũ). */
  async markFailed(regionId: string, code: string): Promise<void> {
    await this.db.query(
      `INSERT INTO region_place_lists (region_id, status, error_code) VALUES ($1, 'failed', $2)
       ON CONFLICT (region_id) DO UPDATE
         SET status = CASE WHEN region_place_lists.status = 'ready' THEN 'ready' ELSE 'failed' END,
             error_code = $2`,
      [regionId, code],
    );
  }

  async count(regionId: string): Promise<number> {
    const [row] = (await this.db.query(
      `SELECT count(*)::int AS n FROM region_places WHERE region_id = $1`,
      [regionId],
    )) as Array<{ n: number }>;
    return row?.n ?? 0;
  }

  /** Giữ danh sách hiện có thêm một chu kỳ (làm mới ra kết quả kém hơn). */
  async postpone(regionId: string, refreshDays: number): Promise<void> {
    await this.db.query(
      `UPDATE region_place_lists
          SET status = 'ready', error_code = NULL,
              expires_at = now() + make_interval(days => $2::int)
        WHERE region_id = $1`,
      [regionId, refreshDays],
    );
  }

  async replace(
    regionId: string,
    places: WebPlaceInput[],
    sources: ArticleSource[],
    refreshDays: number,
  ): Promise<string[]> {
    return this.db.transaction(async (m) => {
      const previous = (await m.query(
        `SELECT p.id, p.name FROM region_places rp JOIN places p ON p.id = rp.place_id
          WHERE rp.region_id = $1 AND p.source = 'web' AND p.location_source = 'ai'`,
        [regionId],
      )) as Array<{ id: string; name: string }>;
      const aiByName = new Map(previous.map((r) => [searchKey(r.name), r.id]));

      const ids: string[] = [];
      for (const place of places) {
        ids.push(
          await this.upsertPlace(
            m,
            place,
            aiByName.get(searchKey(place.name)) ?? null,
          ),
        );
      }

      await m.query(`DELETE FROM region_places WHERE region_id = $1`, [
        regionId,
      ]);
      const seen = new Set<string>();
      for (const [rank, id] of ids.entries()) {
        if (seen.has(id)) continue; // hai tên trong bài cùng ra một place_id
        seen.add(id);
        await m.query(
          `INSERT INTO region_places (region_id, place_id, rank, articles, image) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
          [
            regionId,
            id,
            rank,
            JSON.stringify(places[rank].articles),
            places[rank].image ? JSON.stringify(places[rank].image) : null,
          ],
        );
      }
      await m.query(
        `INSERT INTO region_place_lists (region_id, status, fetched_at, expires_at, error_code, sources)
         VALUES ($1, 'ready', now(), now() + make_interval(days => $2::int), NULL, $3::jsonb)
         ON CONFLICT (region_id) DO UPDATE
           SET status = 'ready', fetched_at = EXCLUDED.fetched_at, expires_at = EXCLUDED.expires_at,
               error_code = NULL, sources = EXCLUDED.sources`,
        [regionId, refreshDays, JSON.stringify(sources)],
      );
      return ids;
    });
  }

  async list(
    regionId: string,
    categories: PlaceCategory[] | null,
  ): Promise<StoredPlaceRow[]> {
    const rows = (await this.db.query(
      `SELECT p.id, p.name, p.category, p.address, p.description, p.location_source, p.google_place_id,
              CASE WHEN p.location_source <> 'google' OR p.location_expires_at > now() THEN ST_Y(p.location) END AS lat,
              CASE WHEN p.location_source <> 'google' OR p.location_expires_at > now() THEN ST_X(p.location) END AS lng,
              p.tags->>'opening_hours' AS opening_hours, rp.rank, rp.articles, rp.image
         FROM region_places rp JOIN places p ON p.id = rp.place_id
        WHERE rp.region_id = $1
          AND ($2::place_category[] IS NULL OR p.category = ANY($2::place_category[]))
        ORDER BY rp.rank`,
      [regionId, categories],
    )) as StoredPlaceRow[];
    return rows.map((r) => ({
      ...r,
      lat: r.lat === null ? null : Number(r.lat),
      lng: r.lng === null ? null : Number(r.lng),
    }));
  }

  private async upsertPlace(
    m: EntityManager,
    place: WebPlaceInput,
    aiRowId: string | null,
  ): Promise<string> {
    const tags = JSON.stringify(
      place.openingHours ? { opening_hours: place.openingHours } : {},
    );
    const address = place.address?.trim() || null;
    const { location } = place;

    if (location.source === 'google') {
      const [existing] = (await m.query(
        `SELECT id FROM places WHERE google_place_id = $1 AND source IN ('google', 'web')`,
        [location.placeId],
      )) as Array<{ id: string }>;
      if (existing) {
        await m.query(
          `UPDATE places SET location = ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326),
                  address = CASE WHEN source = 'web' THEN COALESCE($5::text, address) ELSE address END,
                  location_expires_at = now() + make_interval(days => $4::int), updated_at = now()
            WHERE id = $1`,
          [
            existing.id,
            location.lng,
            location.lat,
            GOOGLE_LOCATION_TTL_DAYS,
            address,
          ],
        );
        return existing.id;
      }
      if (aiRowId) {
        // Lần trước chưa ghép được, lần này được: nâng cấp chính dòng đó (giữ tham chiếu của lịch trình).
        await m.query(
          `UPDATE places SET google_place_id = $2, location_source = 'google',
                  location = ST_SetSRID(ST_MakePoint($3::float8, $4::float8), 4326),
                  location_expires_at = now() + make_interval(days => $5::int),
                  description = $6, address = COALESCE($7::text, address), updated_at = now()
            WHERE id = $1`,
          [
            aiRowId,
            location.placeId,
            location.lng,
            location.lat,
            GOOGLE_LOCATION_TTL_DAYS,
            place.description,
            address,
          ],
        );
        return aiRowId;
      }
      const [row] = (await m.query(
        `INSERT INTO places (source, name, category, description, address, tags, google_place_id, location, location_source,
                             location_expires_at)
         VALUES ('web', $1, $2::place_category, $3, $4, $5::jsonb, $6,
                 ST_SetSRID(ST_MakePoint($7::float8, $8::float8), 4326), 'google',
                 now() + make_interval(days => $9::int))
         RETURNING id`,
        [
          place.name,
          place.category,
          place.description,
          address,
          tags,
          location.placeId,
          location.lng,
          location.lat,
          GOOGLE_LOCATION_TTL_DAYS,
        ],
      )) as Array<{ id: string }>;
      return row.id;
    }

    if (aiRowId) {
      await m.query(
        `UPDATE places SET location = ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326),
                description = $4, tags = $5::jsonb, address = COALESCE($6::text, address), updated_at = now()
          WHERE id = $1`,
        [aiRowId, location.lng, location.lat, place.description, tags, address],
      );
      return aiRowId;
    }
    const [row] = (await m.query(
      `INSERT INTO places (source, name, category, description, address, tags, location, location_source)
       VALUES ('web', $1, $2::place_category, $3, $4, $5::jsonb, ST_SetSRID(ST_MakePoint($6::float8, $7::float8), 4326), 'ai')
       RETURNING id`,
      [
        place.name,
        place.category,
        place.description,
        address,
        tags,
        location.lng,
        location.lat,
      ],
    )) as Array<{ id: string }>;
    return row.id;
  }
}
