/**
 * Sinh `src/modules/regions/seed/province-bboxes.ts`: khung bao tỉnh cũ (ngày
 * 30/6/2025) và tỉnh mới không sáp nhập, lấy từ Overpass MỘT LẦN rồi commit,
 * để app không còn gọi Overpass lúc chạy. Chạy lại khi sửa danh sách tỉnh.
 *
 *   cd apps/backend && npx tsx scripts/generate-province-bboxes.ts
 *
 * Cần mạng ra Overpass (overpass-api.de hoặc các bản sao bên dưới).
 */
import { writeFileSync } from 'node:fs';

import type { OverpassElement } from '../src/modules/open-data/open-data.types.js';
import { pickRelation } from '../src/modules/regions/bbox.js';
import {
  NEW_PROVINCES,
  OLD_PROVINCES,
} from '../src/modules/regions/seed/vietnam-admin.js';

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
/** Trùng `PRE_MERGER_DATE` của region-seeder: địa giới trước sáp nhập. */
const PRE_MERGER_DATE = '2025-06-30T00:00:00Z';
/** Cùng khung Việt Nam với truy vấn ranh giới cũ trong OpenDataService. */
const VIETNAM_BBOX = [8.0, 102.0, 23.6, 110.0];

async function boundaries(date?: string): Promise<OverpassElement[]> {
  const [s, w, n, e] = VIETNAM_BBOX;
  const query = `[out:json][timeout:180]${date ? `[date:"${date}"]` : ''};rel["boundary"="administrative"]["admin_level"="4"](${s},${w},${n},${e});out tags bb;`;
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        headers: {
          'User-Agent': 'rong-seed/1.0 (scripts/generate-province-bboxes.ts)',
        },
        signal: AbortSignal.timeout(200_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { elements?: OverpassElement[] };
      if (!body.elements?.length)
        throw new Error('Overpass trả danh sách rỗng');
      return body.elements;
    } catch (error) {
      console.warn(`${url}: ${(error as Error).message}`);
    }
  }
  throw new Error('Mọi máy chủ Overpass đều lỗi; thử lại sau.');
}

function boundsOf(
  elements: OverpassElement[],
  province: { name: string; aliases?: string[] },
): [number, number, number, number] {
  for (const name of [province.name, ...(province.aliases ?? [])]) {
    const b = pickRelation(elements, name)?.bounds;
    if (b) return [b.minlat, b.minlon, b.maxlat, b.maxlon];
  }
  throw new Error(`Không thấy relation tỉnh "${province.name}"`);
}

const out: Record<string, [number, number, number, number]> = {};
const old = await boundaries(PRE_MERGER_DATE);
for (const p of OLD_PROVINCES) out[p.key] = boundsOf(old, p);
const current = await boundaries();
for (const p of NEW_PROVINCES.filter((n) => n.mergedFrom.length === 0)) {
  out[p.key] = boundsOf(current, p);
}

writeFileSync(
  new URL('../src/modules/regions/seed/province-bboxes.ts', import.meta.url),
  `/**
 * Khung bao [south, west, north, east] của tỉnh cũ (30/6/2025) và tỉnh mới không
 * sáp nhập. SINH TỰ ĐỘNG bởi scripts/generate-province-bboxes.ts — không sửa tay.
 */
export const PROVINCE_BBOXES: Record<string, [number, number, number, number]> = ${JSON.stringify(out, null, 2)};
`,
);
console.log(`Đã ghi ${Object.keys(out).length} khung bao.`);
