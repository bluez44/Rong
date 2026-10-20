import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { LangchainService } from '../src/langchain/langchain.service.js';
import { RegionImages } from '../src/modules/recommendations/region-images.js';
import { UnsplashClient } from '../src/modules/recommendations/unsplash.client.js';

describe('Ảnh vùng (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let images: RegionImages;
  let regionId: string;
  const searchLandscape = vi.fn();
  const started = new Date();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LangchainService)
      .useValue({ planItinerary: vi.fn(), suggestThemes: vi.fn() })
      .overrideProvider(UnsplashClient)
      .useValue({ enabled: true, searchLandscape })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DataSource);
    images = app.get(RegionImages);
    // Vùng ít khả năng đã có ảnh trong DB dev; xóa ảnh (nếu có) do chính test này tạo ở lần chạy trước.
    [{ id: regionId }] = (await db.query(
      `SELECT id FROM regions WHERE source_key = 'vn:destination:mang-den'`,
    )) as Array<{ id: string }>;
    await db.query(`DELETE FROM region_images WHERE region_id = $1`, [regionId]);
  });

  afterAll(async () => {
    await db?.query(`DELETE FROM region_images WHERE region_id = $1 AND fetched_at >= $2`, [regionId, started]);
    await db?.query(
      `DELETE FROM region_places rp USING places p WHERE rp.place_id = p.id AND p.name = 'E2E img place'`,
    );
    await db?.query(`DELETE FROM places WHERE name = 'E2E img place'`);
    await app?.close();
  });

  const row = async () =>
    ((await db.query(`SELECT * FROM region_images WHERE region_id = $1`, [regionId])) as Array<Record<string, unknown>>)[0];

  it('Unsplash có ảnh → lưu kèm tác giả', async () => {
    searchLandscape.mockResolvedValueOnce({
      url: 'https://images.unsplash.com/x',
      width: 10,
      height: 5,
      author: 'A',
      authorUrl: 'https://unsplash.com/@a',
      pageUrl: 'https://unsplash.com/photos/x',
    });
    expect(await images.fetch(regionId)).toBe('found');
    expect(await row()).toMatchObject({ status: 'found', source: 'unsplash', author: 'A', license: 'Unsplash License' });
    // Đã có ảnh thì bỏ qua.
    expect(await images.fetch(regionId)).toBe('skipped');
  });

  it('ảnh bị chặn thì không tìm lại, kể cả "none" đã cũ', async () => {
    await db.query(`DELETE FROM region_images WHERE region_id = $1`, [regionId]);
    await db.query(
      `INSERT INTO region_images (region_id, status, blocked, fetched_at) VALUES ($1, 'none', true, now() - interval '40 days')`,
      [regionId],
    );
    searchLandscape.mockClear();
    expect(await images.fetch(regionId)).toBe('skipped');
    expect(searchLandscape).not.toHaveBeenCalled();
  });

  it('Unsplash không có → ảnh địa điểm hạng cao nhất, ghi nguồn bài viết', async () => {
    await db.query(`DELETE FROM region_images WHERE region_id = $1`, [regionId]);
    searchLandscape.mockResolvedValueOnce(null);
    const [place] = (await db.query(
      `INSERT INTO places (source, name, category, location, location_source)
       VALUES ('web', 'E2E img place', 'nature', ST_SetSRID(ST_MakePoint(108.2, 14.6), 4326), 'ai') RETURNING id`,
    )) as Array<{ id: string }>;
    await db.query(
      `INSERT INTO region_places (region_id, place_id, rank, image) VALUES ($1, $2, -1000, $3::jsonb)`,
      [regionId, place.id, JSON.stringify({ url: 'https://blog.example/anh.jpg', sourceUrl: 'https://blog.example/bai' })],
    );
    expect(await images.fetch(regionId)).toBe('found');
    expect(await row()).toMatchObject({
      status: 'found',
      source: 'web',
      url: 'https://blog.example/anh.jpg',
      source_url: 'https://blog.example/bai',
    });
  });
});
