import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { RegionDetail, RegionSearchResult } from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { OpenDataService } from '../open-data/open-data.service.js';
import type { NominatimResult } from '../open-data/open-data.types.js';
import { BoundaryService } from './boundary.service.js';
import type { BoundarySource } from './entities/region.entity.js';
import {
  arrangeRegionResults,
  displayName,
  type RegionLite,
  type RegionMatch,
} from './region-search-arrange.js';
import { isWardName, searchKey } from './search-text.js';

/** Khớp từ mức này trở lên thì không cần hỏi Nominatim nữa. */
const GOOD_ENOUGH = 0.8;
/** Không hỏi lại Nominatim cùng một từ khóa trong khoảng này. */
const ONLINE_QUERY_TTL_MS = 60 * 60 * 1000;

/** Loại địa danh Nominatim được nhận làm điểm đến, kèm bán kính dự phòng khi chỉ có node. */
const ACCEPTED_ADDRESS_TYPES: Record<string, number> = {
  city: 8000,
  town: 4000,
  municipality: 6000,
  county: 8000,
  island: 4000,
  village: 1500,
  suburb: 1500,
  quarter: 1200,
  city_district: 3000,
  borough: 3000,
};

interface LiteRow {
  id: string;
  name: string;
  type: RegionLite['type'];
  boundary_version: RegionLite['boundaryVersion'];
  level: RegionLite['level'];
  parent_id: string | null;
  former_parent_id: string | null;
  successor_region_id: string | null;
  merge_note: string | null;
  lat: number | null;
  lng: number | null;
}

