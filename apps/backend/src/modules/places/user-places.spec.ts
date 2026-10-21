import { describe, expect, it } from 'vitest';

import type { Bbox } from '../regions/bbox.js';
import { insideRegion } from './user-places.js';

const daLat: Bbox = [11.85, 108.35, 12.05, 108.55];

describe('insideRegion', () => {
  it('trong khung', () => {
    expect(insideRegion({ lat: 11.94, lng: 108.44 }, daLat)).toBe(true);
  });

  it('lệch ra ngoài ~1 km vẫn nhận (nới 0.02 độ)', () => {
    expect(insideRegion({ lat: 12.06, lng: 108.44 }, daLat)).toBe(true);
  });

  it('xa hơn thì không', () => {
    expect(insideRegion({ lat: 12.1, lng: 108.44 }, daLat)).toBe(false);
  });
});
