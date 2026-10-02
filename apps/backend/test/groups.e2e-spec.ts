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

  describe('link mời và thành viên', () => {
    let groupId: string;
    let viewerInvite: { id: string; token: string };

    beforeAll(async () => {
      const res = await call('a')
        .post('/groups', { name: 'Nhóm mời' })
        .expect(201);
      groupId = res.body.id;
    });

    it('owner tạo link viewer (mặc định); token chỉ trả một lần', async () => {
      const res = await call('a')
        .post(`/groups/${groupId}/invites`)
        .expect(201);
      viewerInvite = res.body;
      expect(res.body.role).toBe('viewer');
      expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const list = await call('a')
        .get(`/groups/${groupId}/invites`)
        .expect(200);
      expect(list.body).toEqual([
        expect.objectContaining({ id: viewerInvite.id, role: 'viewer' }),
      ]);
      expect(list.body[0]).not.toHaveProperty('token');
    });

    it('xem trước không cần đăng nhập', async () => {
      const res = await call(null)
        .get(`/invites/${viewerInvite.token}`)
        .expect(200);
      expect(res.body).toMatchObject({
        groupName: 'Nhóm mời',
        inviterName: 'e2e-groups-a',
        role: 'viewer',
        memberCount: 1,
      });
    });

    it('token rác trả 404, không lỗi 500', async () => {
      for (const bad of ['abc', 'a'.repeat(43) + 'b', '%00', 'x'.repeat(200)]) {
        const res = await call(null).get(`/invites/${encodeURIComponent(bad)}`);
        expect(res.status).toBe(404);
      }
      const unknown = 'A'.repeat(43);
      expect(
        (await call('b').post(`/invites/${unknown}/accept`)).body.code,
      ).toBe('INVITE_NOT_FOUND');
    });

    it('b chấp nhận thành viewer; chấp nhận lại không tạo trùng hay ghi thêm nhật ký', async () => {
      const res = await call('b')
        .post(`/invites/${viewerInvite.token}/accept`)
        .expect(201);
      expect(res.body.myRole).toBe('viewer');
      await call('b').post(`/invites/${viewerInvite.token}/accept`).expect(201);
      const detail = await call('a').get(`/groups/${groupId}`).expect(200);
      expect(
        detail.body.members.filter(
          (x: { userId: string }) => x.userId === userIds.b,
        ),
      ).toHaveLength(1);
      const log = await call('a')
        .get(`/groups/${groupId}/activity`)
        .expect(200);
      expect(
        log.body.items.filter(
          (x: { type: string }) => x.type === 'member_joined',
        ),
      ).toHaveLength(1);
    });

    it('viewer không tạo được link mời', async () => {
      const res = await call('b')
        .post(`/groups/${groupId}/invites`)
        .expect(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
    });

    it('link editor nâng b lên editor; link viewer sau đó không hạ quyền', async () => {
      const editor = await call('a')
        .post(`/groups/${groupId}/invites`, { role: 'editor' })
        .expect(201);
      const up = await call('b')
        .post(`/invites/${editor.body.token}/accept`)
        .expect(201);
      expect(up.body.myRole).toBe('editor');
      const again = await call('b')
        .post(`/invites/${viewerInvite.token}/accept`)
        .expect(201);
      expect(again.body.myRole).toBe('editor');
    });

    it('link đã thu hồi trả 410', async () => {
      await call('a')
        .delete(`/groups/${groupId}/invites/${viewerInvite.id}`)
        .expect(204);
      const res = await call('c')
        .post(`/invites/${viewerInvite.token}/accept`)
        .expect(410);
      expect(res.body.code).toBe('INVITE_EXPIRED');
      await call(null).get(`/invites/${viewerInvite.token}`).expect(410);
    });

    it('link hết hạn trả 410', async () => {
      const res = await call('a')
        .post(`/groups/${groupId}/invites`)
        .expect(201);
      await db.query(
        `UPDATE group_invites SET expires_at = now() - interval '1 minute' WHERE id = $1`,
        [res.body.id],
      );
      await call('c').post(`/invites/${res.body.token}/accept`).expect(410);
    });

    it('owner đổi vai trò; không đổi được vai trò owner', async () => {
      const res = await call('a')
        .patch(`/groups/${groupId}/members/${userIds.b}`, { role: 'viewer' })
        .expect(200);
      expect(res.body.members).toContainEqual(
        expect.objectContaining({ userId: userIds.b, role: 'viewer' }),
      );
      const own = await call('a')
        .patch(`/groups/${groupId}/members/${userIds.a}`, { role: 'editor' })
        .expect(400);
      expect(own.body.code).toBe('CANNOT_CHANGE_OWNER');
      await call('b')
        .patch(`/groups/${groupId}/members/${userIds.a}`, { role: 'viewer' })
        .expect(403);
    });

    it('owner không tự rời được; thành viên tự rời rồi mất quyền ngay', async () => {
      const own = await call('a')
        .delete(`/groups/${groupId}/members/${userIds.a}`)
        .expect(400);
      expect(own.body.code).toBe('OWNER_CANNOT_LEAVE');
      await call('b')
        .delete(`/groups/${groupId}/members/${userIds.b}`)
        .expect(204);
      await call('b').get(`/groups/${groupId}`).expect(404);
      const log = await call('a')
        .get(`/groups/${groupId}/activity`)
        .expect(200);
      expect(log.body.items[0]).toMatchObject({
        type: 'member_left',
        payload: { userName: 'e2e-groups-b' },
      });
    });

    it('owner xóa thành viên; người không phải owner không xóa được người khác', async () => {
      const inv = await call('a')
        .post(`/groups/${groupId}/invites`)
        .expect(201);
      await call('b').post(`/invites/${inv.body.token}/accept`).expect(201);
      await call('c').post(`/invites/${inv.body.token}/accept`).expect(201);
      await call('c')
        .delete(`/groups/${groupId}/members/${userIds.b}`)
        .expect(403);
      await call('a')
        .delete(`/groups/${groupId}/members/${userIds.c}`)
        .expect(204);
      await call('c').get(`/groups/${groupId}`).expect(404);
    });

    it('nhóm đầy trả 409 GROUP_FULL', async () => {
      const inv = await call('a')
        .post(`/groups/${groupId}/invites`)
        .expect(201);
      const filler = (await db.query(
        `INSERT INTO users (display_name)
         SELECT 'e2e-groups-fill-' || g FROM generate_series(1, 47) g RETURNING id`,
      )) as Array<{ id: string }>;
      for (const f of filler) {
        await db.query(
          `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'viewer')`,
          [groupId, f.id],
        );
      }
      // a + b + 47 = 49; c vào là 50, người tiếp theo bị chặn.
      await call('c').post(`/invites/${inv.body.token}/accept`).expect(201);
      const [extra] = (await db.query(
        `INSERT INTO users (display_name) VALUES ('e2e-groups-fill-x') RETURNING id`,
      )) as Array<{ id: string }>;
      const token = app.get(JwtService).sign({ sub: extra.id });
      const res = await request(app.getHttpServer())
        .post(`/api/invites/${inv.body.token}/accept`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
      expect(res.body.code).toBe('GROUP_FULL');
    });
  });

  describe('địa điểm chung', () => {
    let groupId: string;

    beforeAll(async () => {
      groupId = (
        await call('a').post('/groups', { name: 'Nhóm địa điểm' }).expect(201)
      ).body.id;
      const viewer = await call('a')
        .post(`/groups/${groupId}/invites`)
        .expect(201);
      await call('c').post(`/invites/${viewer.body.token}/accept`).expect(201);
      const editor = await call('a')
        .post(`/groups/${groupId}/invites`, { role: 'editor' })
        .expect(201);
      await call('b').post(`/invites/${editor.body.token}/accept`).expect(201);
    });

    it('editor thêm, mọi thành viên thấy, thêm lại không đổi', async () => {
      await call('b')
        .put(`/groups/${groupId}/places/${placeIds[0]}`, { regionId })
        .expect(204);
      await call('b')
        .put(`/groups/${groupId}/places/${placeIds[0]}`, { regionId })
        .expect(204);
      const res = await call('c').get(`/groups/${groupId}/places`).expect(200);
      expect(res.body).toEqual([
        expect.objectContaining({
          placeId: placeIds[0],
          name: 'E2E Hồ Tuyền Lâm',
          category: 'nature',
          regionId,
          addedByName: 'e2e-groups-b',
        }),
      ]);
      const log = await call('a')
        .get(`/groups/${groupId}/activity`)
        .expect(200);
      expect(
        log.body.items.filter(
          (x: { type: string }) => x.type === 'place_added',
        ),
      ).toHaveLength(1);
    });

    it('viewer không thêm, không xóa được', async () => {
      await call('c')
        .put(`/groups/${groupId}/places/${placeIds[1]}`, { regionId })
        .expect(403);
      await call('c')
        .delete(`/groups/${groupId}/places/${placeIds[0]}`)
        .expect(403);
    });

    it('địa điểm hoặc vùng không tồn tại', async () => {
      const missing = '00000000-0000-0000-0000-000000000000';
      expect(
        (
          await call('b')
            .put(`/groups/${groupId}/places/${missing}`, { regionId })
            .expect(404)
        ).body.code,
      ).toBe('PLACE_NOT_FOUND');
      expect(
        (
          await call('b')
            .put(`/groups/${groupId}/places/${placeIds[1]}`, {
              regionId: missing,
            })
            .expect(400)
        ).body.code,
      ).toBe('UNKNOWN_REGION');
    });

    it('xóa ghi nhật ký place_removed; xóa lần nữa vẫn 204', async () => {
      await call('b')
        .delete(`/groups/${groupId}/places/${placeIds[0]}`)
        .expect(204);
      await call('b')
        .delete(`/groups/${groupId}/places/${placeIds[0]}`)
        .expect(204);
      expect(
        (await call('a').get(`/groups/${groupId}/places`).expect(200)).body,
      ).toEqual([]);
      const log = await call('a')
        .get(`/groups/${groupId}/activity`)
        .expect(200);
      expect(log.body.items[0]).toMatchObject({
        type: 'place_removed',
        payload: { placeId: placeIds[0], placeName: 'E2E Hồ Tuyền Lâm' },
      });
    });
  });

  describe('lịch trình trong nhóm', () => {
    let groupId: string;
    let tripId: string;

    /** Gửi lại đúng các ngày hiện có — đủ để PUT hợp lệ. */
    const unchanged = (trip: {
      days: Array<{ id: string }>;
      unscheduled: Array<{ placeId: string }>;
    }) => ({
      days: trip.days.map((d) => ({ id: d.id, items: [] })),
      unscheduledPlaceIds: trip.unscheduled.map((u) => u.placeId),
    });

    beforeAll(async () => {
      groupId = (
        await call('a').post('/groups', { name: 'Nhóm lịch trình' }).expect(201)
      ).body.id;
      const viewer = await call('a')
        .post(`/groups/${groupId}/invites`)
        .expect(201);
      await call('b').post(`/invites/${viewer.body.token}/accept`).expect(201);
    });

    it('owner tạo lịch trình trong nhóm; viewer không tạo được', async () => {
      const res = await call('a')
        .post('/itineraries', manualTrip({ groupId }))
        .expect(201);
      tripId = res.body.id;
      expect(res.body).toMatchObject({
        groupId,
        groupName: 'Nhóm lịch trình',
        myRole: 'creator',
      });
      const denied = await call('b')
        .post('/itineraries', manualTrip({ groupId }))
        .expect(403);
      expect(denied.body.code).toBe('FORBIDDEN_ROLE');
      await call('c').post('/itineraries', manualTrip({ groupId })).expect(404);
    });

    it('viewer thấy trong danh sách và xem được, nhưng không sửa, không xóa', async () => {
      const list = await call('b').get('/itineraries').expect(200);
      expect(list.body).toContainEqual(
        expect.objectContaining({
          id: tripId,
          groupId,
          groupName: 'Nhóm lịch trình',
          myRole: 'viewer',
        }),
      );
      const trip = await call('b').get(`/itineraries/${tripId}`).expect(200);
      expect(trip.body.myRole).toBe('viewer');
      await call('b')
        .get(`/itineraries/${tripId}/alternatives?placeId=${placeIds[0]}`)
        .expect(200);
      expect(
        (
          await call('b')
            .put(`/itineraries/${tripId}`, unchanged(trip.body))
            .expect(403)
        ).body.code,
      ).toBe('FORBIDDEN_ROLE');
      await call('b').delete(`/itineraries/${tripId}`).expect(403);
    });

    it('người ngoài nhóm nhận 404', async () => {
      await call('c').get(`/itineraries/${tripId}`).expect(404);
      expect(
        (await call('c').get('/itineraries').expect(200)).body.map(
          (x: { id: string }) => x.id,
        ),
      ).not.toContain(tripId);
    });

    it('editor sửa được; nhiều lần sửa liền nhau gộp thành một dòng nhật ký', async () => {
      const inv = await call('a')
        .post(`/groups/${groupId}/invites`, { role: 'editor' })
        .expect(201);
      await call('b').post(`/invites/${inv.body.token}/accept`).expect(201);
      const trip = await call('b').get(`/itineraries/${tripId}`).expect(200);
      await call('b')
        .put(`/itineraries/${tripId}`, unchanged(trip.body))
        .expect(200);
      await call('b')
        .put(`/itineraries/${tripId}`, unchanged(trip.body))
        .expect(200);
      const log = await call('a')
        .get(`/groups/${groupId}/activity`)
        .expect(200);
      const updates = log.body.items.filter(
        (x: { type: string }) => x.type === 'itinerary_updated',
      );
      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({
        actorId: userIds.b,
        payload: { itineraryId: tripId },
      });
      await call('b').delete(`/itineraries/${tripId}`).expect(403);
    });

    it('chỉ người tạo chuyển được lịch trình giữa các nhóm', async () => {
      const personal = await call('b')
        .post('/itineraries', manualTrip())
        .expect(201);
      expect(personal.body.groupId).toBeNull();
      const moved = await call('b')
        .patch(`/itineraries/${personal.body.id}/group`, { groupId })
        .expect(200);
      expect(moved.body).toMatchObject({
        groupId,
        groupName: 'Nhóm lịch trình',
        myRole: 'creator',
      });
      expect(
        (await call('a').get(`/itineraries/${personal.body.id}`).expect(200))
          .body.myRole,
      ).toBe('owner');
      await call('a')
        .patch(`/itineraries/${personal.body.id}/group`, { groupId: null })
        .expect(403);
      const out = await call('b')
        .patch(`/itineraries/${personal.body.id}/group`, { groupId: null })
        .expect(200);
      expect(out.body.groupId).toBeNull();
      await call('a').get(`/itineraries/${personal.body.id}`).expect(404);
      await call('c')
        .patch(`/itineraries/${personal.body.id}/group`, { groupId })
        .expect(404);
    });

    it('không chuyển được vào nhóm mình chỉ là viewer', async () => {
      const other = (
        await call('a').post('/groups', { name: 'Nhóm chỉ xem' }).expect(201)
      ).body.id;
      const inv = await call('a').post(`/groups/${other}/invites`).expect(201);
      await call('b').post(`/invites/${inv.body.token}/accept`).expect(201);
      const mine = await call('b')
        .post('/itineraries', manualTrip())
        .expect(201);
      await call('b')
        .patch(`/itineraries/${mine.body.id}/group`, { groupId: other })
        .expect(403);
    });

    it('thành viên bị xóa khỏi nhóm mất quyền với lịch trình của nhóm ngay', async () => {
      await call('a')
        .delete(`/groups/${groupId}/members/${userIds.b}`)
        .expect(204);
      await call('b').get(`/itineraries/${tripId}`).expect(404);
    });

    it('owner nhóm xóa được lịch trình của người khác trong nhóm', async () => {
      const inv = await call('a')
        .post(`/groups/${groupId}/invites`, { role: 'editor' })
        .expect(201);
      await call('b').post(`/invites/${inv.body.token}/accept`).expect(201);
      const theirs = await call('b')
        .post('/itineraries', manualTrip({ groupId }))
        .expect(201);
      await call('a').delete(`/itineraries/${theirs.body.id}`).expect(204);
      await call('b').get(`/itineraries/${theirs.body.id}`).expect(404);
    });
  });

  describe('link xem lịch trình', () => {
    let tripId: string;
    let groupId: string;

    beforeAll(async () => {
      groupId = (
        await call('a')
          .post('/groups', { name: 'Nhóm chia sẻ web' })
          .expect(201)
      ).body.id;
      const inv = await call('a')
        .post(`/groups/${groupId}/invites`)
        .expect(201);
      await call('c').post(`/invites/${inv.body.token}/accept`).expect(201);
      tripId = (
        await call('a')
          .post(
            '/itineraries',
            manualTrip({ groupId, notes: 'ghi chú riêng tư' }),
          )
          .expect(201)
      ).body.id;
    });

    it('xem công khai không cần đăng nhập, không lộ dữ liệu riêng', async () => {
      const link = await call('a')
        .post(`/itineraries/${tripId}/share-link`)
        .expect(201);
      expect(link.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const res = await call(null)
        .get(`/public/itineraries/${link.body.token}`)
        .expect(200);
      expect(res.body).toMatchObject({
        travelParty: 'friends',
        adults: 2,
        children: 0,
        planner: 'manual',
      });
      expect(typeof res.body.regionName).toBe('string');
      expect(res.body.days).toHaveLength(2);
      const raw = JSON.stringify(res.body);
      for (const secret of [
        userIds.a,
        groupId,
        'ghi chú riêng tư',
        'aiEditsRemaining',
        'ownerId',
      ]) {
        expect(raw).not.toContain(secret);
      }
    });

    it('tạo lại thì link cũ chết ngay; thu hồi thì link mới chết', async () => {
      const first = await call('a')
        .post(`/itineraries/${tripId}/share-link`)
        .expect(201);
      const second = await call('a')
        .post(`/itineraries/${tripId}/share-link`)
        .expect(201);
      expect(
        (
          await call(null)
            .get(`/public/itineraries/${first.body.token}`)
            .expect(404)
        ).body.code,
      ).toBe('SHARE_LINK_NOT_FOUND');
      await call(null)
        .get(`/public/itineraries/${second.body.token}`)
        .expect(200);
      await call('a').delete(`/itineraries/${tripId}/share-link`).expect(204);
      await call('a').delete(`/itineraries/${tripId}/share-link`).expect(204);
      await call(null)
        .get(`/public/itineraries/${second.body.token}`)
        .expect(404);
    });

    it('viewer không tạo được link; người ngoài nhận 404', async () => {
      await call('c').post(`/itineraries/${tripId}/share-link`).expect(403);
      await call('b').post(`/itineraries/${tripId}/share-link`).expect(404);
    });

    it('token rác trả 404', async () => {
      for (const bad of ['abc', 'A'.repeat(43), '%00']) {
        await call(null)
          .get(`/public/itineraries/${encodeURIComponent(bad)}`)
          .expect(404);
      }
    });
  });
});
