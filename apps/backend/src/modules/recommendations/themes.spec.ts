import { describe, expect, it } from 'vitest';

import {
  DESTINATIONS,
  NEW_PROVINCES,
  OLD_PROVINCES,
} from '../regions/seed/vietnam-admin.js';
import { cardTitle, reasonText } from './copy.js';
import {
  CATEGORY_LABELS,
  FEATURED_REGION_SOURCE_KEYS,
  FIXED_THEMES,
  sanitizeThemes,
  THEME_ICONS,
} from './themes.js';

/** Khóa như `region-seeder.ts`. */
const seededKeys = new Set([
  ...OLD_PROVINCES.map((p) => `vn:province:${p.key}:pre_merger`),
  ...NEW_PROVINCES.map((p) => `vn:province:${p.key}:current`),
  ...DESTINATIONS.map((d) => `vn:destination:${d.key}`),
]);

describe('danh mục chủ đề', () => {
  it('mọi source_key của vùng nổi bật và chủ đề cố định có trong seed', () => {
    const keys = [
      ...FEATURED_REGION_SOURCE_KEYS,
      ...FIXED_THEMES.flatMap((t) => t.regionSourceKeys ?? []),
    ];
    expect(keys.filter((k) => !seededKeys.has(k))).toEqual([]);
  });
  it('khóa chủ đề không trùng, icon hợp lệ, không dùng danh mục Lưu trú', () => {
    expect(new Set(FIXED_THEMES.map((t) => t.key)).size).toBe(FIXED_THEMES.length);
    for (const t of FIXED_THEMES) {
      expect(THEME_ICONS).toContain(t.icon);
      expect(t.categories).not.toContain('stay');
      expect(t.categories.length).toBeGreaterThan(0);
    }
  });
});

describe('sanitizeThemes', () => {
  const allowed = new Set(['r1', 'r2']);
  it('bỏ vùng bịa, danh mục lạ, icon lạ, cắt nhãn, bỏ chủ đề rỗng, tối đa 3', () => {
    const clean = sanitizeThemes(
      [
        { label: '  Xứ sở dừa  ', icon: 'kayak', categories: ['nature', 'beach', 'stay'], regionIds: ['r1', 'bia', 'r1'] },
        { label: 'x'.repeat(200), icon: 'rocket', categories: ['cafe'], regionIds: ['r2'] },
        { label: 'Không vùng', icon: 'sun', categories: ['nature'], regionIds: ['bia'] },
        { label: 'Không danh mục', icon: 'sun', categories: ['beach'], regionIds: ['r1'] },
        { label: '', icon: 'sun', categories: ['cafe'], regionIds: ['r1'] },
        { label: 'Thứ tư', icon: 'sun', categories: ['cafe'], regionIds: ['r1'] },
        { label: 'Thứ năm', icon: 'sun', categories: ['cafe'], regionIds: ['r1'] },
      ],
      allowed,
    );
    expect(clean).toEqual([
      { label: 'Xứ sở dừa', icon: 'kayak', categories: ['nature'], regionIds: ['r1'] },
      { label: 'x'.repeat(40), icon: 'sparkles', categories: ['cafe'], regionIds: ['r2'] },
      { label: 'Thứ tư', icon: 'sun', categories: ['cafe'], regionIds: ['r1'] },
    ]);
  });
});

describe('câu chữ trên thẻ', () => {
  it('lý do: sở thích, số nơi mới, "Muốn đi"', () => {
    expect(
      reasonText({ matchedInterests: ['cafe', 'nature', 'kids'], newPlaceCount: 8, revisit: false, savedCount: 2 }),
    ).toBe('Vì bạn thích Cà phê và Thiên nhiên · 8 nơi bạn chưa đến · 2 nơi trong "Muốn đi"');
  });
  it('lý do khi quay lại vùng đã đi, không có sở thích', () => {
    expect(
      reasonText({ matchedInterests: [], newPlaceCount: 5, revisit: true, savedCount: 0 }),
    ).toBe('Quay lại, lần này với 5 nơi mới');
  });
  it('tiêu đề: tên chủ đề, hoặc 2 danh mục của bản nháp, hoặc "Khám phá"', () => {
    expect(cardTitle('Đà Lạt', 'Trốn phố về rừng', [])).toBe('Đà Lạt · Trốn phố về rừng');
    expect(cardTitle('Đà Lạt', null, ['cafe', 'nature', 'kids'])).toBe('Đà Lạt · Cà phê và thiên nhiên');
    expect(cardTitle('Đà Lạt', null, [])).toBe('Đà Lạt · Khám phá');
  });
  it('nhãn danh mục khớp app mobile', () => {
    expect(CATEGORY_LABELS.culture).toBe('Văn hóa – lịch sử');
  });
});
