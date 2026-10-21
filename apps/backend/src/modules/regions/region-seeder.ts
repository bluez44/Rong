import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { bboxAround, unionBbox, type Bbox } from './bbox.js';
import { RegionAlias } from './entities/region-alias.entity.js';
import { Region } from './entities/region.entity.js';
import { foldText, searchKey } from './search-text.js';
import { PROVINCE_BBOXES } from './seed/province-bboxes.js';
import {
  DESTINATIONS,
  NEW_PROVINCES,
  OLD_PROVINCES,
} from './seed/vietnam-admin.js';
import wardsFile from './seed/vietnam-wards.json' with { type: 'json' };
import type { WardSeedFile } from './seed/ward-seed-builder.js';

/** Ngày cuối của địa giới "trước sáp nhập" (ghi trong `area_source` để tham khảo). */
export const PRE_MERGER_DATE = '2025-06-30T00:00:00Z';

const oldKey = (key: string) => `vn:province:${key}:pre_merger`;
const newKey = (key: string) => `vn:province:${key}:current`;
const destinationKey = (key: string) => `vn:destination:${key}`;
/**
 * Tăng khi cách seed xã thay đổi mà dữ liệu nguồn giữ nguyên, để lần khởi động sau seed lại.
 * r2: bí danh xã dùng `foldText` (r1 dùng `searchKey`, làm "Quan Sơn" thành "son").
 */
const WARD_SEED_REVISION = 'r2';

type SeedRow = Pick<
  Region,
  | 'sourceKey'
  | 'name'
  | 'type'
  | 'boundaryVersion'
  | 'level'
  | 'mergeNote'
  | 'searchName'
  | 'areaSource'
> &
  Partial<
    Pick<Region, 'center' | 'bboxSouth' | 'bboxWest' | 'bboxNorth' | 'bboxEast'>
  >;

/**
 * Đưa dữ liệu tham chiếu (tỉnh cũ/mới, điểm đến) vào database mỗi lần khởi
 * động. Idempotent nhờ `source_key`, nên sửa file seed rồi khởi động lại là
 * cập nhật (kể cả khung bao tỉnh, sinh sẵn trong `seed/province-bboxes.ts`).
 */
