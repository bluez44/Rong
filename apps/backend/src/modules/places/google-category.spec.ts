import { describe, expect, it } from 'vitest';

import { categoryFromGoogleType } from './google-category.js';

describe('categoryFromGoogleType', () => {
  it.each([
    ['cafe', 'cafe'],
    ['coffee_shop', 'cafe'],
    ['vietnamese_restaurant', 'food'],
    ['restaurant', 'food'],
    ['bakery', 'food'],
    ['night_club', 'nightlife'],
    ['bar', 'nightlife'],
    ['hotel', 'stay'],
    ['lodging', 'stay'],
    ['bed_and_breakfast', 'stay'],
    ['campground', 'stay'],
    ['amusement_park', 'kids'],
    ['zoo', 'kids'],
    ['theme_park', 'kids'],
    ['buddhist_temple', 'culture'],
    ['museum', 'culture'],
    ['national_park', 'nature'],
    ['beach', 'nature'],
    ['tourist_attraction', 'check_in'],
    ['', 'check_in'],
  ])('%s → %s', (type, category) => {
    expect(categoryFromGoogleType(type)).toBe(category);
  });

  it('null/undefined → check_in', () => {
    expect(categoryFromGoogleType(null)).toBe('check_in');
    expect(categoryFromGoogleType(undefined)).toBe('check_in');
  });

  it('cafe trước food: "cafe_restaurant" → cafe', () => {
    expect(categoryFromGoogleType('cafe_restaurant')).toBe('cafe');
  });

  it('khớp theo từ, không khớp chuỗi con: "dinner_theater" không phải stay', () => {
    expect(categoryFromGoogleType('dinner_theater')).not.toBe('stay');
  });

  it('khớp theo từ, không khớp chuỗi con: "public_bath" không phải nightlife', () => {
    expect(categoryFromGoogleType('public_bath')).not.toBe('nightlife');
  });

  it('guest_house → stay', () => {
    expect(categoryFromGoogleType('guest_house')).toBe('stay');
  });

  it('tea_house → cafe', () => {
    expect(categoryFromGoogleType('tea_house')).toBe('cafe');
  });
});
