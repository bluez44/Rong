import type { Bbox } from '../bbox.js';
import { PROVINCE_BBOXES } from './province-bboxes.js';
import { NEW_PROVINCES } from './vietnam-admin.js';

/** Xã/phường sau 1/7/2025 (spec 2026-10-21-ward-search §1). */
export interface WardSeed {
  code: string;
  name: string;
  fullName: string;
  provinceKey: string;
  formerProvinceKey: string | null;
  /** [vĩ độ, kinh độ] */
  center: [number, number] | null;
  /** [nam, tây, bắc, đông] */
  bbox: Bbox | null;
}

export interface WardSeedFile {
  source: string;
  version: string;
  wards: WardSeed[];
}

export interface DatasetProvince {
  Code: string;
  CodeName: string;
  Wards: Array<{
    Code: string;
    Name: string;
    FullName: string;
    ProvinceCode: string;
  }>;
}

export type Geometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

const round = (n: number) => Math.round(n * 1e5) / 1e5;

/** Khung bao từ các vòng ngoài của Polygon/MultiPolygon (GeoJSON: [kinh độ, vĩ độ]). */
export function geometryBbox(geometry: {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: unknown;
}): Bbox {
  const rings =
    geometry.type === 'Polygon'
      ? [(geometry.coordinates as number[][][])[0]]
      : (geometry.coordinates as number[][][][]).map((poly) => poly[0]);
  let south = Infinity,
    west = Infinity,
    north = -Infinity,
    east = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      south = Math.min(south, lat);
      north = Math.max(north, lat);
      west = Math.min(west, lng);
      east = Math.max(east, lng);
    }
  }
  return [round(south), round(west), round(north), round(east)];
}

/** Tỉnh cũ có khung bao chứa tâm xã; nhiều tỉnh chứa thì lấy khung nhỏ nhất. */
export function pickFormerProvince(
  [lat, lng]: [number, number],
  candidates: Array<{ key: string; bbox: Bbox }>,
): string | null {
  const area = ([s, w, n, e]: Bbox) => (n - s) * (e - w);
  const containing = candidates.filter(
    ({ bbox: [s, w, n, e] }) => lat >= s && lat <= n && lng >= w && lng <= e,
  );
  containing.sort((a, b) => area(a.bbox) - area(b.bbox));
  return containing[0]?.key ?? null;
}

export function buildWardSeed(
  units: DatasetProvince[],
  geometryByCode: Map<string, Geometry>,
  version: string,
): WardSeedFile {
  const wards: WardSeed[] = [];
  for (const province of units) {
    const key = province.CodeName.replace(/_/g, '-');
    const target = NEW_PROVINCES.find((p) => p.key === key);
    if (!target)
      throw new Error(
        `Tỉnh "${key}" (mã ${province.Code}) không có trong NEW_PROVINCES`,
      );
    const formerCandidates = target.mergedFrom
      .filter((k) => PROVINCE_BBOXES[k])
      .map((k) => ({ key: k, bbox: PROVINCE_BBOXES[k] }));

    for (const ward of province.Wards) {
      const geometry = geometryByCode.get(ward.Code);
      const bbox = geometry ? geometryBbox(geometry) : null;
      const center: [number, number] | null = bbox
        ? [round((bbox[0] + bbox[2]) / 2), round((bbox[1] + bbox[3]) / 2)]
        : null;
      wards.push({
        code: ward.Code,
        name: ward.Name,
        fullName: ward.FullName,
        provinceKey: key,
        formerProvinceKey: center
          ? pickFormerProvince(center, formerCandidates)
          : null,
        center,
        bbox,
      });
    }
  }
  return {
    source: `thanglequoc/vietnamese-provinces-database ${version} (MIT)`,
    version,
    wards,
  };
}
