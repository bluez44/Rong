import { describe, expect, it } from 'vitest';

import { DESTINATIONS, NEW_PROVINCES, OLD_PROVINCES } from './vietnam-admin.js';

describe('dữ liệu sáp nhập tỉnh 1/7/2025', () => {
  const oldKeys = new Set(OLD_PROVINCES.map((p) => p.key));
  const newKeys = new Set(NEW_PROVINCES.map((p) => p.key));

  it('có 34 tỉnh/thành mới, 11 không đổi và 52 tỉnh cũ bị sáp nhập (tổng 63 tỉnh cũ)', () => {
    expect(NEW_PROVINCES).toHaveLength(34);
    expect(newKeys.size).toBe(34);
    expect(NEW_PROVINCES.filter((p) => p.mergedFrom.length === 0)).toHaveLength(
      11,
    );
    expect(OLD_PROVINCES).toHaveLength(52);
    expect(OLD_PROVINCES.length + 11).toBe(63);
  });

  it('mỗi tỉnh cũ thuộc đúng một tỉnh mới', () => {
    const owners = new Map<string, string[]>();
    for (const province of NEW_PROVINCES) {
      for (const key of province.mergedFrom) {
        owners.set(key, [...(owners.get(key) ?? []), province.key]);
      }
    }
    for (const key of oldKeys) {
      expect(owners.get(key), key).toHaveLength(1);
    }
    expect([...owners.keys()].every((key) => oldKeys.has(key))).toBe(true);
  });

  it('điểm đến trỏ tới tỉnh có thật và tỉnh cũ nằm trong tỉnh mới', () => {
    for (const destination of DESTINATIONS) {
      const province = NEW_PROVINCES.find(
        (p) => p.key === destination.province,
      );
      expect(province, destination.key).toBeDefined();
      if (destination.formerProvince !== null) {
        expect(province!.mergedFrom).toContain(destination.formerProvince);
      } else {
        expect(province!.mergedFrom).toHaveLength(0);
      }
    }
  });
});