@Injectable()
export class RegionsService {
  private readonly logger = new Logger(RegionsService.name);
  private readonly recentOnline = new Map<string, number>();

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly openData: OpenDataService,
    private readonly boundaries: BoundaryService,
  ) {}

  /**
   * Tìm vùng theo từ khóa trong danh mục riêng (FR-1.1). Với `online`, nếu
   * danh mục chưa có kết quả khớp rõ thì hỏi thêm Nominatim, lưu các địa danh
   * tìm được vào danh mục, rồi tìm lại — lần sau khỏi phải hỏi.
   */
  async search(query: string, online: boolean): Promise<RegionSearchResult[]> {
    const key = searchKey(query);
    if (key.length < 2) return [];

    let matches = await this.match(key);
    if (
      online &&
      !matches.some((m) => m.score >= GOOD_ENOUGH) &&
      this.shouldAskOnline(key)
    ) {
      try {
        const imported = await this.importFromNominatim(query);
        if (imported > 0) matches = await this.match(key);
      } catch (error) {
        // Nguồn ngoài lỗi thì vẫn trả kết quả từ danh mục riêng.
        this.logger.warn(
          `Nominatim lỗi với "${query}": ${(error as Error).message}`,
        );
      }
    }

    const regions = await this.loadWithRelatives(
      matches.map((m) => m.regionId),
    );
    return arrangeRegionResults(matches, regions);
  }

  async getDetail(id: string): Promise<RegionDetail> {
    const regions = await this.loadWithRelatives([id]);
    const region = regions.get(id);
    if (!region) throw this.notFound();

    await this.boundaries.ensure(id);

    const [geo] = (await this.db.query(
      `SELECT ST_AsGeoJSON(ST_SimplifyPreserveTopology(boundary, 0.0005), 6)::json AS boundary,
              ARRAY[ST_XMin(boundary), ST_YMin(boundary), ST_XMax(boundary), ST_YMax(boundary)] AS bbox,
              ST_Y(center) AS lat, ST_X(center) AS lng
         FROM regions WHERE id = $1`,
      [id],
    )) as Array<{
      boundary: RegionDetail['boundary'];
      bbox: RegionDetail['bbox'];
      lat: number | null;
      lng: number | null;
    }>;

    const parentId =
      region.boundaryVersion === 'pre_merger'
        ? region.successorRegionId
        : region.parentId;
    const parent = parentId ? regions.get(parentId) : undefined;
    const asResult = arrangeRegionResults(
      [{ regionId: id, score: 1 }],
      regions,
    ).find((result) => result.id === id)!;

    return {
      ...asResult,
      parent: parent
        ? { id: parent.id, displayName: displayName(parent) }
        : null,
      center:
        geo.lat !== null && geo.lng !== null
          ? { lat: geo.lat, lng: geo.lng }
          : null,
      boundary: geo.boundary,
      bbox: geo.bbox,
    };
  }

  /**
   * Điểm khớp của mỗi vùng: 1 khớp đúng, 0.9 khớp đầu chuỗi, 0.8 khớp đầu một
   * từ ("vung tau" trong "ba ria vung tau"), còn lại là độ tương đồng trigram
   * để chịu lỗi chính tả nhẹ. Bí danh tính thấp hơn tên chính một chút.
   */
  private async match(key: string): Promise<RegionMatch[]> {
    const rows = (await this.db.query(
      `WITH candidates AS (
         SELECT id AS region_id, search_name AS text, 0 AS penalty FROM regions
          WHERE search_name % $1 OR search_name LIKE $1 || '%' OR search_name LIKE '% ' || $1 || '%'
         UNION ALL
         SELECT region_id, search_alias, 0.02 FROM region_aliases
          WHERE search_alias % $1 OR search_alias LIKE $1 || '%' OR search_alias LIKE '% ' || $1 || '%'
       )
       SELECT region_id, MAX(
                CASE WHEN text = $1 THEN 1.0
                     WHEN text LIKE $1 || '%' THEN 0.9
                     WHEN text LIKE '% ' || $1 || '%' THEN 0.8
                     ELSE similarity(text, $1) END - penalty
              ) AS score
         FROM candidates GROUP BY region_id ORDER BY score DESC LIMIT 20`,
      [key],
    )) as Array<{ region_id: string; score: string | number }>;
    return rows.map((row) => ({
      regionId: row.region_id,
      score: Number(row.score),
    }));
  }

  private async loadWithRelatives(
    ids: string[],
  ): Promise<Map<string, RegionLite>> {
    if (ids.length === 0) return new Map();
    const rows = (await this.db.query(
      `WITH base AS (SELECT * FROM regions WHERE id = ANY($1::uuid[]))
       SELECT r.id, r.name, r.type, r.boundary_version, r.level, r.parent_id, r.former_parent_id,
              r.successor_region_id, r.merge_note, ST_Y(r.center) AS lat, ST_X(r.center) AS lng
         FROM regions r
        WHERE r.id IN (SELECT id FROM base
                       UNION SELECT parent_id FROM base
                       UNION SELECT former_parent_id FROM base
                       UNION SELECT successor_region_id FROM base)
           OR r.id IN (SELECT successor_region_id FROM regions
                        WHERE id IN (SELECT former_parent_id FROM base))`,
      [ids],
    )) as LiteRow[];

    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          name: row.name,
          type: row.type,
          boundaryVersion: row.boundary_version,
          level: row.level,
          parentId: row.parent_id,
          formerParentId: row.former_parent_id,
          successorRegionId: row.successor_region_id,
          mergeNote: row.merge_note,
          center:
            row.lat !== null && row.lng !== null
              ? { lat: row.lat, lng: row.lng }
              : null,
        },
      ]),
    );
  }

  private shouldAskOnline(key: string): boolean {
    const now = Date.now();
    for (const [k, at] of this.recentOnline) {
      if (now - at > ONLINE_QUERY_TTL_MS) this.recentOnline.delete(k);
    }
    if (this.recentOnline.has(key)) return false;
    this.recentOnline.set(key, now);
    return true;
  }

  /** Lưu các địa danh Nominatim tìm được thành vùng trong danh mục. Trả về số vùng hợp lệ. */
  private async importFromNominatim(query: string): Promise<number> {
    const results = (await this.openData.searchPlaces(query)).filter(
      (r) =>
        ['boundary', 'place'].includes(r.category) &&
        r.addresstype in ACCEPTED_ADDRESS_TYPES,
    );

    for (const result of results) {
      const name = result.name?.trim();
      if (!name) continue;

      const parent = await this.resolveProvince(result);
      const ward = isWardName(name);
      const boundarySource: BoundarySource =
        result.osm_type === 'relation'
          ? { relationId: result.osm_id }
          : { radiusMeters: ACCEPTED_ADDRESS_TYPES[result.addresstype] };

      await this.db.query(
        `INSERT INTO regions (source_key, name, type, boundary_version, level, parent_id, former_parent_id,
                              search_name, boundary_source, center)
         VALUES ($1, $2, $3, 'current', $4, $5, $6, $7, $8, ST_SetSRID(ST_MakePoint($9, $10), 4326))
         ON CONFLICT (source_key) DO NOTHING`,
        [
          `osm:${result.osm_type[0].toUpperCase()}${result.osm_id}`,
          name,
          ward ? 'administrative' : 'destination',
          ward ? 'ward' : null,
          parent.current,
          parent.former,
          searchKey(name),
          JSON.stringify(boundarySource),
          Number(result.lon),
          Number(result.lat),
        ],
      );
    }
    return results.length;
  }

  /**
   * Tìm tỉnh chứa địa danh từ địa chỉ Nominatim trả về. Dữ liệu OSM có thể
   * còn ghi tên tỉnh cũ; khi đó tỉnh mới là tỉnh kế nhiệm của nó.
   */
  private async resolveProvince(
    result: NominatimResult,
  ): Promise<{ current: string | null; former: string | null }> {
    const state =
      result.address?.state ?? result.address?.province ?? result.address?.city;
    if (!state) return { current: null, former: null };

    const rows = (await this.db.query(
      `SELECT id, boundary_version, successor_region_id FROM regions
        WHERE level = 'province' AND search_name = $1`,
      [searchKey(state)],
    )) as Array<{
      id: string;
      boundary_version: string;
      successor_region_id: string | null;
    }>;

    const current = rows.find((r) => r.boundary_version === 'current');
    const former = rows.find((r) => r.boundary_version === 'pre_merger');
    return {
      current: current?.id ?? former?.successor_region_id ?? null,
      // Chỉ biết chắc tỉnh cũ khi OSM còn ghi tên cũ mà tên đó không trùng tỉnh mới.
      former: !current && former ? former.id : null,
    };
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      statusCode: 404,
      code: 'REGION_NOT_FOUND',
      message: 'Không tìm thấy vùng này.',
    });
  }
}
