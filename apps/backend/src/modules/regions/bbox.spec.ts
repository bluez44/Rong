import { describe, expect, it } from 'vitest';

import type { NominatimResult } from '../open-data/open-data.types.js';
import { bboxAround, bboxFromNominatim, unionBbox } from './bbox.js';

const nominatim = (
  boundingbox: NominatimResult['boundingbox'],
): NominatimResult => ({
  osm_type: 'relation',
  osm_id: 1,
  lat: '0',
  lon: '0',
  name: 'x',
  display_name: 'x',
  category: 'boundary',
  type: 'administrative',
  addresstype: 'city',
  boundingbox,
});

describe('bbox', () => {
  it('vòng tròn 10 km quanh Đà Lạt ra khung ~0.18° cả hai chiều', () => {
    const [s, w, n, e] = bboxAround(11.94, 108.44, 10_000);
    expect(n - s).toBeCloseTo(0.1797, 3);
    // Kinh độ co lại theo cos(vĩ độ) nên khung rộng hơn một chút theo độ.
    expect(e - w).toBeCloseTo(0.1837, 3);
  });

  it('tỉnh mới bao trọn các tỉnh cũ', () => {
    expect(
      unionBbox([
        [11.5, 107.5, 12.5, 108.5],
        [10.5, 107.5, 11.5, 108.5],
        [11.5, 107.0, 12.5, 107.5],
      ]),
    ).toEqual([10.5, 107.0, 12.5, 108.5]);
    expect(unionBbox([])).toBeNull();
  });

  it('đọc boundingbox của Nominatim (nam, bắc, tây, đông) và bỏ khung gần như một điểm', () => {
    expect(
      bboxFromNominatim(nominatim(['11.85', '12.05', '108.3', '108.5'])),
    ).toEqual([11.85, 108.3, 12.05, 108.5]);
    expect(
      bboxFromNominatim(nominatim(['11.94', '11.9401', '108.44', '108.4401'])),
    ).toBeNull();
    expect(bboxFromNominatim(nominatim(undefined))).toBeNull();
  });
});