@Injectable()
export class RegionSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(RegionSeeder.name);

  constructor(
    @InjectRepository(Region) private readonly regions: Repository<Region>,
    @InjectRepository(RegionAlias)
    private readonly aliases: Repository<RegionAlias>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const rows: SeedRow[] = [
      ...OLD_PROVINCES.map((p) => ({
        sourceKey: oldKey(p.key),
        name: p.name,
        type: 'administrative' as const,
        boundaryVersion: 'pre_merger' as const,
        level: 'province' as const,
        mergeNote: null,
        searchName: searchKey(p.name),
        areaSource: {
          name: p.name,
          adminLevel: '4',
          date: PRE_MERGER_DATE,
        },
        ...area(PROVINCE_BBOXES[p.key]),
      })),
      ...NEW_PROVINCES.map((p) => ({
        sourceKey: newKey(p.key),
        name: p.name,
        type: 'administrative' as const,
        boundaryVersion: 'current' as const,
        level: 'province' as const,
        mergeNote:
          p.mergedFrom.length > 0
            ? `gồm ${p.mergedFrom.map((k) => `${OLD_PROVINCES.find((o) => o.key === k)!.name} cũ`).join(', ')}`
            : null,
        searchName: searchKey(p.name),
        // Tỉnh mới bao trọn các tỉnh cũ, đúng theo định nghĩa của nghị quyết sáp nhập.
        areaSource:
          p.mergedFrom.length > 0
            ? { unionOf: p.mergedFrom.map(oldKey) }
            : { name: p.name, adminLevel: '4' },
        ...area(
          p.mergedFrom.length > 0
            ? unionBbox(p.mergedFrom.map((k) => PROVINCE_BBOXES[k]))!
            : PROVINCE_BBOXES[p.key],
        ),
      })),
    ];
    const destinationRows: SeedRow[] = DESTINATIONS.map((d) => {
      // Khu vực điểm đến cố định trong seed: có ngay khung bao, không cần gọi OSM.
      const [lat, lng] = d.center;
      const [south, west, north, east] = bboxAround(
        lat,
        lng,
        d.radiusKm * 1000,
      );
      return {
        sourceKey: destinationKey(d.key),
        name: d.name,
        type: 'destination' as const,
        boundaryVersion: 'current' as const,
        level: null,
        mergeNote: null,
        searchName: searchKey(d.name),
        areaSource: { radiusMeters: d.radiusKm * 1000 },
        center: { type: 'Point' as const, coordinates: [lng, lat] },
        bboxSouth: south,
        bboxWest: west,
        bboxNorth: north,
        bboxEast: east,
      };
    });

    // Khung bao trong seed ghi đè khung đã có: sửa seed rồi khởi động lại là cập nhật.
    await this.regions.upsert([...rows, ...destinationRows], ['sourceKey']);

    const ids = new Map(
      (await this.regions.find({ select: { id: true, sourceKey: true } })).map(
        (r) => [r.sourceKey, r.id],
      ),
    );
    const id = (key: string) => ids.get(key) ?? null;

    const successors = new Map<string, string>();
    for (const p of NEW_PROVINCES) {
      for (const k of p.mergedFrom) successors.set(k, p.key);
    }

    const links = [
      ...OLD_PROVINCES.map((p) => ({
        source_key: oldKey(p.key),
        successor_region_id: id(newKey(successors.get(p.key)!)),
        parent_id: null,
        former_parent_id: null,
      })),
      ...DESTINATIONS.map((d) => ({
        source_key: destinationKey(d.key),
        successor_region_id: null,
        parent_id: id(newKey(d.province)),
        former_parent_id: d.formerProvince
          ? id(oldKey(d.formerProvince))
          : null,
      })),
    ];
    await this.regions.query(
      `UPDATE regions r
          SET successor_region_id = l.successor_region_id,
              parent_id = l.parent_id,
              former_parent_id = l.former_parent_id
         FROM jsonb_to_recordset($1::jsonb)
              AS l(source_key text, successor_region_id uuid, parent_id uuid, former_parent_id uuid)
        WHERE r.source_key = l.source_key`,
      [JSON.stringify(links)],
    );

    const aliasRows = [
      ...OLD_PROVINCES.flatMap((p) =>
        (p.aliases ?? []).map((a) => [oldKey(p.key), a] as const),
      ),
      ...NEW_PROVINCES.flatMap((p) =>
        (p.aliases ?? []).map((a) => [newKey(p.key), a] as const),
      ),
      ...DESTINATIONS.flatMap((d) =>
        (d.aliases ?? []).map((a) => [destinationKey(d.key), a] as const),
      ),
    ].map(([key, alias]) => ({
      regionId: id(key)!,
      alias,
      searchAlias: searchKey(alias),
    }));

    await this.aliases
      .createQueryBuilder()
      .insert()
      .values(aliasRows)
      .orIgnore()
      .execute();

    this.logger.log(
      `Đã seed ${rows.length} vùng và ${aliasRows.length} bí danh.`,
    );

    await this.seedWards(id);
  }

  /** 3.321 xã/phường (spec 2026-10-21-ward-search §1.2). Bỏ qua khi đã seed đúng phiên bản. */
  private async seedWards(id: (key: string) => string | null): Promise<void> {
    const { version: dataVersion, wards } = wardsFile as WardSeedFile;
    // Ghi vào `area_source.dataset`: phiên bản dữ liệu + lần sửa cách seed.
    const version = `${dataVersion}+${WARD_SEED_REVISION}`;
    const [state] = (await this.regions.query(
      `SELECT count(*) FILTER (WHERE area_source->>'dataset' = $1)::int AS current
         FROM regions WHERE source_key LIKE 'vn:ward:%'`,
      [version],
    )) as Array<{ current: number }>;
    if (state.current === wards.length) {
      this.logger.log(
        `Xã/phường ${version} đã có (${wards.length}), bỏ qua seed xã.`,
      );
      return;
    }

    const rows = wards.map((w) => ({
      source_key: `vn:ward:${w.code}`,
      name: w.fullName,
      search_name: searchKey(w.fullName),
      parent_id: id(newKey(w.provinceKey)),
      former_parent_id: w.formerProvinceKey
        ? id(oldKey(w.formerProvinceKey))
        : null,
      lat: w.center?.[0] ?? null,
      lng: w.center?.[1] ?? null,
      south: w.bbox?.[0] ?? null,
      west: w.bbox?.[1] ?? null,
      north: w.bbox?.[2] ?? null,
      east: w.bbox?.[3] ?? null,
    }));
    // Một transaction: dừng giữa chừng thì không để lại dòng đã đánh dấu phiên bản mà thiếu bí danh.
    await this.regions.manager.transaction(async (m) => {
      // Một câu cho cả 3.321 dòng: upsert từng dòng qua TypeORM mất vài chục giây trên Neon.
      await m.query(
        `INSERT INTO regions (source_key, name, type, boundary_version, level, parent_id, former_parent_id,
                            search_name, center, bbox_south, bbox_west, bbox_north, bbox_east, area_source)
       SELECT w.source_key, w.name, 'administrative', 'current', 'ward', w.parent_id, w.former_parent_id,
              w.search_name,
              CASE WHEN w.lat IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(w.lng, w.lat), 4326) END,
              w.south, w.west, w.north, w.east, jsonb_build_object('dataset', $2::text)
         FROM jsonb_to_recordset($1::jsonb) AS w(
              source_key text, name text, search_name text, parent_id uuid, former_parent_id uuid,
              lat float8, lng float8, south float8, west float8, north float8, east float8)
       ON CONFLICT (source_key) DO UPDATE SET
              name = EXCLUDED.name, type = EXCLUDED.type, level = EXCLUDED.level,
              boundary_version = EXCLUDED.boundary_version, search_name = EXCLUDED.search_name,
              parent_id = EXCLUDED.parent_id, former_parent_id = EXCLUDED.former_parent_id,
              center = EXCLUDED.center, bbox_south = EXCLUDED.bbox_south, bbox_west = EXCLUDED.bbox_west,
              bbox_north = EXCLUDED.bbox_north, bbox_east = EXCLUDED.bbox_east,
              area_source = EXCLUDED.area_source`,
        [JSON.stringify(rows), version],
      );
      // Bí danh của xã chỉ do seed tạo: xóa rồi ghi lại, để sửa cả bí danh sai của lần seed trước.
      await m.query(
        `DELETE FROM region_aliases
        WHERE region_id IN (SELECT id FROM regions WHERE source_key LIKE 'vn:ward:%')`,
      );
      // Tên ngắn ("Phước Hải") làm bí danh: gõ không có tiền tố xã/phường vẫn khớp đúng. Dùng
      // `foldText`, không dùng `searchKey`: tên ngắn không có tiền tố, mà "Quan Sơn", "Phương Bình"
      // lại mở đầu bằng chữ giống tiền tố hành chính.
      await m.query(
        `INSERT INTO region_aliases (region_id, alias, search_alias)
       SELECT r.id, a.alias, a.search_alias
         FROM jsonb_to_recordset($1::jsonb) AS a(source_key text, alias text, search_alias text)
         JOIN regions r ON r.source_key = a.source_key
       ON CONFLICT ON CONSTRAINT uq_region_alias DO NOTHING`,
        [
          JSON.stringify(
            wards.map((w) => ({
              source_key: `vn:ward:${w.code}`,
              alias: w.name,
              search_alias: foldText(w.name),
            })),
          ),
        ],
      );
    });
    this.logger.log(`Đã seed ${wards.length} xã/phường (${version}).`);
  }
}

/** Khung bao và tâm của một tỉnh, lấy từ seed (không gọi Overpass lúc chạy). */
function area(
  box: Bbox,
): Pick<
  Region,
  'center' | 'bboxSouth' | 'bboxWest' | 'bboxNorth' | 'bboxEast'
> {
  const [south, west, north, east] = box;
  return {
    center: {
      type: 'Point',
      coordinates: [(west + east) / 2, (south + north) / 2],
    },
    bboxSouth: south,
    bboxWest: west,
    bboxNorth: north,
    bboxEast: east,
  };
}
