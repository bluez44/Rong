// apps/backend/scripts/generate-ward-seed.ts
/**
 * Sinh `src/modules/regions/seed/vietnam-wards.json`: 3.321 xã/phường sau 1/7/2025 kèm khung bao,
 * từ bộ dữ liệu MIT thanglequoc/vietnamese-provinces-database. Chạy lại khi địa giới đổi.
 *
 *   V=v5.2.0
 *   curl -L -o /tmp/units.json "https://raw.githubusercontent.com/thanglequoc/vietnamese-provinces-database/$V/json/simplified_json_generated_data_vn_units.json"
 *   curl -L -o /tmp/geo.zip "https://raw.githubusercontent.com/thanglequoc/vietnamese-provinces-database/$V/json/vn_provinces_wards_geojson.zip"
 *   unzip -q /tmp/geo.zip -d /tmp/geo
 *   cd apps/backend && npx tsx scripts/generate-ward-seed.ts /tmp/units.json /tmp/geo/geojson $V
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildWardSeed,
  type DatasetProvince,
  type Geometry,
} from '../src/modules/regions/seed/ward-seed-builder.js';

const [unitsPath, geoDir, version] = process.argv.slice(2);
if (!unitsPath || !geoDir || !version) {
  console.error(
    'Dùng: npx tsx scripts/generate-ward-seed.ts <units.json> <thư mục geojson> <phiên bản>',
  );
  process.exit(1);
}

const units = JSON.parse(readFileSync(unitsPath, 'utf8')) as DatasetProvince[];
const geometryByCode = new Map<string, Geometry>();
for (const province of readdirSync(geoDir)) {
  let files: string[] = [];
  try {
    files = readdirSync(join(geoDir, province, 'wards'));
  } catch {
    continue;
  }
  for (const file of files.filter((f) => f.endsWith('.geojson'))) {
    const doc = JSON.parse(
      readFileSync(join(geoDir, province, 'wards', file), 'utf8'),
    ) as {
      features: Array<{ properties: { code: string }; geometry: Geometry }>;
    };
    for (const f of doc.features)
      geometryByCode.set(f.properties.code, f.geometry);
  }
}

const seed = buildWardSeed(units, geometryByCode, version);
const missing = seed.wards.filter((w) => w.bbox === null);
writeFileSync(
  new URL('../src/modules/regions/seed/vietnam-wards.json', import.meta.url),
  `${JSON.stringify(seed)}\n`,
);
console.log(
  `Đã ghi ${seed.wards.length} xã (kỳ vọng 3321); thiếu ranh giới: ${missing.length}`,
);
for (const w of missing)
  console.log(`  - ${w.fullName} (${w.code}, ${w.provinceKey})`);
