import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { OpenDataService } from '../open-data/open-data.service.js';
import type {
  BoundaryWay,
  OverpassElement,
} from '../open-data/open-data.types.js';
import type { BoundarySource } from './entities/region.entity.js';
import { searchKey } from './search-text.js';

/** Bán kính mặc định khi vùng chỉ có một điểm (node) trên OSM. */
const FALLBACK_RADIUS_METERS = 5000;

interface BoundaryRow {
  id: string;
  name: string;
  parent_name: string | null;
  boundary_source: BoundarySource | null;
  has_boundary: boolean;
  has_center: boolean;
}

/**
 * Đảm bảo một vùng có polygon ranh giới trong PostGIS, lấy từ OSM ở lần đầu
 * cần tới rồi lưu lại.
 *
 * Dựng polygon từ các way của relation bằng ST_BuildArea: PostGIS tự nối các
 * đoạn, tách vòng ngoài/vòng trong (lỗ) và tạo MultiPolygon hợp lệ.
 */
@Injectable()
export class BoundaryService {
  private readonly logger = new Logger(BoundaryService.name);
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly openData: OpenDataService,
  ) {}

  /** Hai request cùng lúc cho một vùng chỉ tải ranh giới một lần. */
  ensure(regionId: string): Promise<void> {
    let pending = this.inFlight.get(regionId);
    if (!pending) {
      pending = this.load(regionId).finally(() =>
        this.inFlight.delete(regionId),
      );
      this.inFlight.set(regionId, pending);
    }
    return pending;
  }

  private async load(regionId: string): Promise<void> {
    const [row] = (await this.db.query(
      `SELECT r.id, r.name, p.name AS parent_name, r.boundary_source,
              r.boundary IS NOT NULL AS has_boundary, r.center IS NOT NULL AS has_center
         FROM regions r LEFT JOIN regions p ON p.id = r.parent_id
        WHERE r.id = $1`,
      [regionId],
    )) as BoundaryRow[];
    if (!row || row.has_boundary) return;

    const source = row.boundary_source ?? {};
    try {
      if (source.unionOf) {
        await this.fromUnion(row.id, source.unionOf);
      } else if (await this.fromOsm(row, source)) {
        // đã lưu
      } else if (row.has_center || source.radiusMeters) {
        await this.fromRadius(
          row.id,
          source.radiusMeters ?? FALLBACK_RADIUS_METERS,
        );
      } else {
        await this.fromGeocoding(row);
      }
    } catch (error) {
      this.logger.error(
        `Không lấy được ranh giới cho "${row.name}"`,
        error as Error,
      );
    }

    const [{ ok }] = (await this.db.query(
      `SELECT boundary IS NOT NULL AS ok FROM regions WHERE id = $1`,
      [regionId],
    )) as Array<{ ok: boolean }>;
    if (!ok) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'BOUNDARY_UNAVAILABLE',
        message: `Chưa lấy được ranh giới cho "${row.name}". Hãy thử lại sau.`,
      });
    }
  }

  private async fromOsm(
    row: BoundaryRow,
    source: BoundarySource,
  ): Promise<boolean> {
    let relationId = source.relationId;
    if (relationId === undefined && source.name && source.adminLevel) {
      const candidates = await this.openData.listBoundaries(
        source.adminLevel,
        source.date,
      );
      relationId = pickBoundary(candidates, source.name)?.id;
    }
    if (relationId === undefined) return false;

    const ways = await this.openData.relationWays(relationId, source.date);
    return this.saveWays(row.id, ways);
  }

  async saveWays(regionId: string, ways: BoundaryWay[]): Promise<boolean> {
    if (ways.length === 0) return false;
    const lines = {
      type: 'MultiLineString',
      coordinates: ways.map((way) => way.geometry.map((p) => [p.lon, p.lat])),
    };
    const updated = (await this.db.query(
      `UPDATE regions r
          SET boundary = g.geom,
              center = COALESCE(r.center, ST_PointOnSurface(g.geom)),
              boundary_fetched_at = now()
         FROM (SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(
                 ST_BuildArea(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326))), 3)) AS geom) g
        WHERE r.id = $1 AND g.geom IS NOT NULL AND NOT ST_IsEmpty(g.geom)
        RETURNING r.id`,
      [regionId, JSON.stringify(lines)],
    )) as [unknown[], number];
    return updated[1] > 0;
  }

  /**
   * Phương án cuối khi không tìm thấy relation theo tên: hỏi Nominatim vị trí
   * của vùng (kèm tên tỉnh cho đỡ nhầm), dùng relation nếu có, không thì dựng
   * vòng tròn quanh điểm đó.
   */
  private async fromGeocoding(row: BoundaryRow): Promise<void> {
    const query = row.parent_name
      ? `${row.name}, ${row.parent_name}`
      : row.name;
    const [hit] = await this.openData.searchPlaces(query, 1);
    if (!hit) return;

    await this.db.query(
      `UPDATE regions SET center = ST_SetSRID(ST_MakePoint($2, $3), 4326) WHERE id = $1`,
      [row.id, Number(hit.lon), Number(hit.lat)],
    );
    if (
      hit.osm_type === 'relation' &&
      (await this.saveWays(
        row.id,
        await this.openData.relationWays(hit.osm_id),
      ))
    ) {
      return;
    }
    await this.fromRadius(row.id, FALLBACK_RADIUS_METERS);
  }

  private async fromUnion(regionId: string, parts: string[]): Promise<void> {
    const partIds = (await this.db.query(
      `SELECT id FROM regions WHERE source_key = ANY($1)`,
      [parts],
    )) as Array<{ id: string }>;
    // Tuần tự: các tỉnh cũ dùng chung danh sách relation được cache, và instance
    // Overpass công cộng không thích nhận nhiều truy vấn nặng cùng lúc.
    for (const part of partIds) {
      await this.ensure(part.id);
    }
    await this.db.query(
      `UPDATE regions
          SET boundary = u.geom, center = COALESCE(center, ST_PointOnSurface(u.geom)), boundary_fetched_at = now()
         FROM (SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Union(boundary)), 3)) AS geom
                 FROM regions WHERE source_key = ANY($2) AND boundary IS NOT NULL) u
        WHERE id = $1 AND u.geom IS NOT NULL`,
      [regionId, parts],
    );
  }

  private async fromRadius(
    regionId: string,
    radiusMeters: number,
  ): Promise<void> {
    await this.db.query(
      `UPDATE regions
          SET boundary = ST_Multi(ST_Buffer(center::geography, $2)::geometry), boundary_fetched_at = now()
        WHERE id = $1 AND center IS NOT NULL`,
      [regionId, radiusMeters],
    );
  }
}

/** Chọn relation có tên khớp (bỏ dấu, bỏ tiền tố hành chính) với tên cần tìm. */
export function pickBoundary(
  candidates: OverpassElement[],
  name: string,
): OverpassElement | undefined {
  const wanted = searchKey(name);
  return candidates.find((candidate) => {
    const tags = candidate.tags ?? {};
    return [tags['name:vi'], tags.name, tags.official_name]
      .filter((value): value is string => value !== undefined)
      .some((value) => searchKey(value) === wanted);
  });
}
