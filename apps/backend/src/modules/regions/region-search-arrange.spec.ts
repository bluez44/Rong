import { describe, expect, it } from 'vitest';

import {
  arrangeRegionResults,
  type RegionLite,
} from './region-search-arrange.js';

function region(id: string, patch: Partial<RegionLite>): RegionLite {
  return {
    id,
    name: id,
    type: 'administrative',
    boundaryVersion: 'current',
    level: 'province',
    parentId: null,
    formerParentId: null,
    successorRegionId: null,
    mergeNote: null,
    center: null,
    bbox: null,
    ...patch,
  };
}

const all = new Map(
  [
    region('lamdong-new', {
      name: 'Lâm Đồng',
      mergeNote: 'gồm Lâm Đồng cũ, Đắk Nông cũ, Bình Thuận cũ',
    }),
    region('lamdong-old', {
      name: 'Lâm Đồng',
      boundaryVersion: 'pre_merger',
      successorRegionId: 'lamdong-new',
    }),
    region('binhthuan-old', {
      name: 'Bình Thuận',
      boundaryVersion: 'pre_merger',
      successorRegionId: 'lamdong-new',
    }),
    region('hcm-new', { name: 'TP. Hồ Chí Minh', mergeNote: 'gồm …' }),
    region('brvt-old', {
      name: 'Bà Rịa - Vũng Tàu',
      boundaryVersion: 'pre_merger',
      successorRegionId: 'hcm-new',
    }),
    region('quangninh', { name: 'Quảng Ninh' }),
    region('dalat', {
      name: 'Đà Lạt',
      type: 'destination',
      level: null,
      parentId: 'lamdong-new',
      formerParentId: 'lamdong-old',
    }),
    region('vungtau', {
      name: 'Vũng Tàu',
      type: 'destination',
      level: null,
      parentId: 'hcm-new',
      formerParentId: 'brvt-old',
    }),
    region('halong', {
      name: 'Hạ Long',
      type: 'destination',
      level: null,
      parentId: 'quangninh',
    }),
  ].map((r) => [r.id, r]),
);

const names = (results: ReturnType<typeof arrangeRegionResults>) =>
  results.map((r) => `${r.displayName} | ${r.note ?? ''}`);

describe('arrangeRegionResults', () => {
  it('"lam dong" → Lâm Đồng (mới) rồi Lâm Đồng (cũ)', () => {
    const results = arrangeRegionResults(
      [
        { regionId: 'lamdong-old', score: 1 },
        { regionId: 'lamdong-new', score: 1 },
      ],
      all,
    );

    expect(names(results)).toEqual([
      'Lâm Đồng (mới) | gồm Lâm Đồng cũ, Đắk Nông cũ, Bình Thuận cũ',
      'Lâm Đồng (cũ) | nay thuộc Lâm Đồng (mới)',
    ]);
  });

  it('"binh thuan" → Bình Thuận (cũ) kèm Lâm Đồng (mới) "bao gồm Bình Thuận cũ"', () => {
    const results = arrangeRegionResults(
      [{ regionId: 'binhthuan-old', score: 1 }],
      all,
    );

    expect(names(results)).toEqual([
      'Bình Thuận (cũ) | nay thuộc Lâm Đồng (mới)',
      'Lâm Đồng (mới) | bao gồm Bình Thuận cũ',
    ]);
  });

  it('"da lat" → điểm đến lên đầu, kèm tỉnh mới và tỉnh cũ chứa nó', () => {
    const results = arrangeRegionResults(
      [{ regionId: 'dalat', score: 1 }],
      all,
    );

    expect(names(results)).toEqual([
      'Đà Lạt | thuộc Lâm Đồng (mới)',
      'Lâm Đồng (mới) | gồm Lâm Đồng cũ, Đắk Nông cũ, Bình Thuận cũ',
      'Lâm Đồng (cũ) | nay thuộc Lâm Đồng (mới)',
    ]);
    expect(results[0]).toMatchObject({
      group: 'destination',
      parent: { id: 'lamdong-new' },
    });
  });

  it('"vung tau" → Vũng Tàu (nay thuộc TP. Hồ Chí Minh) đứng đầu', () => {
    const results = arrangeRegionResults(
      [
        { regionId: 'vungtau', score: 1 },
        { regionId: 'brvt-old', score: 0.8 },
      ],
      all,
    );

    expect(names(results).slice(0, 3)).toEqual([
      'Vũng Tàu | nay thuộc TP. Hồ Chí Minh (mới)',
      'TP. Hồ Chí Minh (mới) | gồm …',
      'Bà Rịa - Vũng Tàu (cũ) | nay thuộc TP. Hồ Chí Minh (mới)',
    ]);
  });

  it('tỉnh không đổi địa giới chỉ có một kết quả, không nhãn "(mới)"', () => {
    const results = arrangeRegionResults(
      [{ regionId: 'halong', score: 1 }],
      all,
    );

    expect(names(results)).toEqual([
      'Hạ Long | thuộc Quảng Ninh',
      'Quảng Ninh | ',
    ]);
  });

  it('có kết quả khớp rõ thì bỏ kết quả khớp yếu', () => {
    const results = arrangeRegionResults(
      [
        { regionId: 'quangninh', score: 0.35 },
        { regionId: 'vungtau', score: 0.9 },
      ],
      all,
    );

    expect(results.map((r) => r.id)).not.toContain('quangninh');
  });

  it('chỉ có kết quả khớp yếu thì vẫn trả về (chịu lỗi chính tả)', () => {
    const results = arrangeRegionResults(
      [{ regionId: 'quangninh', score: 0.4 }],
      all,
    );

    expect(results.map((r) => r.id)).toEqual(['quangninh']);
  });

  it('khớp đúng bí danh của điểm đến cũng đưa điểm đến lên đầu', () => {
    const results = arrangeRegionResults(
      [{ regionId: 'dalat', score: 0.98 }],
      all,
    );

    expect(results[0].id).toBe('dalat');
  });

  it('vùng kéo theo xếp cùng nhóm với kết quả đã kéo nó vào ("hoi" → Hội An trước)', () => {
    const withHoiAn = new Map(all);
    withHoiAn.set(
      'danang-new',
      region('danang-new', { name: 'Đà Nẵng', mergeNote: 'gồm …' }),
    );
    withHoiAn.set(
      'hoian',
      region('hoian', {
        name: 'Hội An',
        type: 'destination',
        level: null,
        parentId: 'danang-new',
      }),
    );

    const results = arrangeRegionResults(
      [{ regionId: 'hoian', score: 0.9 }],
      withHoiAn,
    );

    expect(results.map((r) => r.id)).toEqual(['hoian', 'danang-new']);
  });
});
