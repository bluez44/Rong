import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { LangchainService } from '../src/langchain/langchain.service.js';

/**
 * Nhóm & chia sẻ (S8), chạy trên database thật như itinerary.e2e-spec. Người
 * dùng: a (owner), b (được mời), c (không liên quan). Lịch trình tạo ở chế độ
 * tự sắp xếp nên không gọi AI.
 */
describe('Nhóm & chia sẻ (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  const tokens: Record<'a' | 'b' | 'c', string> = { a: '', b: '', c: '' };
  const userIds: Record<'a' | 'b' | 'c', string> = { a: '', b: '', c: '' };
  let regionId: string;
  const placeIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LangchainService)
      .useValue({ planItinerary: vi.fn(), findPlaces: vi.fn() })
      .compile();
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
    const jwt = app.get(JwtService);
    const users = (await db.query(
      `INSERT INTO users (display_name)
       VALUES ('e2e-groups-a'), ('e2e-groups-b'), ('e2e-groups-c')
       RETURNING id, display_name`,
    )) as Array<{ id: string; display_name: string }>;
    for (const u of users) {
      const key = u.display_name.slice(-1) as 'a' | 'b' | 'c';
      userIds[key] = u.id;
      tokens[key] = jwt.sign({ sub: u.id });
    }

    [{ id: regionId }] = (await db.query(
      `SELECT id FROM regions WHERE source_key = 'vn:destination:da-lat'`,
    )) as Array<{ id: string }>;

    for (const [i, name] of ['Hồ Tuyền Lâm', 'Đồi chè Cầu Đất'].entries()) {
      const [row] = (await db.query(
        `INSERT INTO places (osm_type, osm_id, name, category, location, composite_score)
         VALUES ('node', $1, $2, 'nature', ST_SetSRID(ST_MakePoint(108.43, 11.9), 4326), 50)
         ON CONFLICT (osm_type, osm_id) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [-9200 - i, `E2E ${name}`],
      )) as Array<{ id: string }>;
      placeIds.push(row.id);
    }
  });

  afterAll(async () => {
    await db?.query(`DELETE FROM users WHERE display_name LIKE 'e2e-groups-%'`);
    await db?.query(
      `DELETE FROM places WHERE osm_id <= -9200 AND osm_id > -9300`,
    );
    await app?.close();
  });

  /** Gọi API với tư cách một người dùng; `null` là không đăng nhập. */
  const call = (as: 'a' | 'b' | 'c' | null) => {
    const server = app.getHttpServer();
    const auth = (req: request.Test) =>
      as === null ? req : req.set('Authorization', `Bearer ${tokens[as]}`);
    return {
      get: (path: string) => auth(request(server).get(`/api${path}`)),
      post: (path: string, body: object = {}) =>
        auth(request(server).post(`/api${path}`)).send(body),
      put: (path: string, body: object = {}) =>
        auth(request(server).put(`/api${path}`)).send(body),
      patch: (path: string, body: object = {}) =>
        auth(request(server).patch(`/api${path}`)).send(body),
      delete: (path: string) => auth(request(server).delete(`/api${path}`)),
    };
  };

  /** Lịch trình tự sắp xếp 2 ngày ở Đà Lạt. */
  const manualTrip = (extra: object = {}) => ({
    regionId,
    planningMode: 'manual',
    startsAt: '2026-10-05T08:00:00+07:00',
    endsAt: '2026-10-06T18:00:00+07:00',
    travelParty: 'friends',
    adults: 2,
    children: 0,
    selectedPlaceIds: [placeIds[0]],
    ...extra,
  });

  describe('nhóm', () => {
    let groupId: string;

    it('tạo nhóm: người tạo là owner, có trong danh sách của mình', async () => {
      const res = await call('a')
        .post('/groups', { name: '  Đà Lạt cuối tuần ' })
        .expect(201);
      groupId = res.body.id;
      expect(res.body).toMatchObject({
        name: 'Đà Lạt cuối tuần',
        ownerId: userIds.a,
        myRole: 'owner',
        itineraries: [],
      });
      expect(res.body.members).toEqual([
        expect.objectContaining({
          userId: userIds.a,
          role: 'owner',
          displayName: 'e2e-groups-a',
        }),
      ]);
      expect(res.body.members[0]).not.toHaveProperty('email');

      const list = await call('a').get('/groups').expect(200);
      expect(list.body).toContainEqual(
        expect.objectContaining({
          id: groupId,
          myRole: 'owner',
          memberCount: 1,
          itineraryCount: 0,
        }),
      );
    });

    it('tên rỗng hoặc quá dài bị từ chối', async () => {
      await call('a').post('/groups', { name: '   ' }).expect(400);
      await call('a')
        .post('/groups', { name: 'x'.repeat(61) })
        .expect(400);
    });

    it('người ngoài nhóm nhận 404, không phải 403', async () => {
      const res = await call('c').get(`/groups/${groupId}`).expect(404);
      expect(res.body.code).toBe('GROUP_NOT_FOUND');
      await call('c').patch(`/groups/${groupId}`, { name: 'x' }).expect(404);
      await call('c').get(`/groups/${groupId}/activity`).expect(404);
    });

    it('đổi tên ghi nhật ký group_renamed', async () => {
      await call('a')
        .patch(`/groups/${groupId}`, { name: 'Đà Lạt tháng 10' })
        .expect(200);
      const res = await call('a')
        .get(`/groups/${groupId}/activity`)
        .expect(200);
      expect(res.body.items[0]).toMatchObject({
        type: 'group_renamed',
        actorId: userIds.a,
        actorName: 'e2e-groups-a',
        payload: { from: 'Đà Lạt cuối tuần', to: 'Đà Lạt tháng 10' },
      });
      expect(res.body.nextCursor).toBeNull();
    });

    it('xóa nhóm', async () => {
      await call('a').delete(`/groups/${groupId}`).expect(204);
      await call('a').get(`/groups/${groupId}`).expect(404);
    });

    it('cần đăng nhập', async () => {
      await call(null).get('/groups').expect(401);
    });
  });
});
