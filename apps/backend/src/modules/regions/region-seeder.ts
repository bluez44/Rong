import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { bboxAround } from './bbox.js';
import { RegionAlias } from './entities/region-alias.entity.js';
import { Region } from './entities/region.entity.js';
import { searchKey } from './search-text.js';
import {
  DESTINATIONS,
  NEW_PROVINCES,
  OLD_PROVINCES,
} from './seed/vietnam-admin.js';

/** Thời điểm lấy dữ liệu OSM "trước sáp nhập": một ngày trước khi địa giới mới có hiệu lực. */
export const PRE_MERGER_DATE = '2025-06-30T00:00:00Z';

const oldKey = (key: string) => `vn:province:${key}:pre_merger`;
const newKey = (key: string) => `vn:province:${key}:current`;
const destinationKey = (key: string) => `vn:destination:${key}`;

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
 * cập nhật; ranh giới đã tải và thời điểm tải địa điểm không bị đụng tới.
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
      })),
    ];
    const destinationRows: SeedRow[] = [
      ...DESTINATIONS.map((d) => {
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
      }),
    ];

    // Hai lệnh riêng: một lệnh upsert gộp sẽ ghi NULL vào khung bao của tỉnh
    // (cột có trong lệnh nhưng dòng tỉnh không có giá trị), xóa khung bao đã
    // lấy từ OSM mỗi lần khởi động.
    await this.regions.upsert(rows, ['sourceKey']);
    await this.regions.upsert(destinationRows, ['sourceKey']);

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
  }
}
