import { describe, expect, it } from 'vitest';

import type { GoogleCandidate } from '../google/google-places.service.js';
import { nameSimilarity, pickGoogleMatch } from './web-place-match.js';

const hit = (name: string | null, primaryType: string | null, placeId = name ?? 'x'): GoogleCandidate => ({
  placeId,
  lat: 11.94,
  lng: 108.44,
  name,
  primaryType,
});

describe('nameSimilarity', () => {
  it('bỏ dấu và hoa thường', () => {
    expect(nameSimilarity('Hồ Xuân Hương', 'ho xuan huong')).toBe(1);
  });
  it('tên này chứa trọn tên kia thì coi là khớp', () => {
    expect(nameSimilarity('Quán cơm Linh', 'Quán cơm Linh Đà Lạt')).toBe(1);
  });
  it('hai tên khác hẳn thì thấp', () => {
    expect(nameSimilarity('Thác Datanla', 'Chợ Đà Lạt')).toBeLessThan(0.5);
  });
});

describe('pickGoogleMatch', () => {
  it('lấy kết quả đầu tiên đủ giống tên và đúng loại', () => {
    const picked = pickGoogleMatch('Thác Datanla', 'nature', [
      hit('Chợ Đà Lạt', 'market', 'a'),
      hit('Khu du lịch Thác Datanla', 'tourist_attraction', 'b'),
    ]);
    expect(picked?.placeId).toBe('b');
  });

  it('loại khách sạn khi AI nói là điểm tham quan', () => {
    expect(
      pickGoogleMatch('Hồ Xuân Hương', 'nature', [hit('Khách sạn Hồ Xuân Hương', 'hotel')]),
    ).toBeNull();
  });

  it('chấp nhận loại Google không rõ (suy ra check_in)', () => {
    expect(pickGoogleMatch('Ga Đà Lạt', 'culture', [hit('Ga Đà Lạt', 'train_station')])?.placeId).toBe('Ga Đà Lạt');
  });

  it('Google không trả tên thì không khớp', () => {
    expect(pickGoogleMatch('Ga Đà Lạt', 'culture', [hit(null, 'train_station')])).toBeNull();
  });

  it('nơi lưu trú phải ra loại lưu trú', () => {
    expect(pickGoogleMatch('Dalat Palace', 'stay', [hit('Dalat Palace Heritage Hotel', 'hotel')])).not.toBeNull();
    expect(pickGoogleMatch('Dalat Palace', 'stay', [hit('Dalat Palace', 'restaurant')])).toBeNull();
  });
});
