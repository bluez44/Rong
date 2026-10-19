import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { LangchainService } from '../src/langchain/langchain.service.js';
import { RecommendationsQueue } from '../src/modules/recommendations/queue/recommendations-queue.js';
import { UnsplashClient } from '../src/modules/recommendations/unsplash.client.js';
import {
  cleanupRecommendationRegions,
  seedRecommendationRegions,
  type RecommendationRegionsFixture,
} from './fixtures/recommendation-regions.js';

describe('Chủ đề riêng (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let jwt: JwtService;
  let queue: RecommendationsQueue;
  let fixture: RecommendationRegionsFixture;
  let regions: RecommendationRegionsFixture['regions'];
  const planItinerary = vi.fn();
  const suggestThemes = vi.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LangchainService)
      .useValue({ planItinerary, suggestThemes })
      .overrideProvider(UnsplashClient)
      .useValue({ enabled: false, searchLandscape: async () => null })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    db = app.get(DataSource);
    jwt = app.get(JwtService);
    queue = app.get(RecommendationsQueue);
    fixture = await seedRecommendationRegions(db, 'themes');
    regions = fixture.regions;
  });

  afterAll(async () => {
    await queue?.idle();
    await db?.query(`DELETE FROM users WHERE display_name = 'e2e-rec-themes'`);
    await cleanupRecommendationRegions(db, fixture);
    await app?.close();
  });

  const newUser = async () => {
    const [user] = (await db.query(
      `INSERT INTO users (display_name) VALUES ('e2e-rec-themes') RETURNING id`,
    )) as Array<{ id: string }>;
    return { id: user.id, token: jwt.sign({ sub: user.id }) };
  };

  it('đổi sở thích → sinh chủ đề, chỉ giữ vùng có thật', async () => {
    const u = await newUser();
    suggestThemes.mockResolvedValueOnce({
      themes: [
        { label: 'Xứ sở cà phê', icon: 'cafe', categories: ['cafe', 'beach'], regionIds: [regions[0].id, 'vung-bia'] },
        { label: 'Chỉ có vùng bịa', icon: 'sun', categories: ['nature'], regionIds: ['vung-bia'] },
      ],
    });
    await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ interests: ['cafe'] })
      .expect(200);
    await queue.idle();

    expect(suggestThemes).toHaveBeenCalledTimes(1);
    const [, req] = suggestThemes.mock.calls[0] as [string, string];
    expect(req).toContain(regions[0].id);
    expect(req).toContain('cafe');

    const themes = (await db.query(
      `SELECT label, categories::text[] AS categories, region_ids FROM user_themes WHERE user_id = $1`,
      [u.id],
    )) as Array<{ label: string; categories: string[]; region_ids: string[] }>;
    expect(themes).toEqual([{ label: 'Xứ sở cà phê', categories: ['cafe'], region_ids: [regions[0].id] }]);

    const feed = await request(app.getHttpServer())
      .get('/api/recommendations')
      .set('Authorization', `Bearer ${u.token}`)
      .expect(200);
    expect(feed.body.themes[1]).toMatchObject({ label: 'Xứ sở cà phê', kind: 'personal' });
    await queue.idle();
  });

  it('Gemini lỗi → giữ chủ đề cũ', async () => {
    const u = await newUser();
    await db.query(
      `INSERT INTO user_themes (user_id, label, icon, categories, region_ids, expires_at)
       VALUES ($1, 'Chủ đề cũ', 'sun', '{nature}', $2::uuid[], now() + interval '3 days')`,
      [u.id, [regions[1].id]],
    );
    suggestThemes.mockRejectedValueOnce(new Error('hết quota'));
    await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ interests: ['nature'] })
      .expect(200);
    await queue.idle();
    const rows = (await db.query(`SELECT label FROM user_themes WHERE user_id = $1`, [u.id])) as Array<{ label: string }>;
    expect(rows.map((r) => r.label)).toEqual(['Chủ đề cũ']);
  });

  it('Gemini chỉ trả vùng bịa → lọc hết, giữ chủ đề cũ', async () => {
    const u = await newUser();
    await db.query(
      `INSERT INTO user_themes (user_id, label, icon, categories, region_ids, expires_at)
       VALUES ($1, 'Chủ đề cũ', 'sun', '{nature}', $2::uuid[], now() + interval '3 days')`,
      [u.id, [regions[1].id]],
    );
    suggestThemes.mockResolvedValueOnce({
      themes: [
        { label: 'Chỉ có vùng bịa', icon: 'sun', categories: ['nature'], regionIds: ['vung-bia-1', 'vung-bia-2'] },
      ],
    });
    await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ interests: ['nature'] })
      .expect(200);
    await queue.idle();
    const rows = (await db.query(`SELECT label FROM user_themes WHERE user_id = $1`, [u.id])) as Array<{ label: string }>;
    expect(rows.map((r) => r.label)).toEqual(['Chủ đề cũ']);
  });

  it('sở thích không đổi → không gọi Gemini', async () => {
    const u = await newUser();
    await db.query(`UPDATE users SET interests = '{cafe}' WHERE id = $1`, [u.id]);
    suggestThemes.mockClear();
    await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${u.token}`)
      .send({ interests: ['cafe'] })
      .expect(200);
    await queue.idle();
    expect(suggestThemes).not.toHaveBeenCalled();
  });
});
