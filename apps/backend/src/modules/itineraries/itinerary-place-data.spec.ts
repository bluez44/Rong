import type { ItineraryDay, ItineraryItem } from '@rong/shared-types';
import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { withItineraryPlaceData } from './itinerary-place-data.js';

type Row = {
  id: string;
  source: 'osm' | 'google' | 'web';
  location_source: 'osm' | 'google' | 'ai';
  address: string | null;
  lat: number | null;
  lng: number | null;
};

const db = (rows: Row[]) => {
  const query = vi.fn().mockResolvedValue(rows);
  return { db: { query } as unknown as DataSource, query };
};

const item = (
  placeId: string,
  place: Partial<NonNullable<ItineraryItem['place']>> = {},
): ItineraryItem => ({
  id: `item-${placeId}`,
  kind: 'visit',
  placeId,
  place: {
    name: `Điểm ${placeId}`,
    category: 'nature',
    coordinates: { lat: 11.9, lng: 108.4 },
    locationSource: 'ai',
    ...place,
  },
  dayPart: 'morning',
  order: 0,
  startsAt: '2026-10-05T08:00:00+07:00',
  endsAt: '2026-10-05T09:00:00+07:00',
  isAiSuggested: false,
});

const days = (...items: ItineraryItem[]): ItineraryDay[] => [
  {
    id: 'day-1',
    date: '2026-10-05',
    startsAt: '2026-10-05T08:00:00+07:00',
    endsAt: '2026-10-05T21:00:00+07:00',
    items,
  },
];

const placeOf = (result: ItineraryDay[], index = 0) =>
  result[0].items[index].place!;

describe('withItineraryPlaceData', () => {
  it('dòng web: địa chỉ lấy từ places, ghi đè ảnh chụp', async () => {
    const { db: d } = db([
      {
        id: 'a',
        source: 'web',
        location_source: 'ai',
        address: '2 Trần Quốc Toản',
        lat: null,
        lng: null,
      },
    ]);
    const result = await withItineraryPlaceData(
      d,
      days(item('a', { address: 'cũ' })),
    );
    expect(placeOf(result).address).toBe('2 Trần Quốc Toản');
  });

  it('lịch trình cũ chưa có address trong ảnh chụp vẫn được điền', async () => {
    const { db: d } = db([
      {
        id: 'a',
        source: 'web',
        location_source: 'ai',
        address: '5 Lê Lợi',
        lat: null,
        lng: null,
      },
    ]);
    const result = await withItineraryPlaceData(d, days(item('a')));
    expect(placeOf(result).address).toBe('5 Lê Lợi');
  });

  it('places chưa có địa chỉ: giữ địa chỉ trong ảnh chụp, không có thì null', async () => {
    const { db: d } = db([
      {
        id: 'a',
        source: 'web',
        location_source: 'ai',
        address: null,
        lat: null,
        lng: null,
      },
      {
        id: 'b',
        source: 'web',
        location_source: 'ai',
        address: null,
        lat: null,
        lng: null,
      },
    ]);
    const result = await withItineraryPlaceData(
      d,
      days(item('a', { address: 'Trong ảnh chụp' }), item('b')),
    );
    expect(placeOf(result, 0).address).toBe('Trong ảnh chụp');
    expect(placeOf(result, 1).address).toBeNull();
  });

  it('dòng nguồn Google: luôn null, kể cả khi ảnh chụp có địa chỉ (PRD 7.4)', async () => {
    const { db: d } = db([
      {
        id: 'g',
        source: 'google',
        location_source: 'google',
        address: 'không được dùng',
        lat: 11.95,
        lng: 108.45,
      },
    ]);
    const result = await withItineraryPlaceData(
      d,
      days(item('g', { address: 'cũ', coordinates: null })),
    );
    expect(placeOf(result).address).toBeNull();
  });

  it('tọa độ Google còn hạn được điền, hết hạn thì null', async () => {
    const { db: d } = db([
      {
        id: 'a',
        source: 'web',
        location_source: 'google',
        address: null,
        lat: 11.95,
        lng: 108.45,
      },
      {
        id: 'b',
        source: 'web',
        location_source: 'google',
        address: null,
        lat: null,
        lng: null,
      },
    ]);
    const result = await withItineraryPlaceData(
      d,
      days(item('a', { coordinates: null }), item('b')),
    );
    expect(placeOf(result, 0).coordinates).toEqual({ lat: 11.95, lng: 108.45 });
    expect(placeOf(result, 1).coordinates).toBeNull();
  });

  it('dòng tọa độ AI / OSM giữ tọa độ trong ảnh chụp', async () => {
    const { db: d } = db([
      {
        id: 'a',
        source: 'web',
        location_source: 'ai',
        address: null,
        lat: null,
        lng: null,
      },
      {
        id: 'o',
        source: 'osm',
        location_source: 'osm',
        address: null,
        lat: null,
        lng: null,
      },
    ]);
    const result = await withItineraryPlaceData(d, days(item('a'), item('o')));
    expect(placeOf(result, 0).coordinates).toEqual({ lat: 11.9, lng: 108.4 });
    expect(placeOf(result, 1).coordinates).toEqual({ lat: 11.9, lng: 108.4 });
  });

  it('mục không có địa điểm: không truy vấn, trả nguyên', async () => {
    const { db: d, query } = db([]);
    const input = days({
      ...item('a'),
      placeId: null,
      place: null,
    } as unknown as ItineraryItem);
    expect(await withItineraryPlaceData(d, input)).toBe(input);
    expect(query).not.toHaveBeenCalled();
  });

  it('mỗi địa điểm chỉ truy vấn một lần dù xuất hiện nhiều lần', async () => {
    const { db: d, query } = db([]);
    await withItineraryPlaceData(d, days(item('a'), item('a'), item('b')));
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([['a', 'b']]);
  });
});
