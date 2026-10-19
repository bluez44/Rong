import { describe, expect, it } from 'vitest';

import { DEFAULT_TRIP_PARAMS } from './trip-params.js';
import { minNewPlaces, pickRegions, scoreRegion, type RegionStats } from './scoring.js';

const stats = (over: Partial<RegionStats>): RegionStats => ({
  regionId: over.regionName ?? 'r',
  regionName: 'r',
  newPlaces: 20,
  savedNew: 0,
  visitedAny: false,
  recentlyShown: false,
  listVersion: new Date(0),
  ...over,
});

describe('scoreRegion', () => {
  it('điểm gốc = số nơi mới + 3 × "Muốn đi" chưa đi', () => {
    expect(scoreRegion(stats({ newPlaces: 12, savedNew: 2 }), 10)).toBe(18);
  });
  it('vùng đã đi × 0,3', () => {
    expect(scoreRegion(stats({ newPlaces: 20, visitedAny: true }), 10)).toBeCloseTo(6);
  });
  it('vùng mới gợi ý gần đây × 0,5', () => {
    expect(scoreRegion(stats({ newPlaces: 20, recentlyShown: true }), 10)).toBe(10);
  });
  it('cả hai hệ số nhân dồn', () => {
    expect(
      scoreRegion(stats({ newPlaces: 20, visitedAny: true, recentlyShown: true }), 10),
    ).toBeCloseTo(3);
  });
  it('thiếu nơi mới → loại', () => {
    expect(scoreRegion(stats({ newPlaces: 9, savedNew: 10 }), 10)).toBeNull();
  });
});

describe('pickRegions', () => {
  it('3 vùng điểm cao nhất, khác nhau, hòa điểm theo tên', () => {
    const picked = pickRegions(
      [
        stats({ regionName: 'A', newPlaces: 10 }),
        stats({ regionName: 'B', newPlaces: 30 }),
        stats({ regionName: 'C', newPlaces: 20 }),
        stats({ regionName: 'D', newPlaces: 20 }),
        stats({ regionName: 'E', newPlaces: 5 }),
      ],
      10,
    );
    expect(picked.map((p) => p.regionName)).toEqual(['B', 'C', 'D']);
    expect(new Set(picked.map((p) => p.regionId)).size).toBe(3);
  });
  it('không đủ vùng thì trả ít hơn', () => {
    expect(pickRegions([stats({ newPlaces: 3 })], 10)).toEqual([]);
  });
  it('vùng đã đi nhiều nơi mới vẫn có thể đứng sau vùng chưa đi ít nơi hơn', () => {
    const picked = pickRegions(
      [
        stats({ regionName: 'cu', newPlaces: 40, visitedAny: true }), // 12
        stats({ regionName: 'moi', newPlaces: 15 }), // 15
      ],
      10,
    );
    expect(picked.map((p) => p.regionName)).toEqual(['moi', 'cu']);
  });
});

describe('minNewPlaces', () => {
  it('cặp đôi, nhịp vừa, 2 ngày', () => {
    // couple stopsPerDay [4, 5], moderate → round(4.5) = 5 mỗi ngày.
    expect(minNewPlaces(DEFAULT_TRIP_PARAMS)).toBe(10);
  });
});
