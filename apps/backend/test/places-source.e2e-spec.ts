import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';

/** Ràng buộc nguồn của bảng places (F4): dòng OSM như cũ, dòng Google chỉ cần place_id. */
describe('places.source (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await db?.query(
      `DELETE FROM places WHERE google_place_id LIKE 'e2e-src-%' OR (osm_id <= -9300 AND osm_id > -9400)`,
    );
    await app?.close();
  });

  it('dòng OSM cũ mặc định source = osm', async () => {
    const [row] = (await db.query(
      `INSERT INTO places (osm_type, osm_id, name, category, location, composite_score)
       VALUES ('node', -9300, 'E2E src osm', 'food', ST_SetSRID(ST_MakePoint(108.4, 11.9), 4326), 10)
       RETURNING source`,
    )) as Array<{ source: string }>;
    expect(row.source).toBe('osm');
  });

  it('dòng OSM thiếu tọa độ bị từ chối', async () => {
    await expect(
      db.query(
        `INSERT INTO places (osm_type, osm_id, name, category, composite_score)
         VALUES ('node', -9301, 'E2E src osm thiếu', 'food', 10)`,
      ),
    ).rejects.toThrow(/chk_place_source/);
  });

  it('dòng Google chỉ cần google_place_id, không cần osm hay tọa độ', async () => {
    await db.query(
      `INSERT INTO places (source, google_place_id, name, category, composite_score)
       VALUES ('google', 'e2e-src-1', 'E2E src google', 'cafe', 0)`,
    );
    await expect(
      db.query(
        `INSERT INTO places (source, name, category, composite_score)
         VALUES ('google', 'E2E src google thiếu id', 'cafe', 0)`,
      ),
    ).rejects.toThrow(/chk_place_source/);
  });

  it('một google_place_id chỉ có một dòng Google', async () => {
    await expect(
      db.query(
        `INSERT INTO places (source, google_place_id, name, category, composite_score)
         VALUES ('google', 'e2e-src-1', 'E2E src google 2', 'cafe', 0)`,
      ),
    ).rejects.toThrow(/uq_place_google/);
  });

  it('có bảng share_imports và cột nguồn của saved_places', async () => {
    const cols = (await db.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE (table_name = 'share_imports')
           OR (table_name = 'saved_places' AND column_name IN ('source', 'share_import_id'))`,
    )) as Array<{ table_name: string; column_name: string }>;
    const names = cols.map((c) => `${c.table_name}.${c.column_name}`);
    expect(names).toEqual(
      expect.arrayContaining([
        'share_imports.status',
        'share_imports.candidates',
        'saved_places.source',
        'saved_places.share_import_id',
      ]),
    );
  });
});
