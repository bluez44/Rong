import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ItineraryInput } from '@rong/shared-types';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { LangchainService } from '../src/langchain/langchain.service.js';
import { ItineraryPlanner } from '../src/modules/itineraries/itinerary-planner.js';

/** planTrip(): lập lịch không lưu, dùng cho bản nháp gợi ý (spec 2026-10-19-home-recommendations). */
describe('ItineraryPlanner.planTrip (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let planner: ItineraryPlanner;
  let regionId: string;
  const planItinerary = vi.fn();
  const ids: Record<string, string> = {};

  const places: Array<[string, string, number, number]> = [
    ['ho', 'nature', 11.9404, 108.4383],
    ['ga', 'culture', 11.9422, 108.4556],
    ['thung_lung', 'nature', 11.9775, 108.4474],
    ['datanla', 'nature', 11.9007, 108.4494],
    ['dinh3', 'culture', 11.9311, 108.4297],
    ['vuon', 'kids', 11.9496, 108.4533],
    ['view', 'check_in', 11.925, 108.46],
    ['cafe', 'cafe', 11.943, 108.441],
    ['com1', 'food', 11.941, 108.439],
    ['com2', 'food', 11.945, 108.45],
    ['com3', 'food', 11.935, 108.444],
  ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LangchainService)
      .useValue({ planItinerary })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DataSource);
    planner = app.get(ItineraryPlanner);

    [{ id: regionId }] = (await db.query(
      `SELECT id FROM regions WHERE source_key = 'vn:destination:da-lat'`,
    )) as Array<{ id: string }>;
    await db.query(
      `INSERT INTO region_place_lists (region_id, status, fetched_at, expires_at)
       VALUES ($1, 'ready', now(), now() + interval '30 days')
       ON CONFLICT (region_id) DO NOTHING`,
      [regionId],
    );
    for (const [rank, [key, category, lat, lng]] of places.entries()) {
      const [row] = (await db.query(
        `INSERT INTO places (source, name, category, location, location_source)
         VALUES ('web', $1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), 'ai')
         RETURNING id`,
        [`E2E planner ${key}`, category, lng, lat],
      )) as Array<{ id: string }>;
      ids[key] = row.id;
      // Đứng đầu danh sách vùng để chắc chắn được chọn trước dữ liệu khác.
      await db.query(
        `INSERT INTO region_places (region_id, place_id, rank) VALUES ($1, $2, $3)`,
        [regionId, row.id, -100 + rank],
      );
    }
  });

  afterAll(async () => {
    await db?.query(
      `DELETE FROM region_places rp USING places p
        WHERE rp.place_id = p.id AND p.name LIKE 'E2E planner %'`,
    );
    await db?.query(`DELETE FROM places WHERE name LIKE 'E2E planner %'`);
    await app?.close();
  });

  const input = (): ItineraryInput => ({
    regionId,
    planningMode: 'ai',
    startsAt: '2026-01-03T08:00:00+07:00',
    endsAt: '2026-01-04T18:00:00+07:00',
    travelParty: 'couple',
    adults: 2,
    children: 0,
    selectedPlaceIds: [],
    accommodationPlaceId: null,
    allowAiSuggestions: true,
    budgetTier: 'moderate',
    pace: 'moderate',
    transport: null,
    preferredCategories: [],
    notes: null,
  });

  const placeIdsOf = (days: Awaited<ReturnType<ItineraryPlanner['planTrip']>>['days']) =>
    days.flatMap((d) => d.items.flatMap((i) => (i.placeId ? [i.placeId] : [])));

  it('forceHeuristic không gọi Gemini và trả planner heuristic', async () => {
    planItinerary.mockClear();
    const result = await planner.planTrip(input(), { forceHeuristic: true });
    expect(planItinerary).not.toHaveBeenCalled();
    expect(result.planner).toBe('heuristic');
    expect(result.days).toHaveLength(2);
    expect(placeIdsOf(result.days).length).toBeGreaterThan(0);
  });

  it('excludePlaceIds không bao giờ xuất hiện trong kết quả', async () => {
    const excluded = [ids.ho, ids.ga, ids.thung_lung];
    const result = await planner.planTrip(input(), {
      forceHeuristic: true,
      excludePlaceIds: excluded,
    });
    const used = placeIdsOf(result.days);
    for (const id of excluded) expect(used).not.toContain(id);
  });

  it('excludePlaceIds loại cả quán ăn', async () => {
    const excluded = [ids.com1, ids.com2];
    const result = await planner.planTrip(input(), {
      forceHeuristic: true,
      excludePlaceIds: excluded,
    });
    const used = placeIdsOf(result.days);
    expect(used).not.toContain(ids.com1);
    expect(used).not.toContain(ids.com2);
  });

  it('không lưu gì vào itineraries', async () => {
    const [{ count: before }] = (await db.query(
      `SELECT count(*)::int AS count FROM itineraries`,
    )) as Array<{ count: number }>;
    await planner.planTrip(input(), { forceHeuristic: true });
    const [{ count: after }] = (await db.query(
      `SELECT count(*)::int AS count FROM itineraries`,
    )) as Array<{ count: number }>;
    expect(after).toBe(before);
  });

  it('Gemini lỗi thì vẫn ra lịch heuristic', async () => {
    planItinerary.mockRejectedValueOnce(new Error('hết quota'));
    const result = await planner.planTrip(input());
    expect(planItinerary).toHaveBeenCalled();
    expect(result.planner).toBe('heuristic');
  });
});
