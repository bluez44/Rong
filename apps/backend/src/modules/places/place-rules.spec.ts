import { describe, expect, it } from 'vitest';

import { classifyPlace, toPlaceDraft } from './osm-place-mapping.js';
import { scorePlace } from './place-scoring.js';

describe('classifyPlace', () => {
  it.each([
    [{ tourism: 'hotel' }, 'stay'],
    [{ tourism: 'theme_park' }, 'kids'],
    [{ leisure: 'water_park' }, 'kids'],
    [{ tourism: 'museum' }, 'culture'],
    [{ historic: 'monument' }, 'culture'],
    [{ amenity: 'place_of_worship', tourism: 'attraction' }, 'culture'],
    [{ leisure: 'park', tourism: 'attraction' }, 'nature'],
    [{ natural: 'waterfall' }, 'nature'],
    [{ tourism: 'viewpoint' }, 'check_in'],
    [{ amenity: 'bar' }, 'nightlife'],
    [{ amenity: 'cafe' }, 'cafe'],
    [{ amenity: 'restaurant' }, 'food'],
  ] as const)('%o → %s', (tags, expected) => {
    expect(classifyPlace(tags)).toBe(expected);
  });

  it('bỏ nơi thờ tự thông thường không có dấu hiệu du lịch', () => {
    expect(classifyPlace({ amenity: 'place_of_worship' })).toBeNull();
    expect(classifyPlace({ shop: 'supermarket' })).toBeNull();
  });
});

describe('toPlaceDraft', () => {
  it('ưu tiên tên tiếng Việt, lấy tâm của way, chỉ giữ tag cần thiết', () => {
    const draft = toPlaceDraft({
      type: 'way',
      id: 42,
      center: { lat: 11.94, lon: 108.44 },
      tags: {
        name: 'Xuan Huong Lake',
        'name:vi': 'Hồ Xuân Hương',
        leisure: 'park',
        wikidata: 'Q1234',
        opening_hours: '24/7',
        source: 'survey',
      },
    });

    expect(draft).toEqual({
      osmType: 'way',
      osmId: 42,
      name: 'Hồ Xuân Hương',
      category: 'nature',
      lat: 11.94,
      lng: 108.44,
      tags: { opening_hours: '24/7', leisure: 'park' },
      wikidataId: 'Q1234',
    });
  });

  it('bỏ phần tử không tên hoặc không có tọa độ', () => {
    expect(
      toPlaceDraft({
        type: 'node',
        id: 1,
        lat: 1,
        lon: 1,
        tags: { amenity: 'cafe' },
      }),
    ).toBeNull();
    expect(
      toPlaceDraft({
        type: 'way',
        id: 2,
        tags: { name: 'X', amenity: 'cafe' },
      }),
    ).toBeNull();
  });
});

describe('scorePlace', () => {
  it('danh thắng nổi tiếng trên Wikipedia xếp trên quán cà phê bình thường', () => {
    const landmark = scorePlace({
      category: 'nature',
      tags: { tourism: 'attraction', wikipedia: 'vi:Hồ Xuân Hương' },
      wikidataId: 'Q1',
      sitelinks: 12,
    });
    const cafe = scorePlace({
      category: 'cafe',
      tags: { opening_hours: '07:00-22:00' },
      wikidataId: null,
      sitelinks: null,
    });

    expect(landmark).toBe(30 + 10 + 8 + 4 + 26);
    expect(cafe).toBe(17);
    expect(landmark).toBeGreaterThan(cafe);
  });

  it('không vượt quá 100', () => {
    expect(
      scorePlace({
        category: 'check_in',
        tags: {
          tourism: 'attraction',
          wikipedia: 'x',
          opening_hours: 'x',
          website: 'x',
          phone: 'x',
          image: 'x',
          'name:en': 'x',
        },
        wikidataId: 'Q1',
        sitelinks: 5000,
      }),
    ).toBe(100);
  });
});
