import { describe, expect, it } from 'vitest';

import {
  buildWardSeed,
  geometryBbox,
  pickFormerProvince,
} from './ward-seed-builder.js';

describe('geometryBbox', () => {
  it('Polygon và MultiPolygon (chỉ vòng ngoài), làm tròn 5 chữ số', () => {
    expect(
      geometryBbox({
        type: 'Polygon',
        coordinates: [
          [
            [107.1, 10.2],
            [107.3, 10.4],
            [107.2, 10.123456],
          ],
        ],
      }),
    ).toEqual([10.12346, 107.1, 10.4, 107.3]);
    expect(
      geometryBbox({
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [1, 2],
              [3, 4],
            ],
          ],
          [
            [
              [5, 0],
              [0, 6],
            ],
          ],
        ],
      }),
    ).toEqual([0, 0, 6, 5]);
  });
});

describe('pickFormerProvince', () => {
  it('chọn khung nhỏ nhất chứa tâm; không khung nào chứa thì null', () => {
    const big = {
      key: 'lon',
      bbox: [10, 106, 12, 108] as [number, number, number, number],
    };
    const small = {
      key: 'nho',
      bbox: [10.3, 107.3, 10.6, 107.7] as [number, number, number, number],
    };
    expect(pickFormerProvince([10.4, 107.5], [big, small])).toBe('nho');
    expect(pickFormerProvince([11.5, 106.5], [big, small])).toBe('lon');
    expect(pickFormerProvince([20, 100], [big, small])).toBeNull();
  });
});

describe('buildWardSeed', () => {
  const units = [
    {
      Code: '79',
      CodeName: 'ho_chi_minh',
      Wards: [
        {
          Code: '26686',
          Name: 'Phước Hải',
          FullName: 'Xã Phước Hải',
          ProvinceCode: '79',
        },
        {
          Code: '99999',
          Name: 'Không Hình',
          FullName: 'Phường Không Hình',
          ProvinceCode: '79',
        },
      ],
    },
  ];
  const geo = new Map([
    [
      '26686',
      {
        type: 'Polygon' as const,
        coordinates: [
          [
            [107.47, 10.39],
            [107.58, 10.47],
          ],
        ],
      },
    ],
  ]);

  it('dựng xã với tỉnh mới, tỉnh cũ theo khung bao, tâm và khung; thiếu hình học thì null', () => {
    const file = buildWardSeed(units, geo, 'v5.2.0');
    expect(file.version).toBe('v5.2.0');
    expect(file.wards[0]).toEqual({
      code: '26686',
      name: 'Phước Hải',
      fullName: 'Xã Phước Hải',
      provinceKey: 'ho-chi-minh',
      formerProvinceKey: 'ba-ria-vung-tau',
      center: [10.43, 107.525],
      bbox: [10.39, 107.47, 10.47, 107.58],
    });
    expect(file.wards[1]).toMatchObject({
      code: '99999',
      center: null,
      bbox: null,
      formerProvinceKey: null,
    });
  });

  it('tỉnh không khớp NEW_PROVINCES thì ném lỗi', () => {
    expect(() =>
      buildWardSeed([{ ...units[0], CodeName: 'khong_co' }], geo, 'v'),
    ).toThrow(/khong-co/);
  });
});
