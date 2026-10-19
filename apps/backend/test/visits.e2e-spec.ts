import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { VisitsService } from '../src/modules/visits/visits.service.js';

describe('Nơi đã đi (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let jwt: JwtService;
  let visits: VisitsService;
  let regionId: string;
  const placeIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    db = app.get(DataSource);
    jwt = app.get(JwtService);
    visits = app.get(VisitsService);

    [{ id: regionId }] = (await db.query(
      `SELECT id FROM regions WHERE source_key = 'vn:destination:da-lat'`,
    )) as Array<{ id: string }>;
    for (const [i, category] of ['nature', 'cafe', 'food'].entries()) {
      const [row] = (await db.query(
        `INSERT INTO places (source, name, category, location, location_source)
         VALUES ('web', $1, $2, ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326), 'ai')
         RETURNING id`,
        [`E2E visit ${i}`, category],
      )) as Array<{ id: string }>;
      placeIds.push(row.id);
    }
  });

  afterAll(async () => {
    await db?.query(`DELETE FROM groups WHERE name = 'E2E visit group'`);
    await db?.query(`DELETE FROM users WHERE display_name LIKE 'e2e-visit%'`);
    await db?.query(`DELETE FROM places WHERE name LIKE 'E2E visit %'`);
    await app?.close();
  });

  const newUser = async (name = 'e2e-visit') => {
    const [user] = (await db.query(
      `INSERT INTO users (display_name) VALUES ($1) RETURNING id`,
      [name],
    )) as Array<{ id: string }>;
    return { id: user.id, token: jwt.sign({ sub: user.id }) };
  };

  /** Lịch trình đã kết thúc `daysAgo` ngày trước, chứa mọi placeIds. */
  const endedItinerary = async (
    ownerId: string,
    daysAgo: number,
    groupId: string | null = null,
  ) => {
    const items = placeIds.map((placeId, i) => ({
      id: `item-${i}`,
      kind: i === 2 ? 'meal' : 'visit',
      placeId,
      place: {
        name: `E2E visit ${i}`,
        category: ['nature', 'cafe', 'food'][i],
        coordinates: null,
      },
      dayPart: 'morning',
      order: i,
      startsAt: '2026-01-03T08:00:00+07:00',
      endsAt: '2026-01-03T09:00:00+07:00',
      isAiSuggested: false,
    }));
    const [row] = (await db.query(
      `INSERT INTO itineraries (owner_id, region_id, group_id, planner, starts_at, ends_at, input, days)
       VALUES ($1, $2, $3, 'heuristic', now() - ($4::int + 1) * interval '1 day',
               now() - $4::int * interval '1 day', '{}', $5::jsonb)
       RETURNING id`,
      [ownerId, regionId, groupId, daysAgo, JSON.stringify([{ id: 'day-1', date: '2026-01-03', startsAt: '2026-01-03T08:00:00+07:00', endsAt: '2026-01-03T18:00:00+07:00', items }])],
    )) as Array<{ id: string }>;
    return row.id;
  };

  const statusOf = async (userId: string) =>
    Object.fromEntries(
      (
        (await db.query(
          `SELECT place_id, status FROM visited_places WHERE user_id = $1`,
          [userId],
        )) as Array<{ place_id: string; status: string }>
      ).map((r) => [r.place_id, r.status]),
    );

  it('suy ra nơi đã đi từ lịch trình đã kết thúc, gồm cả quán ăn', async () => {
    const user = await newUser();
    await endedItinerary(user.id, 2);
    await visits.inferVisits(user.id);
    const status = await statusOf(user.id);
    for (const id of placeIds) expect(status[id]).toBe('inferred');
    expect((await visits.visitedPlaceIds(user.id)).sort()).toEqual(
      [...placeIds].sort(),
    );
  });

  it('lịch trình chưa kết thúc thì không suy ra', async () => {
    const user = await newUser();
    await endedItinerary(user.id, -3); // kết thúc sau 3 ngày nữa
    await visits.inferVisits(user.id);
    expect(await statusOf(user.id)).toEqual({});
  });

  it('thành viên nhóm cũng được suy ra và thấy trong pending', async () => {
    const owner = await newUser();
    const member = await newUser('e2e-visit-member');
    const [{ id: groupId }] = (await db.query(
      `INSERT INTO groups (name, owner_id) VALUES ('E2E visit group', $1) RETURNING id`,
      [owner.id],
    )) as Array<{ id: string }>;
    await db.query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'viewer')`,
      [groupId, owner.id, member.id],
    );
    const itineraryId = await endedItinerary(owner.id, 1, groupId);

    await visits.inferVisits(member.id);
    expect(Object.keys(await statusOf(member.id))).toHaveLength(3);

    const res = await request(app.getHttpServer())
      .get('/api/visits/pending')
      .set('Authorization', `Bearer ${member.token}`)
      .expect(200);
    expect(res.body[0].itineraryId).toBe(itineraryId);
    expect(res.body[0].places).toHaveLength(3);
  });

  it('review: chọn → confirmed, còn lại → rejected, lần suy ra sau không thêm lại', async () => {
    const user = await newUser();
    const itineraryId = await endedItinerary(user.id, 2);
    await visits.inferVisits(user.id);

    await request(app.getHttpServer())
      .post('/api/visits/review')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ itineraryId, visitedPlaceIds: [placeIds[0]] })
      .expect(204);

    await visits.inferVisits(user.id);
    const status = await statusOf(user.id);
    expect(status[placeIds[0]]).toBe('confirmed');
    expect(status[placeIds[1]]).toBe('rejected');
    expect(status[placeIds[2]]).toBe('rejected');
    expect(await visits.visitedPlaceIds(user.id)).toEqual([placeIds[0]]);

    const pending = await request(app.getHttpServer())
      .get('/api/visits/pending')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(
      (pending.body as Array<{ itineraryId: string }>).some(
        (p) => p.itineraryId === itineraryId,
      ),
    ).toBe(false);
  });

  it('review rỗng → mọi địa điểm rejected', async () => {
    const user = await newUser();
    const itineraryId = await endedItinerary(user.id, 2);
    await request(app.getHttpServer())
      .post('/api/visits/review')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ itineraryId, visitedPlaceIds: [] })
      .expect(204);
    const status = await statusOf(user.id);
    expect(Object.values(status)).toEqual(['rejected', 'rejected', 'rejected']);
  });

  it('id không thuộc lịch trình → INVALID_PLACES; người ngoài → 404', async () => {
    const user = await newUser();
    const stranger = await newUser('e2e-visit-stranger');
    const itineraryId = await endedItinerary(user.id, 2);

    const invalid = await request(app.getHttpServer())
      .post('/api/visits/review')
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        itineraryId,
        visitedPlaceIds: ['00000000-0000-4000-8000-000000000000'],
      })
      .expect(400);
    expect(invalid.body.code).toBe('INVALID_PLACES');

    const hidden = await request(app.getHttpServer())
      .post('/api/visits/review')
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ itineraryId, visitedPlaceIds: [] })
      .expect(404);
    expect(hidden.body.code).toBe('ITINERARY_NOT_FOUND');
  });

  it('pending bỏ lịch trình kết thúc quá 60 ngày', async () => {
    const user = await newUser();
    const old = await endedItinerary(user.id, 61);
    const res = await request(app.getHttpServer())
      .get('/api/visits/pending')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(
      (res.body as Array<{ itineraryId: string }>).map((p) => p.itineraryId),
    ).not.toContain(old);
  });
});
