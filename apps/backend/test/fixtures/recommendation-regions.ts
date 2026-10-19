import type { DataSource } from 'typeorm';

/** Ba vùng thật (seed) và danh sách địa điểm giả đứng đầu danh sách của mỗi vùng. */
export const FIXTURE_REGIONS = [
  { sourceKey: 'vn:destination:da-lat', lat: 11.94, lng: 108.44 },
  { sourceKey: 'vn:destination:vung-tau', lat: 10.35, lng: 107.08 },
  { sourceKey: 'vn:destination:phu-quoc', lat: 10.22, lng: 103.96 },
] as const;

const VISITS = ['nature', 'culture', 'check_in', 'cafe', 'kids', 'nature', 'culture', 'check_in', 'cafe', 'nature', 'culture', 'check_in'];
const FOOD = ['food', 'food', 'food', 'food'];

export interface FixtureRegion {
  id: string;
  sourceKey: string;
  placeIds: string[];
  visitIds: string[];
}

/**
 * Mỗi vùng: 12 điểm tham quan + 4 quán ăn tên `E2E rec <prefix> …`, hạng âm để
 * đứng trước dữ liệu thật trong DB dev. Đảm bảo vùng có danh sách `ready`.
 */
export async function seedRecommendationRegions(
  db: DataSource,
  prefix: string,
): Promise<FixtureRegion[]> {
  const out: FixtureRegion[] = [];
  for (const region of FIXTURE_REGIONS) {
    const [{ id }] = (await db.query(
      `SELECT id FROM regions WHERE source_key = $1`,
      [region.sourceKey],
    )) as Array<{ id: string }>;
    await db.query(
      `INSERT INTO region_place_lists (region_id, status, fetched_at, expires_at)
       VALUES ($1, 'ready', now(), now() + interval '30 days')
       ON CONFLICT (region_id) DO UPDATE SET status = 'ready',
         fetched_at = COALESCE(region_place_lists.fetched_at, now())`,
      [id],
    );
    const placeIds: string[] = [];
    const visitIds: string[] = [];
    for (const [i, category] of [...VISITS, ...FOOD].entries()) {
      const [row] = (await db.query(
        `INSERT INTO places (source, name, category, location, location_source)
         VALUES ('web', $1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), 'ai')
         RETURNING id`,
        [
          `E2E rec ${prefix} ${region.sourceKey} ${i}`,
          category,
          region.lng + (i % 4) * 0.005,
          region.lat + Math.floor(i / 4) * 0.005,
        ],
      )) as Array<{ id: string }>;
      await db.query(
        `INSERT INTO region_places (region_id, place_id, rank) VALUES ($1, $2, $3)`,
        [id, row.id, -1000 + i],
      );
      placeIds.push(row.id);
      if (category !== 'food') visitIds.push(row.id);
    }
    out.push({ id, sourceKey: region.sourceKey, placeIds, visitIds });
  }
  return out;
}

export async function cleanupRecommendationRegions(
  db: DataSource,
  prefix: string,
): Promise<void> {
  const like = `E2E rec ${prefix} %`;
  await db.query(
    `DELETE FROM itinerary_drafts d
      WHERE EXISTS (SELECT 1 FROM places p WHERE p.id = ANY(d.place_ids) AND p.name LIKE $1)`,
    [like],
  );
  await db.query(
    `DELETE FROM region_places rp USING places p WHERE rp.place_id = p.id AND p.name LIKE $1`,
    [like],
  );
  await db.query(`DELETE FROM places WHERE name LIKE $1`, [like]);
}
