import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { OpenDataService } from '../open-data/open-data.service.js';
import {
  bboxAround,
  bboxFromNominatim,
  pickRelation,
  unionBbox,
  type Bbox,
} from './bbox.js';
import type { AreaSource } from './entities/region.entity.js';

/** Bán kính mặc định khi vùng chỉ có một điểm. */
const FALLBACK_RADIUS_METERS = 5000;

interface AreaRow {
  id: string;
  name: string;
  parent_name: string | null;
  area_source: AreaSource | null;
  bbox: Bbox | null;
  lat: number | null;
  lng: number | null;
}

/**
 * Đảm bảo mỗi vùng có khung bao để lấy địa điểm (phương án B), dựng vòng tròn
 * quanh tâm khi không có khung (phương án A). Chỉ lưu 4 số, không lưu hình học
 * ranh giới.
 */
@Injectable()
export class RegionAreaService {
  private readonly logger = new Logger(RegionAreaService.name);
  private readonly inFlight = new Map<string, Promise<Bbox>>();

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly openData: OpenDataService,
  ) {}

  /** Hai request cùng lúc cho một vùng chỉ tính khung bao một lần. */
  ensure(regionId: string): Promise<Bbox> {
    let pending = this.inFlight.get(regionId);
    if (!pending) {
      pending = this.resolve(regionId).finally(() =>
        this.inFlight.delete(regionId),
      );
      this.inFlight.set(regionId, pending);
    }
    return pending;
  }

  private async resolve(regionId: string): Promise<Bbox> {
    const [row] = (await this.db.query(
      `SELECT r.id, r.name, p.name AS parent_name, r.area_source,
              CASE WHEN r.bbox_south IS NULL THEN NULL
                   ELSE ARRAY[r.bbox_south, r.bbox_west, r.bbox_north, r.bbox_east] END AS bbox,
              ST_Y(r.center) AS lat, ST_X(r.center) AS lng
         FROM regions r LEFT JOIN regions p ON p.id = r.parent_id
        WHERE r.id = $1`,
      [regionId],
    )) as AreaRow[];
    if (!row) throw this.unavailable('vùng này');
    if (row.bbox) return row.bbox;

    let bbox: Bbox | null = null;
    try {
      bbox = await this.compute(row);
    } catch (error) {
      this.logger.error(
        `Không lấy được khung bao cho "${row.name}"`,
        error as Error,
      );
    }
    if (bbox === null) throw this.unavailable(`"${row.name}"`);

    await this.db.query(
      `UPDATE regions
          SET bbox_south = $2, bbox_west = $3, bbox_north = $4, bbox_east = $5,
              center = COALESCE(center, ST_SetSRID(ST_MakePoint(($3::float8 + $5::float8) / 2, ($2::float8 + $4::float8) / 2), 4326)),
              area_fetched_at = now()
        WHERE id = $1`,
      [regionId, ...bbox],
    );
    return bbox;
  }

  private async compute(row: AreaRow): Promise<Bbox | null> {
    const source = row.area_source ?? {};

    if (source.unionOf) {
      const parts = (await this.db.query(
        `SELECT id FROM regions WHERE source_key = ANY($1)`,
        [source.unionOf],
      )) as Array<{ id: string }>;
      // Tuần tự: các tỉnh cũ dùng chung một danh sách relation được cache.
      const boxes: Bbox[] = [];
      for (const part of parts) boxes.push(await this.ensure(part.id));
      return unionBbox(boxes);
    }

    if (source.name && source.adminLevel) {
      const bounds = await this.findRelationBounds(
        source.name,
        source.adminLevel,
        source.date,
      );
      if (bounds) return bounds;
      this.logger.warn(
        `Không thấy relation "${source.name}" (cấp ${source.adminLevel}${source.date ? `, ngày ${source.date}` : ''}) trên OSM; dùng phương án dự phòng.`,
      );
    }

    if (row.lat !== null && row.lng !== null) {
      return bboxAround(
        row.lat,
        row.lng,
        source.radiusMeters ?? FALLBACK_RADIUS_METERS,
      );
    }

    // Phương án cuối: hỏi Nominatim vị trí của vùng (kèm tên tỉnh cho đỡ nhầm).
    const query = row.parent_name
      ? `${row.name}, ${row.parent_name}`
      : row.name;
    const [hit] = await this.openData.searchPlaces(query, 1);
    if (!hit) return null;
    return (
      bboxFromNominatim(hit) ??
      bboxAround(Number(hit.lat), Number(hit.lon), FALLBACK_RADIUS_METERS)
    );
  }

  /**
   * Tìm theo phần tên chính trước (truy vấn nhỏ, lọc tên ngay trên Overpass),
   * rồi mới lấy cả danh sách cấp đó nếu tên trên OSM viết khác đi (dấu, gạch
   * nối…) — `pickRelation` so khớp sau khi bỏ dấu nên vẫn nhận ra.
   */
  private async findRelationBounds(
    name: string,
    adminLevel: string,
    date?: string,
  ): Promise<Bbox | null> {
    const core = name.replace(/^(Tỉnh|Thành phố|Thị xã|Huyện|Quận)\s+/i, '');
    for (const nameContains of [core, undefined]) {
      const candidates = await this.openData.listBoundaries(
        adminLevel,
        date,
        nameContains,
      );
      const bounds = pickRelation(candidates, name)?.bounds;
      if (bounds)
        return [bounds.minlat, bounds.minlon, bounds.maxlat, bounds.maxlon];
    }
    return null;
  }

  private unavailable(what: string): ServiceUnavailableException {
    return new ServiceUnavailableException({
      statusCode: 503,
      code: 'AREA_UNAVAILABLE',
      message: `Chưa xác định được khu vực của ${what}. Hãy thử lại sau.`,
    });
  }
}
