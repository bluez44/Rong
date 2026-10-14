/**
 * Sinh `src/modules/regions/seed/province-bboxes.ts`: khung bao tỉnh cũ (trước
 * 1/7/2025) và tỉnh mới không sáp nhập, lấy từ Overpass MỘT LẦN rồi commit,
 * để app không còn gọi Overpass lúc chạy. Chạy lại khi sửa danh sách tỉnh.
 *
 *   cd apps/backend && npx tsx scripts/generate-province-bboxes.ts
 *
 * Sau sáp nhập, OSM giữ ranh giới tỉnh cũ dưới dạng `boundary=historic`
 * (`admin_level` hoặc `was:admin_level` = 4), tên "Tỉnh X", "Tỉnh X cũ" hay
 * "Tỉnh X (cũ)" khi tên X được tỉnh mới dùng lại. Nhờ vậy chỉ cần dữ liệu hiện
 * tại, không cần truy vấn lịch sử (`[date:…]`, nhiều máy Overpass không hỗ trợ
 * hoặc hết giờ).
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
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
/** Cùng khung Việt Nam với truy vấn ranh giới cũ trong OpenDataService. */
const VIETNAM_BBOX = '8.0,102.0,23.6,110.0';
/** Máy công cộng hay quá tải (504) hoặc reset kết nối: thử lại cả danh sách chừng này vòng. */
const ROUNDS = 5;
const ROUND_PAUSE_MS = 30_000;

async function relations(filter: string): Promise<OverpassElement[]> {
  const query = `[out:json][timeout:180];rel${filter}(${VIETNAM_BBOX});out tags bb;`;
  for (let round = 0; round < ROUNDS; round++) {
    if (round > 0) await new Promise((r) => setTimeout(r, ROUND_PAUSE_MS));
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
  }
  throw new Error('Mọi máy chủ Overpass đều lỗi; thử lại sau.');
}

function boundsOf(
  elements: OverpassElement[],
  names: string[],
  label: string,
): [number, number, number, number] {
  for (const name of names) {
    const b = pickRelation(elements, name)?.bounds;
    if (b) return [b.minlat, b.minlon, b.maxlat, b.maxlon];
  }
  throw new Error(`Không thấy relation tỉnh "${label}"`);
}

const historic = (await relations('["boundary"="historic"]')).filter(
  (e) => e.tags?.admin_level === '4' || e.tags?.['was:admin_level'] === '4',
);
const current = await relations(
  '["boundary"="administrative"]["admin_level"="4"]',
);

const out: Record<string, [number, number, number, number]> = {};
for (const p of OLD_PROVINCES) {
  const names = [p.name, ...(p.aliases ?? [])];
  // "X cũ" trước: khi có, "X" là tỉnh mới đã sáp nhập.
  out[p.key] = boundsOf(
    historic,
    [...names.map((n) => `${n} cũ`), ...names],
    p.name,
  );
}
for (const p of NEW_PROVINCES.filter((n) => n.mergedFrom.length === 0)) {
  out[p.key] = boundsOf(current, [p.name, ...(p.aliases ?? [])], p.name);
}

writeFileSync(
  new URL('../src/modules/regions/seed/province-bboxes.ts', import.meta.url),
  renderBboxes(out),
);
console.log(`Đã ghi ${Object.keys(out).length} khung bao.`);

/** Mỗi tỉnh một dòng, cùng kiểu với phần còn lại của seed. */
export function renderBboxes(
  boxes: Record<string, [number, number, number, number]>,
): string {
  const lines = Object.entries(boxes).map(
    // Như prettier: khóa là identifier hợp lệ thì không cần nháy.
    ([key, box]) =>
      `  ${/^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${key}'`}: [${box.join(', ')}],`,
  );
  return `import type { Bbox } from '../bbox.js';

/**
 * Khung bao [south, west, north, east] của tỉnh cũ (trước 1/7/2025) và tỉnh mới
 * không sáp nhập. SINH TỰ ĐỘNG bởi scripts/generate-province-bboxes.ts — không
 * sửa tay.
 */
export const PROVINCE_BBOXES: Record<string, Bbox> = {
${lines.join('\n')}
};
`;
}
