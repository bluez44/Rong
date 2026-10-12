# F4 Share-to-app Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người dùng chia sẻ link/văn bản từ TikTok, Facebook, Instagram, YouTube hay trình duyệt vào app mobile; backend nhận diện địa điểm, người dùng xác nhận, địa điểm vào danh sách "Muốn đi".

**Architecture:** Module backend mới `modules/share-import` chạy một job nền (bảng `share_imports`, client hỏi lại) gồm: lấy metadata (oEmbed / Open Graph, chống SSRF) → Gemini trích tên địa điểm + grounding → khớp catalog OSM, không được thì Google Text Search. Bảng `places` có thêm nguồn `google` (chỉ `google_place_id`, tên từ nội dung người dùng, tọa độ hạn 30 ngày), bị loại khỏi mọi chỗ xếp hạng. Mobile nhận share bằng `expo-share-intent` và có màn xác nhận.

**Tech Stack:** NestJS 12, TypeORM raw SQL, Postgres + PostGIS + pg_trgm, LangChain + Gemini (`@langchain/google-genai`), zod, vitest + supertest; Expo SDK 57 + expo-router, `expo-share-intent`.

**Spec:** `docs/superpowers/specs/2026-10-12-share-to-app-design.md`

## Global Constraints

- ESM: import tương đối kết thúc bằng `.js`.
- Comment, log, thông báo lỗi bằng tiếng Việt. Lỗi HTTP có thân `{ statusCode, code, message }`.
- Schema chỉ đổi qua migration SQL viết tay trong `apps/backend/src/database/migrations/`, tên `<timestamp>-<Name>.ts`, timestamp sau `1759000000000`.
- Tham số SQL không rõ kiểu phải ép kiểu (`$3::float8`, `$1::uuid[]`).
- Chỉ `modules/google/GooglePlacesService` được gọi Google. Không lưu nội dung Google; tọa độ Google tối đa 30 ngày; không xếp hạng/sắp xếp dựa trên dữ liệu Google.
- Mọi truy vấn danh mục để liệt kê/xếp hạng/gợi ý phải có `p.source = 'osm'`.
- Sau khi sửa `packages/shared-types`, chạy `pnpm --filter @rong/backend build:deps` trước khi gọi `vitest`/`tsc` trực tiếp.
- Biến môi trường mới thêm vào `src/config/configuration.ts` **và** `apps/backend/.env.example`.
- Giới hạn: `SHARE_IMPORT_DAILY_LIMIT` mặc định 30 lượt / người / 24 giờ; tối đa 15 địa điểm mỗi lượt; tối đa 3 lựa chọn Google mỗi ứng viên; job tối đa 30 giây; job `pending` quá 2 phút khi boot → `failed INTERRUPTED`; `shared_text` cắt ở 5 000 ký tự; `url` ≤ 2 048.
- Fetch link: chỉ http/https, cổng 80/443 (hoặc mặc định), tối đa 5 redirect, timeout 5 giây, đọc tối đa 1 MB.
- Mobile: màn mới bọc `<Screen>`; ô nhập trong `ScrollView` với `keyboardShouldPersistTaps="handled"`; dùng `authFetch` từ `useAuth()`.

## Review Focus

1. **Caption dán kèm link** (TikTok/Facebook chia sẻ dạng "Quán ngon quá 😋 https://vt.tiktok.com/ZS…/") — phải tách được URL và vẫn dùng caption làm văn bản. Test ở Task 4 (`extractUrl` + `normalizeShareInput`).
2. **Link rút gọn redirect tới IP nội bộ** (`http://bit.ly/x` → `http://169.254.169.254/`) — phải dừng, không đọc. Test ở Task 5.
3. **Người dùng bấm "Lưu" hai lần** hoặc lưu lại cùng lựa chọn — phải idempotent, không tạo hai dòng `places` Google. Test ở Task 10.
4. **Địa điểm Google đã quá 30 ngày** mở chi tiết hoặc xếp lịch — phải lấy lại tọa độ, Google lỗi thì báo rõ thay vì tọa độ (0,0). Test ở Task 9.
5. **Server restart giữa lúc nhận diện** — job không được treo `pending` mãi. Test ở Task 10.

---

## File Structure

**Backend — tạo mới**
- `src/database/migrations/1759100000000-AddShareImports.ts` — `places.source`, `share_imports`, `saved_places.source/share_import_id`.
- `src/modules/places/catalog-match.ts` — truy vấn khớp tên vào danh mục OSM, dùng chung v2 và share-import.
- `src/modules/places/place-location.service.ts` — `ensure()` lấy lại tọa độ Google hết hạn.
- `src/modules/places/google-location-janitor.ts` — xóa tọa độ Google quá hạn mỗi 6 giờ.
- `src/modules/share-import/share-url.ts` — tách/chuẩn hóa URL, nhận diện nền tảng (thuần).
- `src/modules/share-import/link-metadata.service.ts` — gateway oEmbed / Open Graph, chống SSRF.
- `src/modules/share-import/place-extraction.ts` — prompt + schema Gemini, grounding.
- `src/modules/share-import/region-lookup.service.ts` — vùng theo gợi ý tên / theo tọa độ.
- `src/modules/share-import/place-resolver.ts` — catalog → Google, độ tin cậy (thuần, deps tiêm vào).
- `src/modules/share-import/share-imports.service.ts`, `share-imports.controller.ts`, `share-import.module.ts`, `share-import.constants.ts`, `dto/create-share-import.dto.ts`, `dto/save-share-import.dto.ts`.
- Test: `*.spec.ts` cạnh từng file; `test/share-imports.e2e-spec.ts`; `test/places-source.e2e-spec.ts`; `test/share-import.live-spec.ts`; `test/fixtures/share-links.json`.

**Backend — sửa**
- `src/modules/places/entities/place.entity.ts`, `places.service.ts`, `places-v2.service.ts`, `places.module.ts`.
- `src/modules/google/google-places.service.ts` (+ spec).
- `src/modules/itineraries/itineraries.service.ts`, `itineraries.module.ts`.
- `src/modules/saved-places/saved-places.service.ts`, `saved-places.module.ts`.
- `src/config/configuration.ts`, `.env.example`, `src/app.module.ts`, `src/modules/README.md`, root `CLAUDE.md`.

**Shared types**
- Tạo `packages/shared-types/src/share-import.ts`; sửa `place.ts` (`SavedPlace`), `itinerary.ts` (warning type), `index.ts`.

**Mobile**
- Sửa `apps/mobile/app.config.ts`, `package.json`, `src/app/_layout.tsx`, `src/app/(app)/_layout.tsx`, `src/app/(app)/saved.tsx`.
- Tạo `src/app/+native-intent.tsx`, `src/lib/share-intent.tsx`, `src/hooks/use-share-import.ts`, `src/app/(app)/share-import/[id].tsx`, `src/components/share-source-card.tsx`.

---

### Task 1: Migration và entity cho `places.source`, `share_imports`, `saved_places`

**Files:**
- Create: `apps/backend/src/database/migrations/1759100000000-AddShareImports.ts`
- Modify: `apps/backend/src/modules/places/entities/place.entity.ts`
- Test: `apps/backend/test/places-source.e2e-spec.ts`

**Interfaces:**
- Produces: cột `places.source text ('osm'|'google')`, `places.location_expires_at timestamptz`, ràng buộc `chk_place_source`, index `uq_place_google`; bảng `share_imports` (spec §3.2); `saved_places.source`, `saved_places.share_import_id`.

- [ ] **Step 1: Viết test e2e cho ràng buộc**

`apps/backend/test/places-source.e2e-spec.ts`:

```ts
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
```

- [ ] **Step 2: Chạy test, xác nhận lỗi**

Run (trong `apps/backend`, cần `pnpm infra:up`): `npx vitest run --config vitest.config.e2e.ts test/places-source.e2e-spec.ts`
Expected: FAIL — `column "source" does not exist`.

- [ ] **Step 3: Viết migration**

`apps/backend/src/database/migrations/1759100000000-AddShareImports.ts`:

```ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F4 — Chia sẻ vào app.
 *
 * `places` nhận thêm dòng nguồn Google: chỉ `google_place_id` (trường Google
 * duy nhất được lưu vô thời hạn), tên lấy từ nội dung người dùng chia sẻ, loại
 * do AI phân từ chính nội dung đó, và tọa độ Google có hạn 30 ngày
 * (`location_expires_at`, PRD 7.4). Dòng Google không bao giờ được xếp hạng.
 *
 * `share_imports` là job nhận diện; `saved_places` ghi nguồn của lượt lưu.
 */
export class AddShareImports1759100000000 implements MigrationInterface {
  name = 'AddShareImports1759100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "places"
        ADD COLUMN "source" text NOT NULL DEFAULT 'osm',
        ADD COLUMN "location_expires_at" timestamptz,
        ALTER COLUMN "osm_type" DROP NOT NULL,
        ALTER COLUMN "osm_id" DROP NOT NULL,
        ALTER COLUMN "location" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "places" ADD CONSTRAINT "chk_place_source" CHECK (
        ("source" = 'osm' AND "osm_type" IS NOT NULL AND "osm_id" IS NOT NULL AND "location" IS NOT NULL)
        OR ("source" = 'google' AND "google_place_id" IS NOT NULL)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_place_google" ON "places" ("google_place_id") WHERE "source" = 'google'`,
    );

    await queryRunner.query(`
      CREATE TABLE "share_imports" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "url" text,
        "shared_text" text,
        "status" text NOT NULL DEFAULT 'pending',
        "platform" text,
        "metadata" jsonb,
        "candidates" jsonb NOT NULL DEFAULT '[]',
        "error_code" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "finished_at" timestamptz,
        CONSTRAINT "chk_share_import_status" CHECK ("status" IN ('pending', 'done', 'failed')),
        CONSTRAINT "fk_share_import_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_share_import_user_created" ON "share_imports" ("user_id", "created_at" DESC)`,
    );

    await queryRunner.query(`
      ALTER TABLE "saved_places"
        ADD COLUMN "source" text NOT NULL DEFAULT 'manual',
        ADD COLUMN "share_import_id" uuid,
        ADD CONSTRAINT "chk_saved_place_source" CHECK ("source" IN ('manual', 'share')),
        ADD CONSTRAINT "fk_saved_place_share_import" FOREIGN KEY ("share_import_id")
          REFERENCES "share_imports" ("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "saved_places"
        DROP CONSTRAINT IF EXISTS "fk_saved_place_share_import",
        DROP CONSTRAINT IF EXISTS "chk_saved_place_source",
        DROP COLUMN IF EXISTS "share_import_id",
        DROP COLUMN IF EXISTS "source"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "share_imports"`);
    // Dòng Google không có osm/tọa độ: phải xóa trước khi trả NOT NULL.
    await queryRunner.query(`DELETE FROM "places" WHERE "source" = 'google'`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_place_google"`);
    await queryRunner.query(
      `ALTER TABLE "places" DROP CONSTRAINT IF EXISTS "chk_place_source"`,
    );
    await queryRunner.query(`
      ALTER TABLE "places"
        ALTER COLUMN "location" SET NOT NULL,
        ALTER COLUMN "osm_id" SET NOT NULL,
        ALTER COLUMN "osm_type" SET NOT NULL,
        DROP COLUMN "location_expires_at",
        DROP COLUMN "source"
    `);
  }
}
```

- [ ] **Step 4: Cập nhật entity `Place`**

Trong `apps/backend/src/modules/places/entities/place.entity.ts`:
- Sửa comment class: thêm câu "Dòng `source = 'google'` (F4) chỉ có `googlePlaceId`, tên từ nội dung người dùng chia sẻ và tọa độ Google hạn 30 ngày."
- `osmType`: `@Column({ name: 'osm_type', type: 'text', nullable: true }) osmType!: string | null;`
- `osmId`: `@Column({ name: 'osm_id', type: 'bigint', nullable: true }) osmId!: string | null;`
- `location`: thêm `nullable: true`, kiểu `Point | null`.
- Thêm:

```ts
  /** 'osm' | 'google'. Dòng Google không bao giờ được liệt kê hay xếp hạng (PRD 7.4). */
  @Column({ name: 'source', type: 'text', default: 'osm' })
  source!: 'osm' | 'google';

  /** Chỉ dòng Google: tọa độ Google hết hạn lúc này (tối đa 30 ngày). */
  @Column({ name: 'location_expires_at', type: 'timestamptz', nullable: true })
  locationExpiresAt!: Date | null;
```

Sửa mọi lỗi typecheck do `osmType/osmId/location` thành nullable (chạy `pnpm typecheck` để thấy). Chỗ đọc qua raw SQL không bị ảnh hưởng.

- [ ] **Step 5: Chạy migration và test**

Run: `pnpm migration:run && npx vitest run --config vitest.config.e2e.ts test/places-source.e2e-spec.ts && pnpm typecheck`
Expected: PASS cả 5 test, typecheck sạch.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/database/migrations/1759100000000-AddShareImports.ts apps/backend/src/modules/places/entities/place.entity.ts apps/backend/test/places-source.e2e-spec.ts
git commit -m "feat(backend): add google-sourced places and share_imports schema"
```

---

### Task 2: Loại dòng Google khỏi danh mục, v2, extras và gợi ý thay thế

**Files:**
- Create: `apps/backend/src/modules/places/catalog-match.ts`
- Modify: `apps/backend/src/modules/places/places.service.ts` (truy vấn `listForRegion`, `hasPlaces`)
- Modify: `apps/backend/src/modules/places/places-v2.service.ts` (`matchCatalog` → dùng `catalog-match.ts`)
- Modify: `apps/backend/src/modules/itineraries/itineraries.service.ts` (`poolInArea`, `alternatives`)
- Test: `apps/backend/test/places-source.e2e-spec.ts` (thêm), `apps/backend/src/modules/places/places-v2.service.spec.ts` (phải vẫn qua)

**Interfaces:**
- Produces (`catalog-match.ts`):

```ts
export interface CatalogMatch {
  idx: string;           // vị trí 1-based trong mảng names
  id: string;
  lat: number;
  lng: number;
  osm_type: string;
  osm_id: string;
  wikidata_id: string | null;
  opening_hours: string | null;
  website: string | null;
}
export const CATALOG_MIN_SIMILARITY = 0.6;
export const CATALOG_MIN_LENGTH_RATIO = 0.75;
export function matchCatalog(
  db: Pick<DataSource, 'query'>,
  names: string[],
  bbox: Bbox | null,
  minSimilarity?: number,   // mặc định CATALOG_MIN_SIMILARITY
): Promise<CatalogMatch[]>;
```

- [ ] **Step 1: Viết test e2e "dòng Google không lọt"**

Thêm vào `apps/backend/test/places-source.e2e-spec.ts` (đổi `beforeAll` thêm `ValidationPipe`, `setGlobalPrefix('api')`, override `LangchainService` như `test/itinerary.e2e-spec.ts`, và tạo user + token bằng `JwtService`; copy nguyên khối đó):

```ts
  describe('dòng Google không được liệt kê hay xếp hạng', () => {
    let regionId: string;
    let osmId: string;
    let googleId: string;
    let fetchedAt: Date | null;

    beforeAll(async () => {
      [{ id: regionId, places_fetched_at: fetchedAt }] = (await db.query(
        `SELECT id, places_fetched_at FROM regions WHERE source_key = 'vn:destination:da-lat'`,
      )) as Array<{ id: string; places_fetched_at: Date | null }>;
      // Coi như vùng đã tải xong từ OSM để GET không gọi Overpass.
      await db.query(`UPDATE regions SET places_fetched_at = now() WHERE id = $1`, [regionId]);
      [{ id: osmId }] = (await db.query(
        `INSERT INTO places (osm_type, osm_id, name, category, location, composite_score)
         VALUES ('node', -9310, 'E2E src Cà phê Rêu', 'cafe', ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326), 5)
         RETURNING id`,
      )) as Array<{ id: string }>;
      // Điểm cao hơn mọi dòng OSM, cùng loại, ngay cạnh: nếu lọt thì chắc chắn đứng đầu.
      [{ id: googleId }] = (await db.query(
        `INSERT INTO places (source, google_place_id, name, category, location, location_expires_at, composite_score)
         VALUES ('google', 'e2e-src-rank', 'E2E src Cà phê Rêu Google', 'cafe',
                 ST_SetSRID(ST_MakePoint(108.4401, 11.9401), 4326), now() + interval '30 days', 100)
         RETURNING id`,
      )) as Array<{ id: string }>;
    });

    afterAll(async () => {
      await db.query(`UPDATE regions SET places_fetched_at = $2 WHERE id = $1`, [regionId, fetchedAt]);
    });

    it('GET /regions/:id/places không trả dòng Google', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/regions/${regionId}/places?categories=cafe&limit=50`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const ids = res.body.items.map((i: { id: string }) => i.id);
      expect(ids).toContain(osmId);
      expect(ids).not.toContain(googleId);
    });

    it('matchCatalog không khớp vào dòng Google', async () => {
      const { matchCatalog } = await import('../src/modules/places/catalog-match.js');
      const matches = await matchCatalog(db, ['E2E src Cà phê Rêu Google'], null);
      expect(matches.map((m) => m.id)).not.toContain(googleId);
    });

    it('extras của lịch trình không lấy dòng Google', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/itineraries')
        .set('Authorization', `Bearer ${token}`)
        .send({
          regionId,
          planningMode: 'ai',
          startsAt: '2026-12-01T08:00:00+07:00',
          endsAt: '2026-12-02T20:00:00+07:00',
          travelParty: 'friends',
          adults: 2,
          children: 0,
          selectedPlaceIds: [osmId],
        })
        .expect(201);
      const used = res.body.days.flatMap((d: { items: Array<{ placeId: string | null }> }) =>
        d.items.map((i) => i.placeId),
      );
      expect(used).not.toContain(googleId);

      const alt = await request(app.getHttpServer())
        .get(`/api/itineraries/${res.body.id}/alternatives?placeId=${osmId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(alt.body.map((a: { id: string }) => a.id)).not.toContain(googleId);
    });
  });
```

Trước khi chạy, mở `test/itinerary.e2e-spec.ts` để chép đúng thân request tạo lịch trình và cách gọi alternatives (tên query param), sửa test cho khớp nếu khác. Thêm `import request from 'supertest'` và `ValidationPipe`, `JwtService`, `LangchainService`, `vi`. Dọn: `afterAll` chính xóa `osm_id <= -9300 AND osm_id > -9400` và `google_place_id LIKE 'e2e-src-%'` (đã có), và user tạo ra.

- [ ] **Step 2: Chạy test, xác nhận lỗi**

Run: `npx vitest run --config vitest.config.e2e.ts test/places-source.e2e-spec.ts`
Expected: FAIL — dòng Google xuất hiện trong danh sách; import `catalog-match.js` không tồn tại.

- [ ] **Step 3: Tạo `catalog-match.ts` từ `matchCatalog` của v2**

`apps/backend/src/modules/places/catalog-match.ts`:

```ts
import type { DataSource } from 'typeorm';

import type { Bbox } from '../regions/bbox.js';

export interface CatalogMatch {
  idx: string;
  id: string;
  lat: number;
  lng: number;
  osm_type: string;
  osm_id: string;
  wikidata_id: string | null;
  opening_hours: string | null;
  website: string | null;
}

/** Ngưỡng độ giống tên (pg_trgm) để coi là cùng một địa điểm. */
export const CATALOG_MIN_SIMILARITY = 0.6;
/** Tên ngắn nằm gọn trong tên dài vẫn đủ giống, nên bắt độ dài (đã bỏ dấu) phải gần nhau. */
export const CATALOG_MIN_LENGTH_RATIO = 0.75;

/**
 * Mỗi tên lấy địa điểm OSM giống nhất (trong khung bao nếu có), một truy vấn
 * cho cả danh sách. Chỉ dòng `source = 'osm'`: dòng Google không phải danh mục.
 */
export function matchCatalog(
  db: Pick<DataSource, 'query'>,
  names: string[],
  bbox: Bbox | null,
  minSimilarity = CATALOG_MIN_SIMILARITY,
): Promise<CatalogMatch[]> {
  return db.query(
    `WITH candidates AS (
       SELECT p.*, unaccent(lower(p.name)) AS norm
         FROM places p
        WHERE p.source = 'osm'
          AND ($2::float8 IS NULL OR p.location && ST_MakeEnvelope($2, $3, $4, $5, 4326))
     )
     SELECT n.idx, m.*
       FROM unnest($1::text[]) WITH ORDINALITY AS n(name, idx)
       CROSS JOIN LATERAL (SELECT unaccent(lower(n.name)) AS q) nq
       CROSS JOIN LATERAL (
         SELECT c.id, ST_Y(c.location) AS lat, ST_X(c.location) AS lng,
                c.osm_type, c.osm_id, c.wikidata_id,
                c.tags->>'opening_hours' AS opening_hours,
                COALESCE(c.tags->>'website', c.tags->>'contact:website') AS website
           FROM candidates c
          WHERE similarity(c.norm, nq.q) >= $6
            AND least(length(c.norm), length(nq.q))::float8
                / greatest(length(c.norm), length(nq.q)) >= $7
          ORDER BY similarity(c.norm, nq.q) DESC
          LIMIT 1
       ) m`,
    [
      names,
      bbox ? bbox[1] : null,
      bbox ? bbox[0] : null,
      bbox ? bbox[3] : null,
      bbox ? bbox[2] : null,
      minSimilarity,
      CATALOG_MIN_LENGTH_RATIO,
    ],
  ) as Promise<CatalogMatch[]>;
}
```

Trong `places-v2.service.ts`: xóa `interface CatalogMatch`, hằng `CATALOG_MIN_SIMILARITY`, `CATALOG_MIN_LENGTH_RATIO` và thân `matchCatalog`; import từ `./catalog-match.js`; thay lời gọi bằng `matchCatalog(this.db, places.map((place) => place.title), bbox)`. Nếu `places-v2.service.spec.ts` khớp SQL theo chuỗi con, giữ đúng chuỗi đó (truy vấn mới vẫn chứa `similarity(` và `WITH ORDINALITY`).

- [ ] **Step 4: Thêm `source = 'osm'` vào các truy vấn còn lại**

- `places.service.ts` `listForRegion`: thêm `AND p.source = 'osm'` sau dòng `WHERE p.location && ...`.
- `places.service.ts` `hasPlaces`: `SELECT 1 FROM places WHERE source = 'osm' AND location && ...`.
- `itineraries.service.ts` `poolInArea`: thêm `AND p.source = 'osm'` vào `WHERE`.
- `itineraries.service.ts` `alternatives`: thêm `AND p.source = 'osm'` vào `WHERE` (sau `WHERE t.id = $1`).
- Grep lại để chắc không sót: `grep -rn "FROM places\|JOIN places" src --include=*.ts | grep -v spec`. Những chỗ còn lại (`saved-places`, `group-places`, `getDetail`, `loadPlaces`, `upsert`) đọc theo id do người dùng chọn — giữ nguyên.

- [ ] **Step 5: Chạy test**

Run: `npx vitest run src/modules/places && npx vitest run --config vitest.config.e2e.ts test/places-source.e2e-spec.ts test/itinerary.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/modules/places apps/backend/src/modules/itineraries/itineraries.service.ts apps/backend/test/places-source.e2e-spec.ts
git commit -m "feat(backend): keep google-sourced places out of catalog ranking"
```

---

### Task 3: Shared types

**Files:**
- Create: `packages/shared-types/src/share-import.ts`
- Modify: `packages/shared-types/src/place.ts` (`SavedPlace`), `packages/shared-types/src/itinerary.ts` (`ItineraryWarningType`), `packages/shared-types/src/index.ts`

**Interfaces:**
- Produces: mọi type dưới đây, dùng ở Task 10–14.

- [ ] **Step 1: Tạo `share-import.ts`**

```ts
import type { PlaceCategory } from './place';

/** Nền tảng nguồn của một lượt chia sẻ vào app (F4). */
export type SharePlatform = 'tiktok' | 'youtube' | 'facebook' | 'instagram' | 'web';

export type ShareImportStatus = 'pending' | 'done' | 'failed';

export type ShareImportErrorCode =
  | 'METADATA_UNAVAILABLE'
  | 'AI_UNAVAILABLE'
  | 'TIMEOUT'
  | 'INTERRUPTED';

/** Thẻ nguồn: chỉ metadata công khai để ghi nguồn, không sao chép nội dung (FR-4.5). */
export interface ShareSource {
  platform: SharePlatform;
  url: string | null;
  title: string | null;
  authorName: string | null;
  thumbnailUrl: string | null;
}

export type ShareImportOptionRef =
  | { kind: 'catalog'; placeId: string }
  | { kind: 'google'; googlePlaceId: string };

export interface ShareImportOption {
  ref: ShareImportOptionRef;
  /** catalog: tên trong danh mục; google: tên Google lấy trực tiếp (không lưu), có thể null. */
  name: string | null;
  address: string | null;
  regionId: string;
  regionName: string;
}

export type ShareImportConfidence = 'high' | 'low' | 'none';

export interface ShareImportCandidate {
  key: string;
  /** Tên AI trích từ nội dung được chia sẻ. */
  name: string;
  category: PlaceCategory;
  /** Trích đoạn ngắn nhắc tới địa điểm. */
  quote: string;
  confidence: ShareImportConfidence;
  options: ShareImportOption[];
}

export interface ShareImportSummary {
  id: string;
  status: ShareImportStatus;
  source: ShareSource;
  candidateCount: number;
  savedCount: number;
  createdAt: string;
}

export interface ShareImport extends ShareImportSummary {
  errorCode: ShareImportErrorCode | null;
  candidates: ShareImportCandidate[];
}

export interface CreateShareImportRequest {
  url?: string;
  text?: string;
}

export type ShareImportSelection = { candidateKey: string } & ShareImportOptionRef;

export interface SaveShareImportRequest {
  selections: ShareImportSelection[];
}

export interface SaveShareImportResponse {
  saved: number;
}
```

- [ ] **Step 2: Mở rộng `SavedPlace` và warning**

`place.ts` — thêm import `import type { SharePlatform } from './share-import';` và hai trường vào `SavedPlace`:

```ts
  /** 'share' khi lưu từ một lượt chia sẻ vào app (F4). */
  source: 'manual' | 'share';
  /** Chỉ khi `source = 'share'` và lượt chia sẻ còn: để ghi nguồn và mở link gốc. */
  shareSource: { platform: SharePlatform; title: string | null; url: string | null } | null;
```

`itinerary.ts` — thêm `| 'place_location_unavailable'` vào `ItineraryWarningType`.

`index.ts` — thêm `export * from './share-import';`.

- [ ] **Step 3: Build và typecheck**

Run (gốc repo): `pnpm --filter @rong/shared-types build && pnpm typecheck`
Expected: shared-types build OK. Backend báo lỗi ở `saved-places.service.ts` (thiếu `source`, `shareSource`) và mobile ở `saved-places.tsx` (`toggle` dựng `SavedPlace`). Sửa ngay:
- Backend `SavedPlacesService.list` tạm trả `source: 'manual', shareSource: null` (Task 10 thay bằng dữ liệu thật).
- Mobile `src/lib/saved-places.tsx` trong `toggle`: thêm `source: 'manual', shareSource: null` vào object mới.

Chạy lại `pnpm typecheck` → sạch.

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types apps/backend/src/modules/saved-places/saved-places.service.ts apps/mobile/src/lib/saved-places.tsx
git commit -m "feat(shared-types): add share import contract"
```

---

### Task 4: `share-url.ts` — tách và chuẩn hóa URL

**Files:**
- Create: `apps/backend/src/modules/share-import/share-url.ts`
- Test: `apps/backend/src/modules/share-import/share-url.spec.ts`

**Interfaces:**
- Produces:

```ts
export const MAX_URL_LENGTH = 2048;
export const MAX_SHARED_TEXT = 5000;
export function extractUrl(text: string): string | null;
export function normalizeShareUrl(raw: string): URL | null;   // null nếu không phải http(s) hợp lệ
export function detectPlatform(url: URL): SharePlatform;
export function normalizeShareInput(input: { url?: string; text?: string }):
  { url: URL | null; text: string | null } | null;           // null nếu không có gì dùng được
```

- [ ] **Step 1: Viết test**

```ts
import { describe, expect, it } from 'vitest';

import {
  detectPlatform,
  extractUrl,
  normalizeShareInput,
  normalizeShareUrl,
} from './share-url.js';

describe('extractUrl', () => {
  it('lấy URL đầu tiên trong caption, bỏ dấu câu dính cuối', () => {
    expect(
      extractUrl('Quán ngon quá 😋 https://vt.tiktok.com/ZSabc123/, ghé thử nha'),
    ).toBe('https://vt.tiktok.com/ZSabc123/');
    expect(extractUrl('(xem https://youtu.be/xyz).')).toBe('https://youtu.be/xyz');
  });

  it('không có URL thì null', () => {
    expect(extractUrl('Bánh căn Nhà Chung, Đà Lạt')).toBeNull();
  });
});

describe('normalizeShareUrl', () => {
  it('bỏ tham số theo dõi, giữ tham số cần thiết', () => {
    expect(
      normalizeShareUrl(
        'https://www.youtube.com/watch?v=abc&si=XYZ&utm_source=share&feature=shared',
      )?.toString(),
    ).toBe('https://www.youtube.com/watch?v=abc&feature=shared');
    expect(
      normalizeShareUrl('https://www.instagram.com/reel/C1/?igsh=abc')?.toString(),
    ).toBe('https://www.instagram.com/reel/C1/');
  });

  it('từ chối scheme lạ, cổng lạ, quá dài', () => {
    expect(normalizeShareUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeShareUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeShareUrl('http://example.com:8080/')).toBeNull();
    expect(normalizeShareUrl(`https://a.vn/${'x'.repeat(2100)}`)).toBeNull();
    expect(normalizeShareUrl('khong phai url')).toBeNull();
  });

  it('từ chối URL có user:pass', () => {
    expect(normalizeShareUrl('https://u:p@example.com/')).toBeNull();
  });
});

describe('detectPlatform', () => {
  it.each([
    ['https://www.tiktok.com/@a/video/1', 'tiktok'],
    ['https://vt.tiktok.com/ZS1/', 'tiktok'],
    ['https://youtu.be/x', 'youtube'],
    ['https://m.youtube.com/shorts/x', 'youtube'],
    ['https://www.facebook.com/share/r/1', 'facebook'],
    ['https://fb.watch/abc', 'facebook'],
    ['https://www.instagram.com/p/x', 'instagram'],
    ['https://vnexpress.net/bai-viet', 'web'],
    ['https://nottiktok.com/', 'web'],
  ])('%s → %s', (url, platform) => {
    expect(detectPlatform(new URL(url))).toBe(platform);
  });
});

describe('normalizeShareInput', () => {
  it('URL nằm trong text thì tách ra, text vẫn giữ làm mô tả', () => {
    const result = normalizeShareInput({ text: 'Đẹp lắm https://youtu.be/x' });
    expect(result?.url?.toString()).toBe('https://youtu.be/x');
    expect(result?.text).toBe('Đẹp lắm https://youtu.be/x');
  });

  it('chỉ có text không URL vẫn hợp lệ; cắt ở 5000 ký tự', () => {
    const result = normalizeShareInput({ text: 'a'.repeat(6000) });
    expect(result?.url).toBeNull();
    expect(result?.text).toHaveLength(5000);
  });

  it('url sai và text rỗng thì null', () => {
    expect(normalizeShareInput({ url: 'ftp://x', text: '   ' })).toBeNull();
    expect(normalizeShareInput({})).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận lỗi**

Run: `npx vitest run src/modules/share-import/share-url.spec.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Viết `share-url.ts`**

```ts
import type { SharePlatform } from '@rong/shared-types';

export const MAX_URL_LENGTH = 2048;
export const MAX_SHARED_TEXT = 5000;

/** Tham số chỉ để theo dõi lượt chia sẻ: bỏ để URL gọn và gộp được trùng. */
const TRACKING_PARAMS = /^(utm_.+|igsh|igshid|si|fbclid|gclid|mibextid|_t|_r|is_from_webapp|sender_device)$/i;

const PLATFORM_HOSTS: Array<[SharePlatform, string[]]> = [
  ['tiktok', ['tiktok.com']],
  ['youtube', ['youtube.com', 'youtu.be']],
  ['facebook', ['facebook.com', 'fb.watch', 'fb.com']],
  ['instagram', ['instagram.com']],
];

/** URL http(s) đầu tiên trong văn bản; bỏ dấu câu dính ở cuối. */
export function extractUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return null;
  return match[0].replace(/[),.;!?…]+$/u, '');
}

/** Chỉ nhận http/https, cổng mặc định, không có user:pass; bỏ tham số theo dõi. */
export function normalizeShareUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.port !== '' && url.port !== '80' && url.port !== '443') return null;
  if (url.username || url.password) return null;
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.hash = '';
  return url;
}

export function detectPlatform(url: URL): SharePlatform {
  const host = url.hostname.toLowerCase();
  for (const [platform, hosts] of PLATFORM_HOSTS) {
    if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) return platform;
  }
  return 'web';
}

/**
 * Chuẩn hóa thứ app gửi lên: URL riêng, hoặc URL nằm trong caption. Văn bản
 * luôn được giữ (kể cả khi có URL) vì caption thường là chỗ duy nhất nêu tên
 * địa điểm. Không còn gì dùng được thì null.
 */
export function normalizeShareInput(input: {
  url?: string;
  text?: string;
}): { url: URL | null; text: string | null } | null {
  const text = input.text?.trim().slice(0, MAX_SHARED_TEXT) || null;
  const rawUrl = input.url?.trim() || (text ? extractUrl(text) : null);
  const url = rawUrl ? normalizeShareUrl(rawUrl) : null;
  if (!url && !text) return null;
  return { url, text };
}
```

- [ ] **Step 4: Chạy test**

Run: `npx vitest run src/modules/share-import/share-url.spec.ts`
Expected: PASS. (Nếu `youtube.com/watch?...&feature=shared` đổi thứ tự tham số, sửa kỳ vọng theo thứ tự `URLSearchParams` giữ nguyên — nó giữ thứ tự chèn.)

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/share-import/share-url.ts apps/backend/src/modules/share-import/share-url.spec.ts
git commit -m "feat(backend): parse and normalize shared links"
```

---

### Task 5: `LinkMetadataService` — oEmbed, Open Graph, chống SSRF

**Files:**
- Create: `apps/backend/src/modules/share-import/link-metadata.service.ts`
- Test: `apps/backend/src/modules/share-import/link-metadata.service.spec.ts`

**Interfaces:**
- Consumes: `detectPlatform` (Task 4).
- Produces:

```ts
export interface LinkMetadata {
  platform: SharePlatform;
  finalUrl: string;
  title: string | null;
  description: string | null;
  authorName: string | null;
  thumbnailUrl: string | null;
}
export class UnsafeUrlError extends Error {}
export function isPublicAddress(ip: string): boolean;
export function parseOpenGraph(html: string): Pick<LinkMetadata, 'title' | 'description' | 'thumbnailUrl'> & { authorName: string | null };
export interface LinkMetadataDeps {
  fetch: typeof fetch;
  lookup: (hostname: string) => Promise<string[]>;  // mọi địa chỉ IP của host
  metaOembedToken: string | null;
  contactEmail: string;
}
export class LinkMetadataService {
  constructor(deps: LinkMetadataDeps);
  /** Ném UnsafeUrlError nếu host phân giải ra IP không công khai. */
  assertSafe(url: URL): Promise<void>;
  /** null khi nền tảng chặn / lỗi / không có gì; không bao giờ ném lỗi trừ UnsafeUrlError. */
  fetch(url: URL): Promise<LinkMetadata | null>;
}
export function createLinkMetadataService(config: { metaOembedToken: string | null; contactEmail: string }): LinkMetadataService;
```

- [ ] **Step 1: Viết test**

```ts
import { describe, expect, it, vi } from 'vitest';

import {
  isPublicAddress,
  LinkMetadataService,
  parseOpenGraph,
  UnsafeUrlError,
} from './link-metadata.service.js';

type Route = { status?: number; headers?: Record<string, string>; body?: string };

function service(
  routes: Record<string, Route>,
  dns: Record<string, string[]> = {},
  metaOembedToken: string | null = null,
) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: string | URL) => {
    const url = input.toString();
    calls.push(url);
    const route = routes[url];
    if (!route) return new Response('not found', { status: 404 });
    return new Response(route.body ?? '', {
      status: route.status ?? 200,
      headers: route.headers ?? { 'content-type': 'text/html' },
    });
  });
  const lookup = vi.fn(async (host: string) => dns[host] ?? ['93.184.216.34']);
  return {
    calls,
    svc: new LinkMetadataService({
      fetch: fetchImpl as unknown as typeof fetch,
      lookup,
      metaOembedToken,
      contactEmail: 'dev@rong.local',
    }),
  };
}

describe('isPublicAddress', () => {
  it.each([
    ['127.0.0.1', false],
    ['10.1.2.3', false],
    ['172.16.0.1', false],
    ['192.168.1.1', false],
    ['169.254.169.254', false],
    ['100.64.0.1', false],
    ['0.0.0.0', false],
    ['::1', false],
    ['fd00::1', false],
    ['fe80::1', false],
    ['::ffff:127.0.0.1', false],
    ['93.184.216.34', true],
    ['2606:4700::1111', true],
  ])('%s → %s', (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected);
  });
});

describe('parseOpenGraph', () => {
  it('đọc og:*, rơi về <title> và meta description, giải mã entity', () => {
    const html = `<html><head>
      <title>Không dùng</title>
      <meta property="og:title" content="Top 5 quán cà phê Đà Lạt &amp; view đồi">
      <meta name="description" content="Mô tả dự phòng">
      <meta property="og:image" content="https://cdn.vn/a.jpg">
    </head></html>`;
    expect(parseOpenGraph(html)).toEqual({
      title: 'Top 5 quán cà phê Đà Lạt & view đồi',
      description: 'Mô tả dự phòng',
      thumbnailUrl: 'https://cdn.vn/a.jpg',
      authorName: null,
    });
  });
});

describe('LinkMetadataService.fetch', () => {
  it('TikTok dùng oEmbed', async () => {
    const page = 'https://www.tiktok.com/@an/video/1';
    const { svc } = service({
      // Trang thật hay chặn bot (403); oEmbed vẫn chạy.
      [page]: { status: 403 },
      [`https://www.tiktok.com/oembed?url=${encodeURIComponent(page)}`]: {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Bánh căn Nhà Chung ngon nhất Đà Lạt',
          author_name: 'an.reviews',
          thumbnail_url: 'https://p16.tiktokcdn.com/t.jpg',
        }),
      },
    });
    await expect(svc.fetch(new URL(page))).resolves.toEqual({
      platform: 'tiktok',
      finalUrl: page,
      title: 'Bánh căn Nhà Chung ngon nhất Đà Lạt',
      description: null,
      authorName: 'an.reviews',
      thumbnailUrl: 'https://p16.tiktokcdn.com/t.jpg',
    });
  });

  it('link rút gọn: theo redirect rồi mới gọi oEmbed bằng URL cuối', async () => {
    const short = 'https://vt.tiktok.com/ZS1/';
    const page = 'https://www.tiktok.com/@an/video/2';
    const { svc } = service({
      [short]: { status: 301, headers: { location: page } },
      [page]: { body: '' },
      [`https://www.tiktok.com/oembed?url=${encodeURIComponent(page)}`]: {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Chợ đêm' }),
      },
    });
    const meta = await svc.fetch(new URL(short));
    expect(meta?.finalUrl).toBe(page);
    expect(meta?.title).toBe('Chợ đêm');
  });

  it('web thường dùng Open Graph', async () => {
    const page = 'https://vnexpress.net/da-lat';
    const { svc } = service({
      [page]: { body: '<meta property="og:title" content="Đà Lạt mùa hoa">' },
    });
    expect((await svc.fetch(new URL(page)))?.title).toBe('Đà Lạt mùa hoa');
  });

  it('Facebook không có token: đọc Open Graph; bị chặn thì null', async () => {
    const page = 'https://www.facebook.com/share/r/1';
    const { svc } = service({ [page]: { status: 403 } });
    await expect(svc.fetch(new URL(page))).resolves.toBeNull();
  });

  it('redirect sang IP nội bộ: dừng, không đọc trang đó', async () => {
    const short = 'https://bit.ly/x';
    const { svc, calls } = service(
      {
        [short]: { status: 302, headers: { location: 'http://metadata.internal/latest' } },
        'http://metadata.internal/latest': { body: 'SECRET' },
      },
      { 'metadata.internal': ['169.254.169.254'] },
    );
    await expect(svc.fetch(new URL(short))).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(calls).toEqual([short]);
  });

  it('quá 5 redirect thì null', async () => {
    const routes: Record<string, Route> = {};
    for (let i = 0; i < 7; i++) {
      routes[`https://a.vn/${i}`] = { status: 302, headers: { location: `https://a.vn/${i + 1}` } };
    }
    const { svc } = service(routes);
    await expect(svc.fetch(new URL('https://a.vn/0'))).resolves.toBeNull();
  });

  it('không phải HTML/JSON thì null', async () => {
    const page = 'https://a.vn/video.mp4';
    const { svc } = service({ [page]: { headers: { 'content-type': 'video/mp4' }, body: 'x' } });
    await expect(svc.fetch(new URL(page))).resolves.toBeNull();
  });
});

describe('LinkMetadataService.assertSafe', () => {
  it('host phân giải ra IP nội bộ thì ném UnsafeUrlError', async () => {
    const { svc } = service({}, { 'evil.vn': ['93.184.216.34', '10.0.0.5'] });
    await expect(svc.assertSafe(new URL('https://evil.vn/'))).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('IP viết thẳng trong URL cũng bị kiểm tra', async () => {
    const { svc } = service({});
    await expect(svc.assertSafe(new URL('http://127.0.0.1/'))).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận lỗi**

Run: `npx vitest run src/modules/share-import/link-metadata.service.spec.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Viết `link-metadata.service.ts`**

```ts
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import { Logger } from '@nestjs/common';
import type { SharePlatform } from '@rong/shared-types';

import { detectPlatform } from './share-url.js';

export interface LinkMetadata {
  platform: SharePlatform;
  finalUrl: string;
  title: string | null;
  description: string | null;
  authorName: string | null;
  thumbnailUrl: string | null;
}

export interface LinkMetadataDeps {
  fetch: typeof fetch;
  lookup: (hostname: string) => Promise<string[]>;
  metaOembedToken: string | null;
  contactEmail: string;
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 5;
const MAX_BYTES = 1_000_000;

const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv6');
}

/** IP có định tuyến công khai không (chặn loopback, mạng nội bộ, link-local, CGNAT…). */
export function isPublicAddress(ip: string): boolean {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPublicAddress(mapped[1]);
  const family = isIP(ip);
  if (family === 4) return !PRIVATE.check(ip, 'ipv4');
  if (family === 6) return !PRIVATE.check(ip, 'ipv6');
  return false;
}

/** Thẻ Open Graph, rơi về <title> / meta description. Regex đủ cho <head>, không cần DOM. */
export function parseOpenGraph(html: string): {
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  authorName: string | null;
} {
  const meta = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = attr(tag, 'property') ?? attr(tag, 'name');
    const content = attr(tag, 'content');
    if (key && content && !meta.has(key.toLowerCase())) meta.set(key.toLowerCase(), content);
  }
  const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = meta.get(key);
      if (value?.trim()) return decodeEntities(value.trim());
    }
    return null;
  };
  return {
    title: pick('og:title', 'twitter:title') ?? (titleTag?.trim() ? decodeEntities(titleTag.trim()) : null),
    description: pick('og:description', 'twitter:description', 'description'),
    thumbnailUrl: pick('og:image', 'twitter:image'),
    authorName: pick('author', 'article:author'),
  };
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? (match[1] ?? match[2] ?? null) : null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Cổng duy nhất đọc link người dùng chia sẻ (F4, FR-4.2). Chỉ metadata công
 * khai: oEmbed khi nền tảng có, còn lại Open Graph. Mọi host (kể cả sau mỗi
 * redirect) phải phân giải ra IP công khai.
 *
 * Giới hạn đã biết: kiểm tra DNS rồi mới fetch nên còn khe DNS rebinding rất
 * hẹp; chấp nhận được vì chỉ đọc <head> và không trả nội dung thô cho client.
 */
export class LinkMetadataService {
  private readonly logger = new Logger(LinkMetadataService.name);

  constructor(private readonly deps: LinkMetadataDeps) {}

  async assertSafe(url: URL): Promise<void> {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [host] : await this.deps.lookup(host).catch(() => []);
    if (addresses.length === 0 || addresses.some((ip) => !isPublicAddress(ip))) {
      throw new UnsafeUrlError(`Host ${host} không phải địa chỉ công khai`);
    }
  }

  async fetch(url: URL): Promise<LinkMetadata | null> {
    try {
      const resolved = await this.resolveRedirects(url);
      if (!resolved) return null;
      const platform = detectPlatform(resolved.url);
      const oembed = await this.oembed(platform, resolved.url);
      if (oembed) return oembed;
      const html = resolved.html ?? (await this.get(resolved.url))?.html;
      if (!html) return null;
      const og = parseOpenGraph(html);
      if (!og.title && !og.description) return null;
      return { platform, finalUrl: resolved.url.toString(), ...og };
    } catch (error) {
      if (error instanceof UnsafeUrlError) throw error;
      this.logger.warn(`Không đọc được metadata ${url.hostname}: ${(error as Error).message}`);
      return null;
    }
  }

  /** Theo redirect tới trang cuối; trả HTML nếu trang cuối là HTML. */
  private async resolveRedirects(start: URL): Promise<{ url: URL; html: string | null } | null> {
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await this.assertSafe(url);
      const response = await this.deps.fetch(url.toString(), {
        redirect: 'manual',
        headers: this.headers('text/html'),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return null;
        url = new URL(location, url);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        continue;
      }
      // oEmbed vẫn chạy được dù trang chặn (403 với bot), nên vẫn trả URL.
      if (!response.ok) return { url, html: null };
      const type = response.headers.get('content-type') ?? '';
      if (!type.includes('html')) {
        await response.body?.cancel().catch(() => undefined);
        return type.includes('json') ? { url, html: null } : null;
      }
      return { url, html: await readLimited(response) };
    }
    return null;
  }

  private async get(url: URL): Promise<{ html: string } | null> {
    const resolved = await this.resolveRedirects(url);
    return resolved?.html ? { html: resolved.html } : null;
  }

  private async oembed(platform: SharePlatform, page: URL): Promise<LinkMetadata | null> {
    const endpoint = this.oembedEndpoint(platform, page);
    if (!endpoint) return null;
    try {
      const response = await this.deps.fetch(endpoint, {
        headers: this.headers('application/json'),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as {
        title?: string;
        author_name?: string;
        thumbnail_url?: string;
      };
      if (!body.title && !body.author_name) return null;
      return {
        platform,
        finalUrl: page.toString(),
        title: body.title?.trim() || null,
        description: null,
        authorName: body.author_name?.trim() || null,
        thumbnailUrl: body.thumbnail_url || null,
      };
    } catch {
      return null;
    }
  }

  private oembedEndpoint(platform: SharePlatform, page: URL): string | null {
    const target = encodeURIComponent(page.toString());
    switch (platform) {
      case 'tiktok':
        return `https://www.tiktok.com/oembed?url=${target}`;
      case 'youtube':
        return `https://www.youtube.com/oembed?format=json&url=${target}`;
      case 'facebook':
      case 'instagram': {
        const token = this.deps.metaOembedToken;
        if (!token) return null;
        const kind = platform === 'facebook' ? 'oembed_post' : 'instagram_oembed';
        return `https://graph.facebook.com/v21.0/${kind}?url=${target}&omitscript=true&access_token=${encodeURIComponent(token)}`;
      }
      default:
        return null;
    }
  }

  private headers(accept: string): Record<string, string> {
    return {
      'User-Agent': `Mozilla/5.0 (compatible; RongBot/1.0; +mailto:${this.deps.contactEmail})`,
      Accept: accept,
      'Accept-Language': 'vi,en;q=0.8',
    };
  }
}

/** Đọc tối đa MAX_BYTES; trang lớn hơn chỉ lấy phần đầu (đủ cho <head>). */
async function readLimited(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = '';
  let bytes = 0;
  try {
    while (bytes < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      html += decoder.decode(value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  return html;
}

export function createLinkMetadataService(config: {
  metaOembedToken: string | null;
  contactEmail: string;
}): LinkMetadataService {
  return new LinkMetadataService({
    fetch,
    lookup: async (host) => (await dnsLookup(host, { all: true })).map((a) => a.address),
    ...config,
  });
}
```

- [ ] **Step 4: Chạy test**

Run: `npx vitest run src/modules/share-import/link-metadata.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/share-import/link-metadata.service.ts apps/backend/src/modules/share-import/link-metadata.service.spec.ts
git commit -m "feat(backend): fetch shared link metadata with SSRF guard"
```

---

### Task 6: `place-extraction.ts` — Gemini trích tên địa điểm + grounding

**Files:**
- Create: `apps/backend/src/modules/share-import/place-extraction.ts`
- Test: `apps/backend/src/modules/share-import/place-extraction.spec.ts`

**Interfaces:**
- Consumes: `LinkMetadata` (Task 5), `articlesMentioning` (`modules/places/web-grounding.ts`), `createGeminiModel` (`src/chat-models/gemini-model.factory.ts`).
- Produces:

```ts
export const MAX_EXTRACTED = 15;
export const ExtractedPlacesSchema: z.ZodObject<...>;   // { places: Array<{ name, category, regionHint, address, quote }> }
export type ExtractFn = (system: string, request: string) => Promise<z.infer<typeof ExtractedPlacesSchema>>;
export interface ExtractedPlace {
  name: string;
  category: PlaceCategory;
  regionHint: string | null;
  address: string | null;
  quote: string;
}
export const EXTRACTION_PROMPT: string;
export function buildExtractionInput(meta: LinkMetadata | null, sharedText: string | null): string;
export function extractPlaces(input: string, extract: ExtractFn): Promise<ExtractedPlace[]>;
export const PLACE_EXTRACTOR = 'PLACE_EXTRACTOR';
export function createPlaceExtractor(): ExtractFn;   // Gemini thật, thinkingLevel LOW
```

- [ ] **Step 1: Viết test**

```ts
import { describe, expect, it, vi } from 'vitest';

import {
  buildExtractionInput,
  extractPlaces,
  type ExtractFn,
} from './place-extraction.js';

const fake = (places: Array<Record<string, string>>): ExtractFn =>
  vi.fn(async () => ({
    places: places.map((p) => ({
      category: 'food',
      regionHint: '',
      address: '',
      quote: '',
      ...p,
    })),
  })) as unknown as ExtractFn;

describe('buildExtractionInput', () => {
  it('gộp tiêu đề, tác giả, mô tả và văn bản người dùng; bỏ phần trống', () => {
    const input = buildExtractionInput(
      {
        platform: 'tiktok',
        finalUrl: 'https://www.tiktok.com/@a/video/1',
        title: 'Bánh căn Nhà Chung',
        description: null,
        authorName: 'an.reviews',
        thumbnailUrl: null,
      },
      'Ghé Đà Lạt nhớ ăn',
    );
    expect(input).toContain('Tiêu đề: Bánh căn Nhà Chung');
    expect(input).toContain('Tác giả: an.reviews');
    expect(input).toContain('Người dùng viết: Ghé Đà Lạt nhớ ăn');
    expect(input).not.toContain('Mô tả:');
  });
});

describe('extractPlaces', () => {
  const input = 'Top quán Đà Lạt: Bánh căn Nhà Chung, Cà phê Túi Mơ To, và lẩu gà lá é Tao Ngộ.';

  it('chỉ giữ tên có trong nội dung (loại tên AI tự thêm)', async () => {
    const result = await extractPlaces(
      input,
      fake([
        { name: 'Bánh căn Nhà Chung', regionHint: 'Đà Lạt' },
        { name: 'Cà phê Túi Mơ To', category: 'cafe' },
        { name: 'Hồ Xuân Hương' }, // không có trong bài
      ]),
    );
    expect(result.map((p) => p.name)).toEqual(['Bánh căn Nhà Chung', 'Cà phê Túi Mơ To']);
    expect(result[0].regionHint).toBe('Đà Lạt');
    expect(result[1].regionHint).toBeNull();
  });

  it('khớp không dấu và gộp trùng', async () => {
    const result = await extractPlaces(
      input,
      fake([{ name: 'banh can nha chung' }, { name: 'Bánh Căn Nhà Chung' }]),
    );
    expect(result).toHaveLength(1);
  });

  it('chuỗi rỗng → null, quote cắt ở 200 ký tự, tối đa 15 mục', async () => {
    const many = Array.from({ length: 20 }, (_, i) => `Quán Số ${i + 10}`);
    const text = many.join(', ');
    const result = await extractPlaces(
      text,
      fake(many.map((name) => ({ name, address: '', quote: 'x'.repeat(300) }))),
    );
    expect(result).toHaveLength(15);
    expect(result[0].address).toBeNull();
    expect(result[0].quote).toHaveLength(200);
  });

  it('nội dung rỗng thì không gọi Gemini', async () => {
    const extract = fake([]);
    await expect(extractPlaces('   ', extract)).resolves.toEqual([]);
    expect(extract).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận lỗi**

Run: `npx vitest run src/modules/share-import/place-extraction.spec.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Viết `place-extraction.ts`**

```ts
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { PlaceCategory } from '@rong/shared-types';
import * as z from 'zod';

import { createGeminiModel } from '../../chat-models/gemini-model.factory.js';
import { articlesMentioning, normalizeForMatch } from '../places/web-grounding.js';
import type { LinkMetadata } from './link-metadata.service.js';

export const MAX_EXTRACTED = 15;
const MAX_QUOTE = 200;

export const PLACE_EXTRACTOR = 'PLACE_EXTRACTOR';

/** strict structured output không cho null: chuỗi rỗng nghĩa là không có. */
export const ExtractedPlacesSchema = z.object({
  places: z
    .array(
      z.object({
        name: z.string().describe('Tên riêng của địa điểm, viết đúng như trong nội dung'),
        category: z
          .enum(['check_in', 'food', 'cafe', 'nature', 'kids', 'culture', 'nightlife', 'stay'])
          .describe(
            'check_in = điểm check-in/ngắm cảnh, food = ăn uống, cafe = cà phê, nature = thiên nhiên, kids = vui chơi cho trẻ em, culture = văn hóa - lịch sử, nightlife = về đêm, stay = lưu trú',
          ),
        regionHint: z
          .string()
          .describe('Tỉnh/thành phố/điểm đến nội dung nói địa điểm nằm ở; chuỗi rỗng nếu không nói'),
        address: z.string().describe('Địa chỉ đúng như nội dung ghi; chuỗi rỗng nếu không có'),
        quote: z.string().describe('Câu ngắn trong nội dung có nhắc tới địa điểm'),
      }),
    )
    .describe('Các địa điểm cụ thể được nhắc tới'),
});

export type ExtractFn = (
  system: string,
  request: string,
) => Promise<z.infer<typeof ExtractedPlacesSchema>>;

export interface ExtractedPlace {
  name: string;
  category: PlaceCategory;
  regionHint: string | null;
  address: string | null;
  quote: string;
}

export const EXTRACTION_PROMPT = `Bạn đọc nội dung một video hoặc bài viết về du lịch Việt Nam mà người dùng vừa chia sẻ, và liệt kê các địa điểm cụ thể (có tên riêng) được nhắc tới: quán ăn, quán cà phê, điểm tham quan, check-in, chợ, chùa, thác, khu vui chơi…
Quy tắc:
- CHỈ dùng tên xuất hiện trong nội dung. Không thêm từ hiểu biết riêng — hệ thống đối chiếu từng tên với nội dung và loại tên không có.
- Không liệt kê tên tỉnh, thành phố, quận, phường đứng riêng (ví dụ "Đà Lạt") như một địa điểm.
- Tối đa ${MAX_EXTRACTED} địa điểm, theo thứ tự xuất hiện.
- Không có địa điểm nào thì trả mảng rỗng.`;

/** Ghép các phần metadata và lời người dùng thành một văn bản để model đọc. */
export function buildExtractionInput(
  meta: LinkMetadata | null,
  sharedText: string | null,
): string {
  const parts: Array<[string, string | null | undefined]> = [
    ['Tiêu đề', meta?.title],
    ['Tác giả', meta?.authorName],
    ['Mô tả', meta?.description],
    ['Người dùng viết', sharedText],
  ];
  return parts
    .filter(([, value]) => value?.trim())
    .map(([label, value]) => `${label}: ${value!.trim()}`)
    .join('\n');
}

/**
 * Một lượt Gemini, rồi chỉ giữ tên thực sự có trong nội dung (FR-4.3), gộp
 * trùng theo tên đã bỏ dấu, tối đa MAX_EXTRACTED.
 */
export async function extractPlaces(
  input: string,
  extract: ExtractFn,
): Promise<ExtractedPlace[]> {
  if (!input.trim()) return [];
  const { places } = await extract(EXTRACTION_PROMPT, `Nội dung:\n${input}`);
  const source = [{ title: '', uri: '', content: input, publishedAt: null }];
  const seen = new Set<string>();
  const result: ExtractedPlace[] = [];
  for (const place of places) {
    const name = place.name.trim();
    const key = normalizeForMatch(name);
    if (!key || seen.has(key)) continue;
    if (articlesMentioning(name, place.regionHint, source).length === 0) continue;
    seen.add(key);
    result.push({
      name,
      category: place.category,
      regionHint: place.regionHint.trim() || null,
      address: place.address.trim() || null,
      quote: place.quote.trim().slice(0, MAX_QUOTE),
    });
    if (result.length === MAX_EXTRACTED) break;
  }
  return result;
}

export function createPlaceExtractor(): ExtractFn {
  const model = createGeminiModel({
    thinkingConfig: { thinkingLevel: 'LOW' },
  }).withStructuredOutput(ExtractedPlacesSchema, { strict: true });
  return (system, request) =>
    model.invoke([new SystemMessage(system), new HumanMessage(request)]);
}
```

Nếu `thinkingConfig: { thinkingLevel: 'LOW' }` báo lỗi kiểu, viết `'LOW' as const` như `place-search.service.ts`.

- [ ] **Step 4: Chạy test**

Run: `npx vitest run src/modules/share-import/place-extraction.spec.ts`
Expected: PASS. (Test "Quán Số 10..29": `nameVariants` lọc tên dưới 4 ký tự; "quan so 10" dài hơn 4 nên giữ.)

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/share-import/place-extraction.ts apps/backend/src/modules/share-import/place-extraction.spec.ts
git commit -m "feat(backend): extract grounded place names from shared content"
```

---

### Task 7: Google — `searchText`, `locate`, `summary`

**Files:**
- Modify: `apps/backend/src/modules/google/google-places.service.ts`
- Test: `apps/backend/src/modules/google/google-places.service.spec.ts`

**Interfaces:**
- Consumes: `Bbox` (`modules/regions/bbox.ts`, `[south, west, north, east]`).
- Produces:

```ts
export type GoogleHit = { placeId: string; lat: number; lng: number };
searchText(query: string, bbox: Bbox | null, max?: number): Promise<GoogleHit[]>;   // fieldMask places.id,places.location
locate(placeId: string): Promise<{ lat: number; lng: number } | null>;             // 404 → null
summary(placeId: string): Promise<{ name: string | null; address: string | null } | null>; // 404 → null
```
Cả ba ném `GoogleUnavailableError` khi chưa cấu hình khóa hoặc lỗi mạng (qua `request()` có sẵn).

- [ ] **Step 1: Viết test (thêm vào spec hiện có, dùng `service()`, `mockFetch`, `header` đã có)**

```ts
describe('GooglePlacesService.searchText', () => {
  it('chỉ xin id + location, ưu tiên khung vùng, tối đa 3', async () => {
    const calls = mockFetch(() => ({
      body: {
        places: [
          { id: 'A', location: { latitude: 11.94, longitude: 108.44 } },
          { id: 'B', location: { latitude: 11.95, longitude: 108.45 } },
        ],
      },
    }));
    await expect(
      service().searchText('Bánh căn Nhà Chung, Đà Lạt', [11.8, 108.3, 12.0, 108.6]),
    ).resolves.toEqual([
      { placeId: 'A', lat: 11.94, lng: 108.44 },
      { placeId: 'B', lat: 11.95, lng: 108.45 },
    ]);
    const [call] = calls;
    expect(call.url).toBe(`${BASE}/places:searchText`);
    expect(header(call, 'X-Goog-FieldMask')).toBe('places.id,places.location');
    const body = JSON.parse(call.init.body as string);
    expect(body).toMatchObject({ textQuery: 'Bánh căn Nhà Chung, Đà Lạt', regionCode: 'VN', pageSize: 3 });
    expect(body.locationBias.rectangle).toEqual({
      low: { latitude: 11.8, longitude: 108.3 },
      high: { latitude: 12.0, longitude: 108.6 },
    });
  });

  it('không có khung thì không gửi locationBias; bỏ kết quả thiếu tọa độ', async () => {
    const calls = mockFetch(() => ({ body: { places: [{ id: 'A' }] } }));
    await expect(service().searchText('x', null)).resolves.toEqual([]);
    expect(JSON.parse(calls[0].init.body as string).locationBias).toBeUndefined();
  });
});

describe('GooglePlacesService.locate / summary', () => {
  it('locate chỉ xin location', async () => {
    const calls = mockFetch(() => ({ body: { location: { latitude: 1, longitude: 2 } } }));
    await expect(service().locate('ChIJ1')).resolves.toEqual({ lat: 1, lng: 2 });
    expect(calls[0].url).toBe(`${BASE}/places/ChIJ1`);
    expect(header(calls[0], 'X-Goog-FieldMask')).toBe('location');
  });

  it('summary xin displayName + formattedAddress; 404 → null', async () => {
    const calls = mockFetch((url) =>
      url.endsWith('/gone')
        ? { status: 404, body: {} }
        : { body: { displayName: { text: 'Bánh căn Nhà Chung' }, formattedAddress: '1 Nhà Chung' } },
    );
    await expect(service().summary('ChIJ1')).resolves.toEqual({
      name: 'Bánh căn Nhà Chung',
      address: '1 Nhà Chung',
    });
    expect(header(calls[0], 'X-Goog-FieldMask')).toBe('displayName,formattedAddress');
    await expect(service().summary('gone')).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận lỗi**

Run: `npx vitest run src/modules/google/google-places.service.spec.ts`
Expected: FAIL — `searchText is not a function`.

- [ ] **Step 3: Thêm ba method vào `GooglePlacesService`**

Thêm `import type { Bbox } from '../regions/bbox.js';` và `export type GoogleHit = { placeId: string; lat: number; lng: number };` (đổi `type GeocodeHit` hiện có thành alias `type GeocodeHit = GoogleHit;`). Sửa comment class: "không lưu gì ngoài place_id (PlacesService, ShareImports lưu) và tọa độ tối đa 30 ngày (Geocoding trong bộ nhớ; dòng `places` nguồn Google có `location_expires_at`)". Thêm method:

```ts
  /**
   * Tìm địa điểm theo tên cho share-to-app (F4): chỉ id + tọa độ (tọa độ được
   * cache tối đa 30 ngày, PRD 7.4). Không xin tên hay loại Google.
   */
  async searchText(query: string, bbox: Bbox | null, max = 3): Promise<GoogleHit[]> {
    const body = await this.request<{
      places?: Array<{ id: string; location?: { latitude: number; longitude: number } }>;
    }>('/places:searchText', {
      method: 'POST',
      fieldMask: 'places.id,places.location',
      body: {
        textQuery: query,
        languageCode: 'vi',
        regionCode: 'VN',
        pageSize: max,
        ...(bbox && {
          locationBias: {
            rectangle: {
              low: { latitude: bbox[0], longitude: bbox[1] },
              high: { latitude: bbox[2], longitude: bbox[3] },
            },
          },
        }),
      },
    });
    return (body.places ?? []).flatMap((p) =>
      p.location ? [{ placeId: p.id, lat: p.location.latitude, lng: p.location.longitude }] : [],
    );
  }

  /** Tọa độ hiện tại của một place_id, để làm mới tọa độ đã quá 30 ngày. */
  async locate(placeId: string): Promise<{ lat: number; lng: number } | null> {
    try {
      const place = await this.request<{ location?: { latitude: number; longitude: number } }>(
        `/places/${encodeURIComponent(placeId)}`,
        { method: 'GET', fieldMask: 'location' },
      );
      return place.location ? { lat: place.location.latitude, lng: place.location.longitude } : null;
    } catch (error) {
      if (error instanceof GoogleNotFoundError) return null;
      throw error;
    }
  }

  /** Tên + địa chỉ Google để người dùng phân biệt các lựa chọn. Chỉ hiển thị, không lưu. */
  async summary(placeId: string): Promise<{ name: string | null; address: string | null } | null> {
    try {
      const place = await this.request<{ displayName?: { text?: string }; formattedAddress?: string }>(
        `/places/${encodeURIComponent(placeId)}?languageCode=vi&regionCode=VN`,
        { method: 'GET', fieldMask: 'displayName,formattedAddress' },
      );
      return { name: place.displayName?.text ?? null, address: place.formattedAddress ?? null };
    } catch (error) {
      if (error instanceof GoogleNotFoundError) return null;
      throw error;
    }
  }
```

Test `summary` kỳ vọng URL `${BASE}/places/ChIJ1` ở `locate`; `summary` có query string — kiểm tra bằng `toContain` nếu cần. `GoogleNotFoundError` được khai báo sau class trong file; class declaration không bị hoist trong TDZ nhưng chỉ được dùng lúc chạy method nên không lỗi.

- [ ] **Step 4: Chạy test**

Run: `npx vitest run src/modules/google`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/google
git commit -m "feat(backend): add Google text search, locate and summary lookups"
```

---

### Task 8: `RegionLookupService` và `place-resolver.ts`

**Files:**
- Create: `apps/backend/src/modules/share-import/region-lookup.service.ts`
- Create: `apps/backend/src/modules/share-import/place-resolver.ts`
- Test: `apps/backend/src/modules/share-import/place-resolver.spec.ts`
- Test: `apps/backend/test/share-imports.e2e-spec.ts` (phần `RegionLookupService`, tạo file ở đây)

**Interfaces:**
- Consumes: `searchKey` (`modules/regions/search-text.ts`), `matchCatalog`, `CATALOG_MIN_SIMILARITY` (Task 2), `GoogleHit` (Task 7), `ExtractedPlace` (Task 6).
- Produces:

```ts
// region-lookup.service.ts
export interface RegionRef { id: string; name: string; bbox: Bbox }
@Injectable() export class RegionLookupService {
  findByHint(hint: string): Promise<RegionRef | null>;
  /** Vùng (điểm đến hoặc tỉnh, ranh giới hiện hành, đã có bbox) có bbox nhỏ nhất chứa điểm; null nếu không có. */
  assign(points: Array<{ lat: number; lng: number }>): Promise<Array<string | null>>;
  names(ids: string[]): Promise<Map<string, string>>;   // "Tên, Tỉnh"
}

// place-resolver.ts
export type StoredOption =
  | { kind: 'catalog'; placeId: string; regionId: string }
  | { kind: 'google'; googlePlaceId: string; lat: number; lng: number; regionId: string };
export interface StoredCandidate {
  key: string;
  name: string;
  category: PlaceCategory;
  quote: string;
  confidence: 'high' | 'low' | 'none';
  options: StoredOption[];
}
export interface ResolverDeps {
  findRegion(hint: string): Promise<RegionRef | null>;
  matchCatalog(name: string, bbox: Bbox | null): Promise<{ placeId: string; lat: number; lng: number } | null>;
  searchGoogle(query: string, bbox: Bbox | null): Promise<GoogleHit[]>;   // ném lỗi khi Google không dùng được
  assignRegions(points: Array<{ lat: number; lng: number }>): Promise<Array<string | null>>;
}
export function resolvePlaces(places: ExtractedPlace[], deps: ResolverDeps): Promise<StoredCandidate[]>;
export function insideBbox(point: { lat: number; lng: number }, bbox: Bbox): boolean;
```

- [ ] **Step 1: Viết unit test cho resolver**

```ts
import { describe, expect, it, vi } from 'vitest';

import type { RegionRef } from './region-lookup.service.js';
import { resolvePlaces, type ResolverDeps } from './place-resolver.js';

const DA_LAT: RegionRef = { id: 'r-dalat', name: 'Đà Lạt', bbox: [11.8, 108.3, 12.1, 108.6] };
const place = (name: string, regionHint: string | null = 'Đà Lạt') => ({
  name,
  category: 'food' as const,
  regionHint,
  address: null,
  quote: `nhắc ${name}`,
});

function deps(over: Partial<ResolverDeps> = {}): ResolverDeps {
  return {
    findRegion: vi.fn(async (hint: string) => (hint === 'Đà Lạt' ? DA_LAT : null)),
    matchCatalog: vi.fn(async () => null),
    searchGoogle: vi.fn(async () => []),
    assignRegions: vi.fn(async (points) => points.map(() => 'r-dalat')),
    ...over,
  };
}

describe('resolvePlaces', () => {
  it('khớp danh mục → high, một lựa chọn catalog; không gọi Google', async () => {
    const d = deps({ matchCatalog: vi.fn(async () => ({ placeId: 'p1', lat: 11.94, lng: 108.44 })) });
    const [c] = await resolvePlaces([place('Bánh căn Nhà Chung')], d);
    expect(c).toMatchObject({
      key: 'c1',
      confidence: 'high',
      options: [{ kind: 'catalog', placeId: 'p1', regionId: 'r-dalat' }],
    });
    expect(d.matchCatalog).toHaveBeenCalledWith('Bánh căn Nhà Chung', DA_LAT.bbox);
    expect(d.searchGoogle).not.toHaveBeenCalled();
  });

  it('Google: kết quả đầu trong vùng gợi ý → high, chỉ giữ kết quả đầu', async () => {
    const d = deps({
      searchGoogle: vi.fn(async () => [
        { placeId: 'g1', lat: 11.94, lng: 108.44 },
        { placeId: 'g2', lat: 11.95, lng: 108.45 },
      ]),
    });
    const [c] = await resolvePlaces([place('Quán Mới')], d);
    expect(c.confidence).toBe('high');
    expect(c.options).toEqual([
      { kind: 'google', googlePlaceId: 'g1', lat: 11.94, lng: 108.44, regionId: 'r-dalat' },
    ]);
    expect(d.searchGoogle).toHaveBeenCalledWith('Quán Mới, Đà Lạt', DA_LAT.bbox);
  });

  it('Google: không có vùng gợi ý hoặc kết quả ngoài vùng → low, tối đa 3', async () => {
    const d = deps({
      searchGoogle: vi.fn(async () => [
        { placeId: 'g1', lat: 10.7, lng: 106.7 },
        { placeId: 'g2', lat: 21.0, lng: 105.8 },
        { placeId: 'g3', lat: 16.0, lng: 108.2 },
        { placeId: 'g4', lat: 12.2, lng: 109.1 },
      ]),
    });
    const [c] = await resolvePlaces([place('Quán Mới', null)], d);
    expect(c.confidence).toBe('low');
    expect(c.options.map((o) => (o.kind === 'google' ? o.googlePlaceId : ''))).toEqual(['g1', 'g2', 'g3']);
  });

  it('lựa chọn không thuộc vùng nào bị bỏ', async () => {
    const d = deps({
      searchGoogle: vi.fn(async () => [{ placeId: 'g1', lat: 11.94, lng: 108.44 }]),
      assignRegions: vi.fn(async () => [null]),
    });
    const [c] = await resolvePlaces([place('Quán Mới')], d);
    expect(c).toMatchObject({ confidence: 'none', options: [] });
  });

  it('Google lỗi → chỉ dùng danh mục, không ném lỗi', async () => {
    const d = deps({ searchGoogle: vi.fn(async () => { throw new Error('quota'); }) });
    const [c] = await resolvePlaces([place('Quán Mới')], d);
    expect(c).toMatchObject({ confidence: 'none', options: [] });
  });

  it('không có vùng gợi ý thì khớp danh mục toàn quốc với ngưỡng chặt hơn', async () => {
    const d = deps();
    await resolvePlaces([place('Chợ Bến Thành', null)], d);
    expect(d.matchCatalog).toHaveBeenCalledWith('Chợ Bến Thành', null);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận lỗi**

Run: `npx vitest run src/modules/share-import/place-resolver.spec.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Viết `region-lookup.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import type { Bbox } from '../regions/bbox.js';
import { searchKey } from '../regions/search-text.js';

export interface RegionRef {
  id: string;
  name: string;
  bbox: Bbox;
}

/** Chỉ điểm đến và tỉnh theo ranh giới hiện hành: "Muốn đi" nhóm theo nơi người dùng sẽ đi, không theo phường. */
const ELIGIBLE = `r.boundary_version = 'current'
  AND (r.type = 'destination' OR r.level = 'province')
  AND r.bbox_south IS NOT NULL`;

@Injectable()
export class RegionLookupService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** Vùng khớp tên AI đọc được (không gọi Nominatim). */
  async findByHint(hint: string): Promise<RegionRef | null> {
    const key = searchKey(hint);
    if (!key) return null;
    const [row] = (await this.db.query(
      `SELECT r.id, r.name, r.bbox_south, r.bbox_west, r.bbox_north, r.bbox_east
         FROM regions r
        WHERE ${ELIGIBLE}
          AND (r.search_name = $1 OR r.search_name % $1
               OR EXISTS (SELECT 1 FROM region_aliases a WHERE a.region_id = r.id AND a.search_alias = $1))
        ORDER BY (r.search_name = $1) DESC, similarity(r.search_name, $1) DESC,
                 (r.type = 'destination') DESC
        LIMIT 1`,
      [key],
    )) as Array<{
      id: string;
      name: string;
      bbox_south: number;
      bbox_west: number;
      bbox_north: number;
      bbox_east: number;
    }>;
    return row
      ? {
          id: row.id,
          name: row.name,
          bbox: [row.bbox_south, row.bbox_west, row.bbox_north, row.bbox_east],
        }
      : null;
  }

  async assign(points: Array<{ lat: number; lng: number }>): Promise<Array<string | null>> {
    if (points.length === 0) return [];
    const rows = (await this.db.query(
      `SELECT n.idx, m.id
         FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS n(lat, lng, idx)
         LEFT JOIN LATERAL (
           SELECT r.id FROM regions r
            WHERE ${ELIGIBLE}
              AND n.lat BETWEEN r.bbox_south AND r.bbox_north
              AND n.lng BETWEEN r.bbox_west AND r.bbox_east
            ORDER BY (r.bbox_north - r.bbox_south) * (r.bbox_east - r.bbox_west)
            LIMIT 1
         ) m ON true
        ORDER BY n.idx`,
      [points.map((p) => p.lat), points.map((p) => p.lng)],
    )) as Array<{ idx: string; id: string | null }>;
    return rows.map((row) => row.id);
  }

  async names(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = (await this.db.query(
      `SELECT r.id, r.name, p.name AS parent_name
         FROM regions r LEFT JOIN regions p ON p.id = r.parent_id
        WHERE r.id = ANY($1::uuid[])`,
      [ids],
    )) as Array<{ id: string; name: string; parent_name: string | null }>;
    return new Map(rows.map((r) => [r.id, r.parent_name ? `${r.name}, ${r.parent_name}` : r.name]));
  }
}
```

Trước khi chạy, kiểm tra tên cột bbox bằng `grep -n "bbox_" src/database/migrations/1758500000000-ReplaceBoundaryWithBbox.ts` (đã thấy: `bbox_south/west/north/east`).

- [ ] **Step 4: Viết `place-resolver.ts`**

```ts
import type { PlaceCategory } from '@rong/shared-types';

import type { GoogleHit } from '../google/google-places.service.js';
import type { Bbox } from '../regions/bbox.js';
import type { ExtractedPlace } from './place-extraction.js';
import type { RegionRef } from './region-lookup.service.js';

export type StoredOption =
  | { kind: 'catalog'; placeId: string; regionId: string }
  | { kind: 'google'; googlePlaceId: string; lat: number; lng: number; regionId: string };

export interface StoredCandidate {
  key: string;
  name: string;
  category: PlaceCategory;
  quote: string;
  confidence: 'high' | 'low' | 'none';
  options: StoredOption[];
}

export interface ResolverDeps {
  findRegion(hint: string): Promise<RegionRef | null>;
  matchCatalog(name: string, bbox: Bbox | null): Promise<{ placeId: string; lat: number; lng: number } | null>;
  searchGoogle(query: string, bbox: Bbox | null): Promise<GoogleHit[]>;
  assignRegions(points: Array<{ lat: number; lng: number }>): Promise<Array<string | null>>;
}

const MAX_GOOGLE_OPTIONS = 3;

export function insideBbox({ lat, lng }: { lat: number; lng: number }, bbox: Bbox): boolean {
  return lat >= bbox[0] && lat <= bbox[2] && lng >= bbox[1] && lng <= bbox[3];
}

type Draft = Omit<StoredCandidate, 'options'> & {
  options: Array<{ option: Omit<StoredOption, 'regionId'>; lat: number; lng: number }>;
};

/**
 * Mỗi tên: khớp danh mục OSM (trong vùng gợi ý, hoặc toàn quốc), không được
 * thì Google Text Search. Google hỏng thì chỉ còn danh mục (FR-4.3). Lựa
 * chọn nào không thuộc vùng nào thì bỏ, vì "Muốn đi" cần vùng.
 */
export async function resolvePlaces(
  places: ExtractedPlace[],
  deps: ResolverDeps,
): Promise<StoredCandidate[]> {
  const drafts = await Promise.all(
    places.map(async (place, i): Promise<Draft> => {
      const base = {
        key: `c${i + 1}`,
        name: place.name,
        category: place.category,
        quote: place.quote,
      };
      const region = place.regionHint ? await deps.findRegion(place.regionHint) : null;
      const bbox = region?.bbox ?? null;

      const match = await deps.matchCatalog(place.name, bbox);
      if (match) {
        return {
          ...base,
          confidence: 'high',
          options: [{ option: { kind: 'catalog', placeId: match.placeId }, lat: match.lat, lng: match.lng }],
        };
      }

      let hits: GoogleHit[] = [];
      try {
        const query = [place.name, place.address, region?.name ?? place.regionHint]
          .filter(Boolean)
          .join(', ');
        hits = await deps.searchGoogle(query, bbox);
      } catch {
        hits = [];
      }
      const toOption = (hit: GoogleHit) => ({
        option: { kind: 'google' as const, googlePlaceId: hit.placeId, lat: hit.lat, lng: hit.lng },
        lat: hit.lat,
        lng: hit.lng,
      });
      if (hits.length > 0 && bbox && insideBbox(hits[0], bbox)) {
        return { ...base, confidence: 'high', options: [toOption(hits[0])] };
      }
      return {
        ...base,
        confidence: hits.length > 0 ? 'low' : 'none',
        options: hits.slice(0, MAX_GOOGLE_OPTIONS).map(toOption),
      };
    }),
  );

  const points = drafts.flatMap((d) => d.options.map(({ lat, lng }) => ({ lat, lng })));
  const regionIds = await deps.assignRegions(points);
  let cursor = 0;
  return drafts.map((draft) => {
    const options: StoredOption[] = [];
    for (const { option } of draft.options) {
      const regionId = regionIds[cursor++];
      if (regionId) options.push({ ...option, regionId } as StoredOption);
    }
    const confidence = options.length === 0 ? 'none' : draft.confidence;
    return { ...draft, confidence, options };
  });
}
```

- [ ] **Step 5: Chạy unit test**

Run: `npx vitest run src/modules/share-import/place-resolver.spec.ts`
Expected: PASS.

- [ ] **Step 6: Test e2e cho `RegionLookupService`**

Tạo `apps/backend/test/share-imports.e2e-spec.ts` với `beforeAll` chép từ `test/saved-places.e2e-spec.ts` (AppModule, prefix `api`, ValidationPipe, user `e2e-share` + `e2e-share-other`, token). Khối này được mở rộng ở Task 10. Thêm:

```ts
  describe('RegionLookupService', () => {
    it('tìm Đà Lạt theo tên không dấu và gán tọa độ trong Đà Lạt vào Đà Lạt (bbox nhỏ hơn Lâm Đồng)', async () => {
      const regions = app.get(RegionLookupService);
      const hit = await regions.findByHint('da lat');
      expect(hit?.id).toBe(daLat);
      const [assigned, nowhere] = await regions.assign([
        { lat: 11.9404, lng: 108.4583 },
        { lat: 0, lng: 0 },
      ]);
      expect(assigned).toBe(daLat);
      expect(nowhere).toBeNull();
    });
  });
```

`RegionLookupService` chỉ lấy được qua `app.get` sau khi `ShareImportModule` đăng ký nó (Task 10). Đến lúc đó mới chạy test này; ở Task 8 chỉ chạy unit test. Nếu Đà Lạt chưa có bbox trong DB test, `beforeAll` gọi `app.get(RegionAreaService).ensure(daLat)` trước.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/modules/share-import/region-lookup.service.ts apps/backend/src/modules/share-import/place-resolver.ts apps/backend/src/modules/share-import/place-resolver.spec.ts apps/backend/test/share-imports.e2e-spec.ts
git commit -m "feat(backend): resolve extracted places against catalog and Google"
```

---

### Task 9: Tọa độ Google hết hạn — `PlaceLocationService`, janitor, chi tiết địa điểm, lịch trình

**Files:**
- Create: `apps/backend/src/modules/places/place-location.service.ts`
- Create: `apps/backend/src/modules/places/google-location-janitor.ts`
- Modify: `apps/backend/src/modules/places/places.module.ts` (provider + export)
- Modify: `apps/backend/src/modules/places/places.service.ts` (`getDetail`, `googleContent`)
- Modify: `apps/backend/src/modules/itineraries/itineraries.service.ts`, `itineraries.module.ts`
- Test: `apps/backend/test/places-source.e2e-spec.ts` (thêm)

**Interfaces:**
- Consumes: `GooglePlacesService.locate` (Task 7).
- Produces:

```ts
export const GOOGLE_LOCATION_TTL_DAYS = 30;
@Injectable() export class PlaceLocationService {
  /** Lấy lại tọa độ cho dòng Google đã hết hạn trong `ids`; trả các id vẫn không có tọa độ. */
  ensure(ids: string[]): Promise<string[]>;
}
```
`PlacesModule` export `PlaceLocationService`.

- [ ] **Step 1: Viết test e2e**

Trong `test/places-source.e2e-spec.ts`: thêm override `GooglePlacesService` bằng object giả có `enabled: true`, `locate: vi.fn()`, `details: vi.fn(async () => null)`, `matchPlaceId: vi.fn(async () => null)`. Thêm:

```ts
  describe('tọa độ Google hết hạn', () => {
    let regionId: string;
    let staleId: string;

    beforeAll(async () => {
      [{ id: regionId }] = (await db.query(
        `SELECT id FROM regions WHERE source_key = 'vn:destination:da-lat'`,
      )) as Array<{ id: string }>;
      [{ id: staleId }] = (await db.query(
        `INSERT INTO places (source, google_place_id, name, category, composite_score)
         VALUES ('google', 'e2e-src-stale', 'E2E src quán hết hạn', 'food', 0) RETURNING id`,
      )) as Array<{ id: string }>;
    });

    it('janitor xóa tọa độ quá hạn', async () => {
      await db.query(
        `UPDATE places SET location = ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326),
                location_expires_at = now() - interval '1 day' WHERE id = $1`,
        [staleId],
      );
      await app.get(GoogleLocationJanitor).sweep();
      const [row] = (await db.query(`SELECT location FROM places WHERE id = $1`, [staleId])) as Array<{
        location: unknown;
      }>;
      expect(row.location).toBeNull();
    });

    it('lập lịch trình lấy lại tọa độ qua Google rồi dùng địa điểm', async () => {
      google.locate.mockResolvedValueOnce({ lat: 11.941, lng: 108.441 });
      const res = await createItinerary([staleId]).expect(201);
      expect(google.locate).toHaveBeenCalledWith('e2e-src-stale');
      const used = res.body.days.flatMap((d: { items: Array<{ placeId: string | null }> }) =>
        d.items.map((i) => i.placeId),
      );
      expect([...used, ...res.body.unscheduled.map((u: { placeId: string }) => u.placeId)]).toContain(staleId);
      const [row] = (await db.query(
        `SELECT location_expires_at > now() + interval '29 days' AS fresh FROM places WHERE id = $1`,
        [staleId],
      )) as Array<{ fresh: boolean }>;
      expect(row.fresh).toBe(true);
    });

    it('Google không trả tọa độ: bỏ địa điểm và cảnh báo', async () => {
      await db.query(`UPDATE places SET location = NULL, location_expires_at = NULL WHERE id = $1`, [staleId]);
      google.locate.mockResolvedValueOnce(null);
      const res = await createItinerary([staleId]).expect(201);
      expect(res.body.warnings).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'place_location_unavailable' })]),
      );
    });

    it('chi tiết địa điểm Google không có tọa độ và Google lỗi → 503', async () => {
      await db.query(`UPDATE places SET location = NULL, location_expires_at = NULL WHERE id = $1`, [staleId]);
      google.locate.mockResolvedValueOnce(null);
      const res = await request(app.getHttpServer())
        .get(`/api/places/${staleId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(503);
      expect(res.body.code).toBe('PLACE_LOCATION_UNAVAILABLE');
    });

    it('chi tiết địa điểm Google: không gỡ google_place_id khi Google báo không còn', async () => {
      await db.query(
        `UPDATE places SET location = ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326),
                location_expires_at = now() + interval '30 days' WHERE id = $1`,
        [staleId],
      );
      const res = await request(app.getHttpServer())
        .get(`/api/places/${staleId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.googleStatus).toBe('not_found');
      const [row] = (await db.query(`SELECT google_place_id FROM places WHERE id = $1`, [staleId])) as Array<{
        google_place_id: string;
      }>;
      expect(row.google_place_id).toBe('e2e-src-stale');
    });
  });
```

`createItinerary(ids)` là helper gửi `POST /api/itineraries` với thân giống test Task 2 nhưng `selectedPlaceIds: ids`. Nếu việc tạo lịch trình với chỉ một địa điểm Google bị từ chối vì thiếu địa điểm, thêm `osmId` từ Task 2 vào danh sách.

- [ ] **Step 2: Chạy test, xác nhận lỗi**

Run: `npx vitest run --config vitest.config.e2e.ts test/places-source.e2e-spec.ts`
Expected: FAIL — `GoogleLocationJanitor` chưa có.

- [ ] **Step 3: Viết `place-location.service.ts`**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { GooglePlacesService, GoogleUnavailableError } from '../google/google-places.service.js';

/** Tọa độ Google được giữ tối đa chừng này ngày (PRD 7.4, ToS 3.2.3(b)). */
export const GOOGLE_LOCATION_TTL_DAYS = 30;

/**
 * Dòng `places` nguồn Google mất tọa độ sau 30 ngày. Ai cần tọa độ (lập lịch
 * trình, chi tiết) gọi `ensure` trước: lấy lại qua Google, ghi hạn mới.
 */
@Injectable()
export class PlaceLocationService {
  private readonly logger = new Logger(PlaceLocationService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly google: GooglePlacesService,
  ) {}

  async ensure(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const stale = (await this.db.query(
      `SELECT id, google_place_id FROM places
        WHERE id = ANY($1::uuid[]) AND source = 'google'
          AND (location IS NULL OR location_expires_at <= now())`,
      [ids],
    )) as Array<{ id: string; google_place_id: string }>;
    if (stale.length === 0) return [];
    if (!this.google.enabled) return stale.map((row) => row.id);

    const results = await Promise.allSettled(
      stale.map(async (row) => {
        const point = await this.google.locate(row.google_place_id);
        if (!point) return row.id;
        await this.db.query(
          `UPDATE places SET location = ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326),
                  location_expires_at = now() + make_interval(days => $4::int), updated_at = now()
            WHERE id = $1`,
          [row.id, point.lng, point.lat, GOOGLE_LOCATION_TTL_DAYS],
        );
        return null;
      }),
    );
    const missing: string[] = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        if (result.value) missing.push(result.value);
      } else {
        if (!(result.reason instanceof GoogleUnavailableError)) {
          this.logger.warn(`Làm mới tọa độ ${stale[i].id} lỗi: ${(result.reason as Error).message}`);
        }
        missing.push(stale[i].id);
      }
    });
    return missing;
  }
}
```

- [ ] **Step 4: Viết `google-location-janitor.ts`**

```ts
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

const EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_RUN_MS = 60 * 1000;

/** Xóa tọa độ Google đã quá 30 ngày khỏi `places` (PRD 7.4). Chạy kể cả khi tắt PLACES_WARMUP. */
@Injectable()
export class GoogleLocationJanitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GoogleLocationJanitor.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(@InjectDataSource() private readonly db: DataSource) {}

  onModuleInit(): void {
    const run = () =>
      void this.sweep().catch((error: Error) => this.logger.warn(`Dọn tọa độ Google lỗi: ${error.message}`));
    this.timers.push(setTimeout(run, FIRST_RUN_MS).unref(), setInterval(run, EVERY_MS).unref());
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearTimeout(timer);
  }

  async sweep(): Promise<number> {
    // Với UPDATE, DataSource.query (driver pg) trả [rows, rowCount].
    const [, count] = (await this.db.query(
      `UPDATE places SET location = NULL, location_expires_at = NULL
        WHERE source = 'google' AND location_expires_at <= now()`,
    )) as [unknown[], number];
    if (count > 0) this.logger.log(`Đã xóa tọa độ Google quá hạn của ${count} địa điểm`);
    return count;
  }
}
```

`places.module.ts`: thêm `PlaceLocationService`, `GoogleLocationJanitor` vào `providers`, và `exports: [PlaceLocationService]`.

- [ ] **Step 5: Sửa `getDetail` / `googleContent` cho dòng Google**

Trong `places.service.ts`:
- Inject `PlaceLocationService` (`private readonly locations: PlaceLocationService`).
- `DetailRow` thêm `source: 'osm' | 'google'`; câu SELECT thêm `p.source`.
- Đầu `getDetail`, trước SELECT:

```ts
    const missing = await this.locations.ensure([id]);
    if (missing.length > 0) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'PLACE_LOCATION_UNAVAILABLE',
        message: 'Tạm thời không tải được vị trí địa điểm này. Hãy thử lại sau.',
      });
    }
```

- `toListItem` cho dòng Google: `sourceUrl` không có OSM. Trong `getDetail`, sau khi có `content`, nếu `row.source === 'google'` thì ghi đè `sourceUrl: content?.googleMapsUri ?? \`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.name)}&query_place_id=${row.google_place_id}\``, `attribution: 'Google Maps'`.
- `googleContent`: với `row.source === 'google'`, bỏ qua nhánh ghép (`matchPlaceId`) và **không** chạy `UPDATE places SET google_place_id = NULL` (ràng buộc `chk_place_source` sẽ chặn): nếu `details` trả null thì chỉ `return { status: 'not_found', content: null }`.

- [ ] **Step 6: Lịch trình dùng `ensure`**

`itineraries.module.ts`: import `PlacesModule`.
`itineraries.service.ts`: inject `PlaceLocationService` (`private readonly locations: PlaceLocationService`).

Trong `create`, ngay trước `const selected = await this.loadPlaces(input.selectedPlaceIds, true);`:

```ts
    // Địa điểm Google người dùng tự chọn: lấy lại tọa độ nếu đã quá 30 ngày; không được thì bỏ và cảnh báo.
    const unlocated = new Set(
      await this.locations.ensure([
        ...input.selectedPlaceIds,
        ...(input.accommodationPlaceId ? [input.accommodationPlaceId] : []),
      ]),
    );
    const selectedIds = input.selectedPlaceIds.filter((pid) => !unlocated.has(pid));
```

Đổi `loadPlaces(input.selectedPlaceIds, true)` thành `loadPlaces(selectedIds, true)` và `missing` tính trên `selectedIds`. Nếu `accommodationPlaceId` nằm trong `unlocated` thì ném `bad('INVALID_ACCOMMODATION', ...)` như hiện có. Ở chỗ dựng `warnings` (quanh dòng 268), sau khi khai báo `const warnings: ItineraryWarning[] = [];`, thêm:

```ts
    if (unlocated.size > 0) {
      warnings.push({
        type: 'place_location_unavailable',
        message: `${unlocated.size} địa điểm tạm thời không lấy được vị trí nên chưa được xếp vào lịch.`,
      });
    }
```

(Nếu `warnings` được khai báo trong hàm khác, truyền `unlocated` vào hoặc dời khối này vào đúng chỗ — đọc lại `create` từ dòng 97 tới 320 trước khi sửa.)

Trong `update`, trước `const found = await this.loadPlaces(placeIds, true);`:

```ts
    if ((await this.locations.ensure(placeIds)).length > 0) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'PLACE_LOCATION_UNAVAILABLE',
        message: 'Tạm thời không lấy được vị trí của một địa điểm. Hãy thử lưu lại sau.',
      });
    }
```

(Đúng spec §5.2: ở `update` trả 503 thay vì bỏ địa điểm khỏi lịch người dùng đang sửa.)

- [ ] **Step 7: Chạy test**

Run: `npx vitest run src && npx vitest run --config vitest.config.e2e.ts test/places-source.e2e-spec.ts test/itinerary.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/modules/places apps/backend/src/modules/itineraries apps/backend/test/places-source.e2e-spec.ts
git commit -m "feat(backend): refresh expired Google coordinates for saved places"
```

---

### Task 10: Module `share-import` — service, controller, job nền, lưu vào "Muốn đi"

**Files:**
- Create: `apps/backend/src/modules/share-import/share-import.constants.ts`
- Create: `apps/backend/src/modules/share-import/dto/create-share-import.dto.ts`, `dto/save-share-import.dto.ts`
- Create: `apps/backend/src/modules/share-import/share-imports.service.ts`, `share-imports.controller.ts`, `share-import.module.ts`
- Modify: `apps/backend/src/modules/saved-places/saved-places.service.ts`, `saved-places.module.ts`
- Modify: `apps/backend/src/config/configuration.ts`, `apps/backend/.env.example`, `apps/backend/src/app.module.ts`
- Delete: `apps/backend/src/modules/share-import/.gitkeep`
- Test: `apps/backend/test/share-imports.e2e-spec.ts`, `apps/backend/test/saved-places.e2e-spec.ts` (phải vẫn qua)

**Interfaces:**
- Consumes: Task 3 types; `normalizeShareInput`, `detectPlatform` (4); `LinkMetadataService`, `createLinkMetadataService`, `UnsafeUrlError` (5); `buildExtractionInput`, `extractPlaces`, `createPlaceExtractor`, `PLACE_EXTRACTOR`, `ExtractFn` (6); `GooglePlacesService.searchText/summary` (7); `RegionLookupService`, `resolvePlaces`, `StoredCandidate` (8); `matchCatalog`, `CATALOG_MIN_SIMILARITY` (2); `GOOGLE_LOCATION_TTL_DAYS` (9).
- Produces:
  - Routes: `POST /api/share-imports` → 202 `{ id }`; `GET /api/share-imports` → `ShareImportSummary[]`; `GET /api/share-imports/:id` → `ShareImport`; `POST /api/share-imports/:id/save` → 200 `SaveShareImportResponse`.
  - `SavedPlacesService.save(userId, placeId, regionId, origin?: { source: 'manual' | 'share'; shareImportId: string | null }, runner?: Pick<DataSource, 'query'>)`.
  - `AppConfig.shareImport: { dailyLimit: number; metaOembedToken: string | null }`.

- [ ] **Step 1: Viết test e2e**

Mở rộng `test/share-imports.e2e-spec.ts` (đã tạo ở Task 8). `beforeAll` dùng override:

```ts
    const metadata = { assertSafe: vi.fn(async () => undefined), fetch: vi.fn() };
    const extract = vi.fn();
    const google = {
      enabled: true,
      searchText: vi.fn(),
      summary: vi.fn(async (id: string) => ({ name: `Google ${id}`, address: `Địa chỉ ${id}` })),
      locate: vi.fn(),
      details: vi.fn(async () => null),
      matchPlaceId: vi.fn(async () => null),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LinkMetadataService).useValue(metadata)
      .overrideProvider(PLACE_EXTRACTOR).useValue(extract)
      .overrideProvider(GooglePlacesService).useValue(google)
      .compile();
```

Tạo trong `beforeAll` một địa điểm OSM `E2E share Bánh căn Nhà Chung` (osm_id `-9400`, tọa độ 108.4384, 11.9421, `food`) trong Đà Lạt. `afterAll` xóa user `e2e-share*`, `places` có `osm_id <= -9400 AND osm_id > -9500` và `google_place_id LIKE 'e2e-share-%'`.

Helper:

```ts
  const api = (as = token) => {
    const server = app.getHttpServer();
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${as}`);
    return {
      create: (body: object) => auth(request(server).post('/api/share-imports')).send(body),
      list: () => auth(request(server).get('/api/share-imports')),
      get: (id: string) => auth(request(server).get(`/api/share-imports/${id}`)),
      save: (id: string, selections: object[]) =>
        auth(request(server).post(`/api/share-imports/${id}/save`)).send({ selections }),
    };
  };

  async function waitDone(id: string, as = token) {
    for (let i = 0; i < 50; i++) {
      const res = await api(as).get(id).expect(200);
      if (res.body.status !== 'pending') return res.body;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('job không xong');
  }
```

Các test:

```ts
  it('caption + link TikTok: nhận diện, khớp danh mục và Google, lưu vào Muốn đi', async () => {
    metadata.fetch.mockResolvedValueOnce({
      platform: 'tiktok',
      finalUrl: 'https://www.tiktok.com/@an/video/1',
      title: 'Bánh căn Nhà Chung và Cà phê Túi Mơ To ở Đà Lạt',
      description: null,
      authorName: 'an.reviews',
      thumbnailUrl: 'https://cdn/t.jpg',
    });
    extract.mockResolvedValueOnce({
      places: [
        { name: 'E2E share Bánh căn Nhà Chung', category: 'food', regionHint: 'Đà Lạt', address: '', quote: 'Bánh căn' },
        { name: 'Cà phê Túi Mơ To', category: 'cafe', regionHint: 'Đà Lạt', address: '', quote: 'Túi Mơ To' },
      ],
    });
    google.searchText.mockResolvedValueOnce([{ placeId: 'e2e-share-tuimoto', lat: 11.9555, lng: 108.4422 }]);

    const created = await api()
      .create({ text: 'E2E share Bánh căn Nhà Chung ngon 😋 https://vt.tiktok.com/ZS1/?_r=1' })
      .expect(202);
    const job = await waitDone(created.body.id);

    expect(metadata.fetch.mock.calls[0][0].toString()).toBe('https://vt.tiktok.com/ZS1/');
    expect(job).toMatchObject({
      status: 'done',
      errorCode: null,
      source: { platform: 'tiktok', title: expect.stringContaining('Bánh căn'), authorName: 'an.reviews' },
      candidateCount: 2,
      savedCount: 0,
    });
    const [bc, tuimoto] = job.candidates;
    expect(bc).toMatchObject({ confidence: 'high', options: [{ ref: { kind: 'catalog', placeId: osmPlace }, regionId: daLat }] });
    expect(tuimoto).toMatchObject({
      confidence: 'high',
      options: [{ ref: { kind: 'google', googlePlaceId: 'e2e-share-tuimoto' }, name: 'Google e2e-share-tuimoto', regionId: daLat }],
    });

    const saved = await api()
      .save(created.body.id, [
        { candidateKey: bc.key, kind: 'catalog', placeId: osmPlace },
        { candidateKey: tuimoto.key, kind: 'google', googlePlaceId: 'e2e-share-tuimoto' },
      ])
      .expect(200);
    expect(saved.body).toEqual({ saved: 2 });

    // Lưu lại cùng lựa chọn: idempotent, không tạo dòng Google thứ hai.
    await api()
      .save(created.body.id, [{ candidateKey: tuimoto.key, kind: 'google', googlePlaceId: 'e2e-share-tuimoto' }])
      .expect(200);
    const [{ n }] = (await db.query(
      `SELECT count(*)::int AS n FROM places WHERE google_place_id = 'e2e-share-tuimoto'`,
    )) as Array<{ n: number }>;
    expect(n).toBe(1);
    const [row] = (await db.query(
      `SELECT name, source, location_expires_at > now() + interval '29 days' AS fresh
         FROM places WHERE google_place_id = 'e2e-share-tuimoto'`,
    )) as Array<{ name: string; source: string; fresh: boolean }>;
    // Tên từ nội dung người dùng, không phải tên Google.
    expect(row).toEqual({ name: 'Cà phê Túi Mơ To', source: 'google', fresh: true });

    const list = await request(app.getHttpServer())
      .get('/api/saved-places')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const fromShare = list.body.filter((s: { source: string }) => s.source === 'share');
    expect(fromShare).toHaveLength(2);
    expect(fromShare[0].shareSource).toMatchObject({ platform: 'tiktok' });

    const summary = await api().list().expect(200);
    expect(summary.body[0]).toMatchObject({ id: created.body.id, savedCount: 2 });
  });

  it('ứng viên tin cậy thấp có tối đa 3 lựa chọn kèm tên Google lấy trực tiếp', async () => {
    metadata.fetch.mockResolvedValueOnce(null);
    extract.mockResolvedValueOnce({
      places: [{ name: 'Quán Gió Mới', category: 'food', regionHint: '', address: '', quote: '' }],
    });
    google.searchText.mockResolvedValueOnce([
      { placeId: 'e2e-share-a', lat: 11.95, lng: 108.44 },
      { placeId: 'e2e-share-b', lat: 11.93, lng: 108.45 },
    ]);
    const created = await api().create({ text: 'Quán Gió Mới ngon' }).expect(202);
    const job = await waitDone(created.body.id);
    expect(job.candidates[0].confidence).toBe('low');
    expect(job.candidates[0].options.map((o: { name: string }) => o.name)).toEqual([
      'Google e2e-share-a',
      'Google e2e-share-b',
    ]);
    const [stored] = (await db.query(`SELECT candidates FROM share_imports WHERE id = $1`, [created.body.id])) as Array<{
      candidates: unknown;
    }>;
    // Tên Google không được lưu.
    expect(JSON.stringify(stored.candidates)).not.toContain('Google e2e-share-a');
  });

  it('lựa chọn không có trong ứng viên → 400 INVALID_SELECTION', async () => {
    metadata.fetch.mockResolvedValueOnce(null);
    extract.mockResolvedValueOnce({
      places: [{ name: 'E2E share Bánh căn Nhà Chung', category: 'food', regionHint: 'Đà Lạt', address: '', quote: '' }],
    });
    const created = await api().create({ text: 'E2E share Bánh căn Nhà Chung' }).expect(202);
    await waitDone(created.body.id);
    const res = await api()
      .save(created.body.id, [{ candidateKey: 'c1', kind: 'google', googlePlaceId: 'e2e-share-bịa' }])
      .expect(400);
    expect(res.body.code).toBe('INVALID_SELECTION');
  });

  it('job của người khác → 404; job chưa xong → 409', async () => {
    metadata.fetch.mockImplementationOnce(() => new Promise(() => undefined)); // treo
    const created = await api().create({ text: 'chờ mãi' }).expect(202);
    await api().save(created.body.id, [{ candidateKey: 'c1', kind: 'catalog', placeId: osmPlace }]).expect(409);
    const res = await api(otherToken).get(created.body.id).expect(404);
    expect(res.body.code).toBe('SHARE_IMPORT_NOT_FOUND');
  });

  it('không có metadata lẫn văn bản → failed METADATA_UNAVAILABLE; Gemini lỗi → AI_UNAVAILABLE', async () => {
    metadata.fetch.mockResolvedValueOnce(null);
    const a = await api().create({ url: 'https://www.facebook.com/share/r/1' }).expect(202);
    expect(await waitDone(a.body.id)).toMatchObject({ status: 'failed', errorCode: 'METADATA_UNAVAILABLE' });

    metadata.fetch.mockResolvedValueOnce(null);
    extract.mockRejectedValueOnce(new Error('429'));
    const b = await api().create({ text: 'Quán gì đó' }).expect(202);
    expect(await waitDone(b.body.id)).toMatchObject({ status: 'failed', errorCode: 'AI_UNAVAILABLE' });
  });

  it('URL không hợp lệ hoặc trỏ vào IP nội bộ → 400 INVALID_SHARE_URL', async () => {
    await api().create({ url: 'javascript:alert(1)' }).expect(400);
    metadata.assertSafe.mockRejectedValueOnce(new UnsafeUrlError('nội bộ'));
    const res = await api().create({ url: 'http://metadata.internal/' }).expect(400);
    expect(res.body.code).toBe('INVALID_SHARE_URL');
  });

  it('quá giới hạn 24 giờ → 429 SHARE_IMPORT_LIMIT', async () => {
    const [{ id: userId }] = (await db.query(
      `SELECT id FROM users WHERE display_name = 'e2e-share-other'`,
    )) as Array<{ id: string }>;
    await db.query(
      `INSERT INTO share_imports (user_id, shared_text, status)
       SELECT $1, 'x', 'done' FROM generate_series(1, 30)`,
      [userId],
    );
    const res = await api(otherToken).create({ text: 'thêm một lượt' }).expect(429);
    expect(res.body.code).toBe('SHARE_IMPORT_LIMIT');
  });

  it('job pending cũ bị đánh INTERRUPTED khi khởi động', async () => {
    const [{ id: userId }] = (await db.query(`SELECT id FROM users WHERE display_name = 'e2e-share'`)) as Array<{ id: string }>;
    const [{ id }] = (await db.query(
      `INSERT INTO share_imports (user_id, shared_text, status, created_at)
       VALUES ($1, 'cũ', 'pending', now() - interval '10 minutes') RETURNING id`,
      [userId],
    )) as Array<{ id: string }>;
    await app.get(ShareImportsService).recoverInterrupted();
    const job = (await api().get(id).expect(200)).body;
    expect(job).toMatchObject({ status: 'failed', errorCode: 'INTERRUPTED' });
  });
```

`osmPlace` là id địa điểm OSM tạo trong `beforeAll`. Import `LinkMetadataService`, `UnsafeUrlError`, `PLACE_EXTRACTOR`, `ShareImportsService`, `RegionLookupService`, `GooglePlacesService`.

- [ ] **Step 2: Chạy test, xác nhận lỗi**

Run: `npx vitest run --config vitest.config.e2e.ts test/share-imports.e2e-spec.ts`
Expected: FAIL — `ShareImportModule` chưa có, route 404.

- [ ] **Step 3: Cấu hình**

`configuration.ts`: thêm

```ts
/** Chia sẻ vào app (F4). */
export interface ShareImportConfig {
  /** Số lượt chia sẻ tối đa mỗi người trong 24 giờ: giữ chi phí Gemini và Google. */
  dailyLimit: number;
  /** Token Meta (app|client) cho oEmbed Facebook/Instagram; trống thì đọc Open Graph. */
  metaOembedToken: string | null;
}
```

thêm `shareImport: ShareImportConfig;` vào `AppConfig`, và trong `loadConfig`:

```ts
    shareImport: {
      dailyLimit: toInt(process.env.SHARE_IMPORT_DAILY_LIMIT, 30),
      metaOembedToken: process.env.META_OEMBED_TOKEN || null,
    },
```

`.env.example` thêm cuối file:

```
# Chia sẻ vào app (F4). Số lượt tối đa mỗi người trong 24 giờ.
SHARE_IMPORT_DAILY_LIMIT=30
# Token Meta dạng "app_id|client_token" để đọc oEmbed Facebook/Instagram. Trống thì đọc Open Graph.
META_OEMBED_TOKEN=
```

- [ ] **Step 4: Hằng số và DTO**

`share-import.constants.ts`:

```ts
export const SHARE_IMPORT_CONFIG = 'SHARE_IMPORT_CONFIG';
/** Job chạy lâu hơn thì coi là lỗi (spec §4.7). */
export const JOB_TIMEOUT_MS = 30_000;
/** Job `pending` cũ hơn chừng này lúc khởi động là bị gián đoạn. */
export const INTERRUPTED_AFTER_MS = 2 * 60 * 1000;
/** Ứng viên có tọa độ Google: quá 30 ngày thì xóa (PRD 7.4). */
export const CANDIDATES_TTL_DAYS = 30;
export const LIST_LIMIT = 20;
export const LIST_DAYS = 7;
```

`dto/create-share-import.dto.ts`:

```ts
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { MAX_SHARED_TEXT, MAX_URL_LENGTH } from '../share-url.js';

export class CreateShareImportDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_URL_LENGTH)
  url?: string;

  /** Văn bản kèm theo (caption, lời người dùng); có thể chứa luôn URL. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SHARED_TEXT * 2)
  text?: string;
}
```

`dto/save-share-import.dto.ts`:

```ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class ShareImportSelectionDto {
  @IsString()
  @MaxLength(8)
  candidateKey!: string;

  @IsIn(['catalog', 'google'])
  kind!: 'catalog' | 'google';

  @ValidateIf((o: ShareImportSelectionDto) => o.kind === 'catalog')
  @IsUUID()
  placeId?: string;

  @ValidateIf((o: ShareImportSelectionDto) => o.kind === 'google')
  @IsString()
  @MaxLength(300)
  googlePlaceId?: string;
}

export class SaveShareImportDto {
  @ValidateNested({ each: true })
  @Type(() => ShareImportSelectionDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(15)
  selections!: ShareImportSelectionDto[];
}
```

- [ ] **Step 5: `SavedPlacesService` nhận nguồn**

Trong `saved-places.service.ts`:

```ts
export type SaveOrigin = { source: 'manual' | 'share'; shareImportId: string | null };
const MANUAL: SaveOrigin = { source: 'manual', shareImportId: null };
```

Đổi chữ ký `save(userId, placeId, regionId, origin: SaveOrigin = MANUAL, runner: Pick<DataSource, 'query'> = this.db)` và dùng `runner.query` cho cả hai truy vấn. Câu INSERT:

```sql
INSERT INTO saved_places (user_id, place_id, region_id, source, share_import_id)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (user_id, place_id) DO UPDATE
  SET region_id = EXCLUDED.region_id,
      source = CASE WHEN EXCLUDED.source = 'share' THEN 'share' ELSE saved_places.source END,
      share_import_id = COALESCE(EXCLUDED.share_import_id, saved_places.share_import_id)
```

(Thả tim thủ công lại một địa điểm đã lưu từ share không xóa nguồn share.)

`list`: SELECT thêm `s.source, si.platform, si.metadata->>'title' AS share_title, si.url AS share_url` với `LEFT JOIN share_imports si ON si.id = s.share_import_id`; map:

```ts
      source: r.source,
      shareSource:
        r.source === 'share' && r.platform
          ? { platform: r.platform, title: r.share_title, url: r.share_url }
          : null,
```

(Thay `source: 'manual', shareSource: null` tạm ở Task 3.) `saved-places.module.ts`: `exports: [SavedPlacesService]`.

- [ ] **Step 6: `ShareImportsService`**

```ts
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  SaveShareImportResponse,
  ShareImport,
  ShareImportCandidate,
  ShareImportErrorCode,
  ShareImportSummary,
  SharePlatform,
} from '@rong/shared-types';
import { DataSource } from 'typeorm';

import type { ShareImportConfig } from '../../config/configuration.js';
import { GooglePlacesService } from '../google/google-places.service.js';
import { CATALOG_MIN_SIMILARITY, matchCatalog } from '../places/catalog-match.js';
import { GOOGLE_LOCATION_TTL_DAYS } from '../places/place-location.service.js';
import { SavedPlacesService } from '../saved-places/saved-places.service.js';
import type { CreateShareImportDto } from './dto/create-share-import.dto.js';
import type { SaveShareImportDto } from './dto/save-share-import.dto.js';
import { LinkMetadataService, UnsafeUrlError, type LinkMetadata } from './link-metadata.service.js';
import {
  buildExtractionInput,
  extractPlaces,
  PLACE_EXTRACTOR,
  type ExtractFn,
} from './place-extraction.js';
import { resolvePlaces, type StoredCandidate, type StoredOption } from './place-resolver.js';
import { RegionLookupService } from './region-lookup.service.js';
import {
  CANDIDATES_TTL_DAYS,
  INTERRUPTED_AFTER_MS,
  JOB_TIMEOUT_MS,
  LIST_DAYS,
  LIST_LIMIT,
  SHARE_IMPORT_CONFIG,
} from './share-import.constants.js';
import { detectPlatform, normalizeShareInput } from './share-url.js';

/** Không có vùng gợi ý thì khớp toàn quốc, nên đòi tên giống hơn. */
const NATIONWIDE_MIN_SIMILARITY = CATALOG_MIN_SIMILARITY + 0.15;
const SUMMARY_TIMEOUT_MS = 3000;
const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;

interface JobRow {
  id: string;
  user_id: string;
  url: string | null;
  shared_text: string | null;
  status: ShareImport['status'];
  platform: SharePlatform | null;
  metadata: Pick<LinkMetadata, 'title' | 'authorName' | 'thumbnailUrl'> | null;
  candidates: StoredCandidate[];
  error_code: ShareImportErrorCode | null;
  created_at: Date;
  saved_count: number;
}

class JobError extends Error {
  constructor(readonly code: ShareImportErrorCode) {
    super(code);
  }
}

/**
 * Chia sẻ vào app (F4): nhận link/văn bản, nhận diện địa điểm ở nền, cho
 * người dùng chọn rồi lưu vào "Muốn đi". Job nằm trong bảng `share_imports`
 * nên thoát app vẫn xem lại được.
 */
@Injectable()
export class ShareImportsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ShareImportsService.name);
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly metadata: LinkMetadataService,
    @Inject(PLACE_EXTRACTOR) private readonly extract: ExtractFn,
    private readonly google: GooglePlacesService,
    private readonly regions: RegionLookupService,
    private readonly saved: SavedPlacesService,
    @Inject(SHARE_IMPORT_CONFIG) private readonly config: ShareImportConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.recoverInterrupted();
    this.sweepTimer = setInterval(
      () => void this.sweepOldCandidates().catch((e: Error) => this.logger.warn(e.message)),
      SWEEP_EVERY_MS,
    ).unref();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /** Job `pending` từ lần chạy trước (server khởi động lại giữa chừng) không bao giờ xong nữa. */
  async recoverInterrupted(): Promise<void> {
    await this.db.query(
      `UPDATE share_imports SET status = 'failed', error_code = 'INTERRUPTED', finished_at = now()
        WHERE status = 'pending' AND created_at < now() - make_interval(secs => $1::float8)`,
      [INTERRUPTED_AFTER_MS / 1000],
    );
  }

  /** Ứng viên chứa tọa độ Google: xóa sau 30 ngày; thẻ nguồn giữ lại. */
  async sweepOldCandidates(): Promise<void> {
    await this.db.query(
      `UPDATE share_imports SET candidates = '[]'
        WHERE candidates <> '[]' AND created_at < now() - make_interval(days => $1::int)`,
      [CANDIDATES_TTL_DAYS],
    );
  }

  async create(userId: string, dto: CreateShareImportDto): Promise<{ id: string }> {
    const input = normalizeShareInput(dto);
    if (!input || (dto.url?.trim() && !input.url)) {
      throw bad('INVALID_SHARE_URL', 'Link không hợp lệ. Hãy chia sẻ một link http(s) hoặc dán mô tả.');
    }
    if (input.url) {
      try {
        await this.metadata.assertSafe(input.url);
      } catch (error) {
        if (error instanceof UnsafeUrlError) {
          throw bad('INVALID_SHARE_URL', 'Không đọc được link này.');
        }
        throw error;
      }
    }
    const [{ n }] = (await this.db.query(
      `SELECT count(*)::int AS n FROM share_imports
        WHERE user_id = $1 AND created_at > now() - interval '24 hours'`,
      [userId],
    )) as Array<{ n: number }>;
    if (n >= this.config.dailyLimit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'SHARE_IMPORT_LIMIT',
          message: `Mỗi ngày nhận diện tối đa ${this.config.dailyLimit} lượt chia sẻ. Thử lại sau nhé.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const [{ id }] = (await this.db.query(
      `INSERT INTO share_imports (user_id, url, shared_text, platform)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [userId, input.url?.toString() ?? null, input.text, input.url ? detectPlatform(input.url) : 'web'],
    )) as Array<{ id: string }>;
    void this.run(id, input.url, input.text);
    return { id };
  }

  async list(userId: string): Promise<ShareImportSummary[]> {
    const rows = await this.rows(
      `WHERE si.user_id = $1 AND si.created_at > now() - make_interval(days => $2::int)
       ORDER BY si.created_at DESC LIMIT $3`,
      [userId, LIST_DAYS, LIST_LIMIT],
    );
    return rows.map(toSummary);
  }

  async get(userId: string, id: string): Promise<ShareImport> {
    const row = await this.findOwned(userId, id);
    return { ...toSummary(row), errorCode: row.error_code, candidates: await this.present(row.candidates) };
  }

  async save(userId: string, id: string, dto: SaveShareImportDto): Promise<SaveShareImportResponse> {
    const row = await this.findOwned(userId, id);
    if (row.status !== 'done') {
      throw new ConflictException({
        statusCode: 409,
        code: 'SHARE_IMPORT_NOT_READY',
        message: 'Chưa nhận diện xong. Chờ một chút rồi lưu.',
      });
    }
    const chosen = dto.selections.map((selection) => {
      const candidate = row.candidates.find((c) => c.key === selection.candidateKey);
      const option = candidate?.options.find((o) =>
        o.kind === 'catalog'
          ? selection.kind === 'catalog' && o.placeId === selection.placeId
          : selection.kind === 'google' && o.googlePlaceId === selection.googlePlaceId,
      );
      if (!candidate || !option) {
        throw bad('INVALID_SELECTION', 'Lựa chọn không nằm trong kết quả nhận diện.');
      }
      return { candidate, option };
    });
    if (
      chosen.some(({ option }) => option.kind === 'google') &&
      Date.now() - row.created_at.getTime() > CANDIDATES_TTL_DAYS * 24 * 60 * 60 * 1000
    ) {
      throw bad('SHARE_IMPORT_EXPIRED', 'Kết quả nhận diện đã quá cũ. Hãy chia sẻ lại link.');
    }

    await this.db.transaction(async (m) => {
      for (const { candidate, option } of chosen) {
        const placeId = option.kind === 'catalog' ? option.placeId : await upsertGooglePlace(m, candidate, option);
        await this.saved.save(userId, placeId, option.regionId, { source: 'share', shareImportId: id }, m);
      }
    });
    return { saved: chosen.length };
  }

  private async run(id: string, url: URL | null, text: string | null): Promise<void> {
    const started = Date.now();
    const timing: string[] = [];
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new JobError('TIMEOUT')), JOB_TIMEOUT_MS);
      });
      const work = (async () => {
        let meta: LinkMetadata | null = null;
        if (url) {
          meta = await this.metadata.fetch(url).catch(() => null);
          timing.push(`metadata ${Date.now() - started} ms`);
          await this.db.query(
            `UPDATE share_imports SET platform = COALESCE($2, platform), url = COALESCE($3, url), metadata = $4 WHERE id = $1`,
            [
              id,
              meta?.platform ?? null,
              meta?.finalUrl ?? null,
              meta ? { title: meta.title, authorName: meta.authorName, thumbnailUrl: meta.thumbnailUrl } : null,
            ],
          );
        }
        const input = buildExtractionInput(meta, text);
        if (!input) throw new JobError('METADATA_UNAVAILABLE');

        let places;
        try {
          places = await extractPlaces(input, this.extract);
        } catch (error) {
          this.logger.warn(`Gemini lỗi cho share ${id}: ${(error as Error).message}`);
          throw new JobError('AI_UNAVAILABLE');
        }
        timing.push(`gemini ${places.length} tên ${Date.now() - started} ms`);

        return resolvePlaces(places, {
          findRegion: (hint) => this.regions.findByHint(hint),
          matchCatalog: async (name, bbox) => {
            const [match] = await matchCatalog(
              this.db,
              [name],
              bbox,
              bbox ? CATALOG_MIN_SIMILARITY : NATIONWIDE_MIN_SIMILARITY,
            );
            return match ? { placeId: match.id, lat: Number(match.lat), lng: Number(match.lng) } : null;
          },
          searchGoogle: (query, bbox) =>
            this.google.enabled ? this.google.searchText(query, bbox) : Promise.resolve([]),
          assignRegions: (points) => this.regions.assign(points),
        });
      })();
      const candidates = await Promise.race([work, timeout]);
      timing.push(`khớp ${Date.now() - started} ms`);
      await this.db.query(
        `UPDATE share_imports SET status = 'done', candidates = $2, finished_at = now() WHERE id = $1 AND status = 'pending'`,
        [id, JSON.stringify(candidates)],
      );
    } catch (error) {
      const code = error instanceof JobError ? error.code : 'AI_UNAVAILABLE';
      if (!(error instanceof JobError)) {
        this.logger.error(`Share ${id} lỗi không mong muốn`, error as Error);
      }
      await this.db
        .query(
          `UPDATE share_imports SET status = 'failed', error_code = $2, finished_at = now() WHERE id = $1 AND status = 'pending'`,
          [id, code],
        )
        .catch((e: Error) => this.logger.error(`Không ghi được lỗi share ${id}: ${e.message}`));
    } finally {
      clearTimeout(timer);
      this.logger.log(`Share ${id}: ${timing.join(', ')} (tổng ${Date.now() - started} ms)`);
    }
  }

  /** Ứng viên trả cho client: tên danh mục từ DB, tên/địa chỉ Google lấy trực tiếp cho lựa chọn tin cậy thấp. */
  private async present(candidates: StoredCandidate[]): Promise<ShareImportCandidate[]> {
    const options = candidates.flatMap((c) => c.options);
    const catalogIds = options.flatMap((o) => (o.kind === 'catalog' ? [o.placeId] : []));
    const catalogNames = new Map<string, string>(
      catalogIds.length
        ? ((await this.db.query(`SELECT id, name FROM places WHERE id = ANY($1::uuid[])`, [catalogIds])) as Array<{
            id: string;
            name: string;
          }>).map((r) => [r.id, r.name])
        : [],
    );
    const regionNames = await this.regions.names([...new Set(options.map((o) => o.regionId))]);
    const lowGoogle = candidates
      .filter((c) => c.confidence === 'low' || c.options.length > 1)
      .flatMap((c) => c.options.flatMap((o) => (o.kind === 'google' ? [o.googlePlaceId] : [])));
    const summaries = new Map<string, { name: string | null; address: string | null }>();
    if (this.google.enabled && lowGoogle.length > 0) {
      const results = await Promise.allSettled(
        lowGoogle.map((placeId) => withTimeout(this.google.summary(placeId), SUMMARY_TIMEOUT_MS)),
      );
      results.forEach((result, i) => {
        if (result.status === 'fulfilled' && result.value) summaries.set(lowGoogle[i], result.value);
      });
    }
    return candidates.map((c) => ({
      key: c.key,
      name: c.name,
      category: c.category,
      quote: c.quote,
      confidence: c.confidence,
      options: c.options.map((o: StoredOption) => ({
        ref: o.kind === 'catalog' ? { kind: 'catalog', placeId: o.placeId } : { kind: 'google', googlePlaceId: o.googlePlaceId },
        name: o.kind === 'catalog' ? (catalogNames.get(o.placeId) ?? null) : (summaries.get(o.googlePlaceId)?.name ?? null),
        address: o.kind === 'google' ? (summaries.get(o.googlePlaceId)?.address ?? null) : null,
        regionId: o.regionId,
        regionName: regionNames.get(o.regionId) ?? '',
      })),
    }));
  }

  private async findOwned(userId: string, id: string): Promise<JobRow> {
    const [row] = await this.rows(`WHERE si.id = $1 AND si.user_id = $2`, [id, userId]);
    if (!row) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'SHARE_IMPORT_NOT_FOUND',
        message: 'Không tìm thấy lượt chia sẻ này.',
      });
    }
    return row;
  }

  private rows(where: string, params: unknown[]): Promise<JobRow[]> {
    return this.db.query(
      `SELECT si.*, (SELECT count(*)::int FROM saved_places s WHERE s.share_import_id = si.id) AS saved_count
         FROM share_imports si ${where}`,
      params,
    ) as Promise<JobRow[]>;
  }
}

/** Dòng `places` nguồn Google: tên từ nội dung người dùng, tọa độ Google hạn 30 ngày. Dùng chung theo place_id. */
async function upsertGooglePlace(
  m: Pick<DataSource, 'query'>,
  candidate: StoredCandidate,
  option: Extract<StoredOption, { kind: 'google' }>,
): Promise<string> {
  const [row] = (await m.query(
    `INSERT INTO places (source, google_place_id, name, category, location, location_expires_at, composite_score)
     VALUES ('google', $1, $2, $3::place_category, ST_SetSRID(ST_MakePoint($4::float8, $5::float8), 4326),
             now() + make_interval(days => $6::int), 0)
     ON CONFLICT (google_place_id) WHERE source = 'google'
     DO UPDATE SET location = EXCLUDED.location, location_expires_at = EXCLUDED.location_expires_at, updated_at = now()
     RETURNING id`,
    [option.googlePlaceId, candidate.name, candidate.category, option.lng, option.lat, GOOGLE_LOCATION_TTL_DAYS],
  )) as Array<{ id: string }>;
  return row.id;
}

function toSummary(row: JobRow): ShareImportSummary {
  return {
    id: row.id,
    status: row.status,
    source: {
      platform: row.platform ?? 'web',
      url: row.url,
      title: row.metadata?.title ?? null,
      authorName: row.metadata?.authorName ?? null,
      thumbnailUrl: row.metadata?.thumbnailUrl ?? null,
    },
    candidateCount: row.candidates.length,
    savedCount: row.saved_count,
    createdAt: row.created_at.toISOString(),
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref()),
  ]);
}

function bad(code: string, message: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, code, message });
}
```

Ghi chú khi gõ code: tham số `metadata` của câu UPDATE là object JS — driver `pg` tự chuyển sang JSON; nếu báo lỗi kiểu thì `JSON.stringify(...)` và ép `$4::jsonb`. Tương tự `candidates` đã `JSON.stringify` — thêm `$2::jsonb`.

- [ ] **Step 7: Controller và module**

`share-imports.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { SaveShareImportResponse, ShareImport, ShareImportSummary } from '@rong/shared-types';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CreateShareImportDto } from './dto/create-share-import.dto.js';
import { SaveShareImportDto } from './dto/save-share-import.dto.js';
import { ShareImportsService } from './share-imports.service.js';

/** Chia sẻ vào app (F4). Nhận diện chạy nền: POST trả 202, client hỏi lại GET /:id. */
@Controller('share-imports')
export class ShareImportsController {
  constructor(private readonly imports: ShareImportsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateShareImportDto): Promise<{ id: string }> {
    return this.imports.create(user.userId, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ShareImportSummary[]> {
    return this.imports.list(user.userId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string): Promise<ShareImport> {
    return this.imports.get(user.userId, id);
  }

  @Post(':id/save')
  @HttpCode(HttpStatus.OK)
  save(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SaveShareImportDto,
  ): Promise<SaveShareImportResponse> {
    return this.imports.save(user.userId, id, dto);
  }
}
```

`share-import.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/configuration.js';
import { GoogleModule } from '../google/google.module.js';
import { SavedPlacesModule } from '../saved-places/saved-places.module.js';
import { createLinkMetadataService, LinkMetadataService } from './link-metadata.service.js';
import { createPlaceExtractor, PLACE_EXTRACTOR } from './place-extraction.js';
import { RegionLookupService } from './region-lookup.service.js';
import { SHARE_IMPORT_CONFIG } from './share-import.constants.js';
import { ShareImportsController } from './share-imports.controller.js';
import { ShareImportsService } from './share-imports.service.js';

@Module({
  imports: [GoogleModule, SavedPlacesModule],
  controllers: [ShareImportsController],
  providers: [
    ShareImportsService,
    RegionLookupService,
    {
      provide: SHARE_IMPORT_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.getOrThrow<AppConfig['shareImport']>('shareImport'),
    },
    {
      provide: LinkMetadataService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createLinkMetadataService({
          metaOembedToken: config.getOrThrow<AppConfig['shareImport']>('shareImport').metaOembedToken,
          contactEmail: config.getOrThrow<AppConfig['openData']>('openData').contactEmail,
        }),
    },
    { provide: PLACE_EXTRACTOR, useFactory: createPlaceExtractor },
  ],
})
export class ShareImportModule {}
```

`app.module.ts`: import và thêm `ShareImportModule` sau `SavedPlacesModule`. Xóa `src/modules/share-import/.gitkeep`.

- [ ] **Step 8: Chạy test**

Run: `pnpm typecheck && pnpm lint && npx vitest run src && npx vitest run --config vitest.config.e2e.ts test/share-imports.e2e-spec.ts test/saved-places.e2e-spec.ts test/places-source.e2e-spec.ts`
Expected: PASS (kể cả test `RegionLookupService` thêm ở Task 8).

- [ ] **Step 9: Commit**

```bash
git add apps/backend packages/shared-types
git commit -m "feat(backend): add share-to-app import jobs and save to wishlist"
```

---

### Task 11: Bộ đo thật và tài liệu

**Files:**
- Create: `apps/backend/test/share-import.live-spec.ts`, `apps/backend/test/fixtures/share-links.json`
- Modify: `apps/backend/package.json` (script `bench:share`), `apps/backend/src/modules/README.md`, `CLAUDE.md` (gốc)

- [ ] **Step 1: Fixture**

`test/fixtures/share-links.json` — mảng `{ "url": string, "text"?: string, "expect": string[] }`, trong đó `expect` là tên địa điểm (một tên khớp là đạt). Bắt đầu với 10 link thật người dùng dự án tự chọn (TikTok, YouTube, Facebook, bài báo); để mảng mẫu 2 mục với link YouTube/bài báo công khai về Đà Lạt và ghi chú trong README rằng bộ đủ 200 link (PRD) được bổ sung dần.

- [ ] **Step 2: Live spec**

`test/share-import.live-spec.ts` (chạy bằng config live như `places.live-spec.ts` — mở file đó để chép cách nạp `.env`, bỏ qua khi thiếu khóa):

```ts
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createLinkMetadataService } from '../src/modules/share-import/link-metadata.service.js';
import { buildExtractionInput, createPlaceExtractor, extractPlaces } from '../src/modules/share-import/place-extraction.js';
import { normalizeForMatch } from '../src/modules/places/web-grounding.js';
import { normalizeShareInput } from '../src/modules/share-import/share-url.js';

const links = JSON.parse(
  readFileSync(new URL('./fixtures/share-links.json', import.meta.url), 'utf8'),
) as Array<{ url: string; text?: string; expect: string[] }>;

/** Đo tỉ lệ link nhận diện đúng ≥ 1 địa điểm (PRD F4: ≥ 70%). Gọi mạng và Gemini thật, tốn tiền. */
describe.skipIf(!process.env.GEMINI_API_KEY)('share-to-app live', () => {
  it('nhận diện bộ link thật', { timeout: 600_000 }, async () => {
    const metadata = createLinkMetadataService({
      metaOembedToken: process.env.META_OEMBED_TOKEN || null,
      contactEmail: process.env.OPEN_DATA_CONTACT_EMAIL || 'dev@rong.local',
    });
    const extract = createPlaceExtractor();
    let hits = 0;
    for (const link of links) {
      const input = normalizeShareInput({ url: link.url, text: link.text });
      const meta = input?.url ? await metadata.fetch(input.url) : null;
      const places = await extractPlaces(buildExtractionInput(meta, input?.text ?? null), extract).catch(() => []);
      const found = places.map((p) => normalizeForMatch(p.name));
      const ok = link.expect.some((name) => found.some((f) => f.includes(normalizeForMatch(name))));
      if (ok) hits++;
      console.log(`${ok ? '✓' : '✗'} ${link.url} → ${places.map((p) => p.name).join(' | ') || '(không có)'}`);
    }
    const rate = hits / links.length;
    console.log(`Tỉ lệ đúng: ${(rate * 100).toFixed(0)}% (${hits}/${links.length})`);
    expect(links.length).toBeGreaterThan(0);
  });
});
```

`package.json` thêm script cạnh `bench:places`: `"bench:share": "vitest run --config <cùng config với bench:places> test/share-import.live-spec.ts"` (mở `package.json` để lấy đúng config).

- [ ] **Step 3: Tài liệu**

- `src/modules/README.md`: thêm mục `share-import/` (luồng job, bảng `share_imports`, gateway `LinkMetadataService`, giới hạn), mục `places.source` (dòng Google, `PlaceLocationService`, `GoogleLocationJanitor`, mọi truy vấn danh mục lọc `source = 'osm'`), và sai khác PRD (spec §1.2; update itinerary trả 503 khi không lấy được tọa độ).
- `CLAUDE.md` gốc: bảng gateway thêm dòng `modules/share-import/LinkMetadataService | oEmbed, Open Graph của link người dùng chia sẻ | Chặn IP không công khai ở mọi redirect, tối đa 5 redirect / 5 s / 1 MB.`; sửa câu "`ranking/`, `realtime/` and `share-import/` are placeholders" thành "`ranking/` and `realtime/` are placeholders"; thêm một đoạn ngắn "### Share-to-app (F4)" mô tả luồng job và việc `places` có dòng nguồn Google không bao giờ được xếp hạng.

- [ ] **Step 4: Kiểm tra và commit**

Run: `pnpm lint && pnpm typecheck`
Expected: sạch.

```bash
git add apps/backend/test/share-import.live-spec.ts apps/backend/test/fixtures/share-links.json apps/backend/package.json apps/backend/src/modules/README.md CLAUDE.md
git commit -m "docs: document share-to-app and add live recognition bench"
```

---

### Task 12: Mobile — nhận nội dung chia sẻ (`expo-share-intent`)

**Files:**
- Modify: `apps/mobile/package.json`, `apps/mobile/app.config.ts`, `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/app/(app)/_layout.tsx`
- Create: `apps/mobile/src/app/+native-intent.tsx`, `apps/mobile/src/lib/share-intent.tsx`

**Interfaces:**
- Produces: `useIncomingShare()` trong `src/lib/share-intent.tsx` — hook đặt trong `(app)/_layout.tsx`, khi có share sẽ `POST /share-imports` rồi `router.push({ pathname: '/share-import/[id]', params: { id } })`.

- [ ] **Step 1: Kiểm tra tương thích**

Run: `npm view expo-share-intent versions --json | tail -5 && npm view expo-share-intent peerDependencies`
Đọc README của bản mới nhất (`npm view expo-share-intent readme | head -200`). Xác nhận: hỗ trợ `expo` ~57, cách khai báo plugin, tên API (`ShareIntentProvider`, `useShareIntentContext`, `resetShareIntent`, `shareIntent.webUrl/text`) và việc cần `+native-intent.tsx` cho expo-router. **Nếu chưa hỗ trợ SDK 57: dừng task, báo lại** (spec: phương án dự phòng là tự viết config plugin Android trước — cần duyệt lại).

- [ ] **Step 2: Cài và cấu hình**

Run: `cd apps/mobile && npx expo install expo-share-intent`

`app.config.ts` thêm vào `plugins` (đổi tên option theo README đã đọc ở Step 1 nếu khác):

```ts
    // Nhận link/văn bản chia sẻ từ app khác (F4): iOS Share Extension, Android intent SEND.
    [
      'expo-share-intent',
      {
        iosActivationRules: { NSExtensionActivationSupportsWebURLWithMaxCount: 1, NSExtensionActivationSupportsText: true },
        iosAppGroupIdentifier: 'group.vn.rong.app',
        androidIntentFilters: ['text/*'],
      },
    ],
```

- [ ] **Step 3: `+native-intent.tsx`**

Share intent mở app bằng URL dạng `rong://dataUrl=...`; expo-router sẽ cố điều hướng tới đường dẫn đó. Chuyển về trang chủ, để hook xử lý:

```tsx
/** URL do expo-share-intent mở app (F4) không phải một màn: về trang chủ, `useIncomingShare` lo phần còn lại. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (path.includes('dataUrl=')) return '/';
  return path;
}
```

(Đối chiếu chuỗi nhận diện với README; một số bản dùng `rongShareKey`.)

- [ ] **Step 4: Provider và hook**

`src/app/_layout.tsx`: bọc cây hiện có bằng `<ShareIntentProvider>` (từ `expo-share-intent`) ở ngoài cùng, ngoài `AuthProvider`. Thêm comment: "Giữ nội dung chia sẻ tới khi đăng nhập xong (F4)".

`src/lib/share-intent.tsx`:

```tsx
import { router } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import { ApiError } from '@/lib/api';

/**
 * Nội dung chia sẻ từ app khác (F4). Chỉ chạy trong nhóm màn đã đăng nhập:
 * chia sẻ lúc chưa đăng nhập thì provider giữ lại, đăng nhập xong mới gửi.
 */
export function useIncomingShare() {
  const { authFetch } = useAuth();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const sending = useRef(false);

  useEffect(() => {
    if (!hasShareIntent || sending.current) return;
    const url = shareIntent.webUrl ?? undefined;
    const text = shareIntent.text ?? undefined;
    resetShareIntent();
    if (!url && !text) return;
    sending.current = true;
    authFetch<{ id: string }>('/share-imports', { method: 'POST', body: { url, text } })
      .then(({ id }) => router.push({ pathname: '/share-import/[id]', params: { id } }))
      .catch((e) =>
        Alert.alert('Chưa nhận được nội dung chia sẻ', e instanceof ApiError ? e.message : 'Thử lại sau nhé.'),
      )
      .finally(() => {
        sending.current = false;
      });
  }, [hasShareIntent, shareIntent, resetShareIntent, authFetch]);
}
```

`src/app/(app)/_layout.tsx`: gọi `useIncomingShare()` — vì hook dùng `useAuth` và cần nằm trong `SavedPlacesProvider` không bắt buộc, tạo component con:

```tsx
function IncomingShare() {
  useIncomingShare();
  return null;
}
```

đặt `<IncomingShare />` ngay trong `SavedPlacesProvider`, trước `<Stack>`. Thêm `<Stack.Screen name="share-import/[id]" />`.

- [ ] **Step 5: Kiểm tra**

Run: `pnpm --filter @rong/mobile typecheck && pnpm --filter @rong/mobile lint`
Expected: sạch (màn `share-import/[id]` chưa có thì typed routes báo lỗi — tạo file tạm `export default function ShareImportScreen() { return null; }` ở `src/app/(app)/share-import/[id].tsx`; Task 13 viết đầy đủ).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile pnpm-lock.yaml
git commit -m "feat(mobile): receive shared links via share extension and intent"
```

---

### Task 13: Mobile — màn xác nhận `share-import/[id]`

**Files:**
- Create: `apps/mobile/src/hooks/use-share-import.ts`, `apps/mobile/src/components/share-source-card.tsx`
- Modify: `apps/mobile/src/app/(app)/share-import/[id].tsx` (viết đầy đủ)

**Interfaces:**
- Consumes: `ShareImport`, `ShareImportCandidate`, `ShareImportSelection`, `SaveShareImportResponse`, `ShareSource` (Task 3); `useSavedPlaces().reload` (`src/lib/saved-places.tsx`).
- Produces: `useShareImport(id)` → `{ job: ShareImport | null; error: ApiError | null; reload(): void }`, hỏi lại mỗi 1,5 giây khi `pending`; `<ShareSourceCard source={...} />`.

- [ ] **Step 1: Hook**

`src/hooks/use-share-import.ts`:

```ts
import type { ShareImport } from '@rong/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/auth/auth-context';
import { ApiError } from '@/lib/api';

const POLL_MS = 1500;

/** Một lượt chia sẻ (F4); hỏi lại tới khi nhận diện xong hoặc lỗi. */
export function useShareImport(id: string | undefined) {
  const { authFetch } = useAuth();
  const [job, setJob] = useState<ShareImport | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await authFetch<ShareImport>(`/share-imports/${id}`);
      setJob(data);
      setError(null);
      if (data.status === 'pending') timer.current = setTimeout(load, POLL_MS);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Có lỗi không mong muốn. Thử lại sau.'));
    }
  }, [id, authFetch]);

  useEffect(() => {
    load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  return { job, error, reload: load };
}
```

- [ ] **Step 2: Thẻ nguồn**

`src/components/share-source-card.tsx` — dùng `expo-image` cho thumbnail (64×64, bo `Radius.sm`), tên nền tảng (`TikTok`, `YouTube`, `Facebook`, `Instagram`, `Trang web`), tiêu đề 2 dòng, tác giả; chạm mở `source.url` bằng `Linking.openURL`. Màu/khoảng cách lấy từ `@/constants/theme` (`Colors.light.surface`, `Spacing`, `Type.subhead`…) như `saved.tsx`. Export `PLATFORM_LABELS: Record<SharePlatform, string>` để Task 14 dùng.

```tsx
import type { SharePlatform, ShareSource } from '@rong/shared-types';
import { Image } from 'expo-image';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';

export const PLATFORM_LABELS: Record<SharePlatform, string> = {
  tiktok: 'TikTok',
  youtube: 'YouTube',
  facebook: 'Facebook',
  instagram: 'Instagram',
  web: 'Trang web',
};

/** Ghi nguồn nội dung được chia sẻ (FR-4.5): chỉ metadata công khai, chạm để mở bài gốc. */
export function ShareSourceCard({ source }: { source: ShareSource }) {
  const open = source.url ? () => Linking.openURL(source.url!) : undefined;
  return (
    <Pressable
      accessibilityRole={open ? 'link' : undefined}
      accessibilityLabel={`Nguồn: ${PLATFORM_LABELS[source.platform]}${source.title ? `, ${source.title}` : ''}`}
      onPress={open}
      style={({ pressed }) => [styles.card, pressed && open && styles.pressed]}>
      {source.thumbnailUrl ? (
        <Image source={{ uri: source.thumbnailUrl }} style={styles.thumb} contentFit="cover" />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]} />
      )}
      <View style={styles.flex}>
        <Text style={styles.platform}>{PLATFORM_LABELS[source.platform]}</Text>
        {source.title ? (
          <Text style={styles.title} numberOfLines={2}>
            {source.title}
          </Text>
        ) : null}
        {source.authorName ? <Text style={styles.meta}>{source.authorName}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    backgroundColor: Colors.light.surface,
  },
  pressed: { opacity: 0.7 },
  thumb: { width: 64, height: 64, borderRadius: Radius.sm, borderCurve: 'continuous' },
  thumbEmpty: { backgroundColor: Colors.light.backgroundSelected },
  flex: { flex: 1, gap: 2 },
  platform: { ...Type.subhead, color: Colors.light.primary },
  title: { ...Type.headline, color: Colors.light.text },
  meta: { ...Type.subhead, color: Colors.light.textSecondary },
});
```

(Nếu `Colors.light.primary` / `Type.subhead` không tồn tại, dùng đúng token mà `saved.tsx` dùng.)

- [ ] **Step 3: Màn hình**

`src/app/(app)/share-import/[id].tsx`. Cấu trúc (bọc `<Screen>`; nội dung trong `ScrollView` từ `react-native-gesture-handler` với `keyboardShouldPersistTaps="handled"`):

- Thanh trên: nút quay lại (giống `saved.tsx`), tiêu đề "Lưu địa điểm từ bài chia sẻ".
- `job === null && !error`: `ActivityIndicator`.
- `error`: `<Notice tone="danger">` với nút "Thử lại" (`reload`).
- Có `job`: `<ShareSourceCard source={job.source} />`, rồi:
  - `pending`: hàng "Đang tìm địa điểm…" có `ActivityIndicator`.
  - `done` và có ứng viên: danh sách ứng viên. State `selection: Record<candidateKey, ShareImportSelection | null>` khởi tạo một lần khi job chuyển sang `done`: `high` → lựa chọn đầu; `low`/`none` → `null`.
    - Mỗi ứng viên: tên (`Type.headline`), loại (`CATEGORY_LABELS`), `quote` (2 dòng, chữ phụ).
    - `high`: một checkbox (Pressable, `accessibilityRole="checkbox"`, `accessibilityState={{ checked }}`) kèm tên lựa chọn (hoặc tên ứng viên) và `regionName`.
    - `low`: tối đa 3 hàng radio (`accessibilityRole="radio"`) hiện `option.name ?? candidate.name`, `option.address`, `option.regionName`; chạm lại hàng đang chọn để bỏ chọn.
    - `none`: chữ "Chưa tìm được địa điểm khớp." và nút plain "Tự tìm" → `router.push('/search')`.
  - Nút chính dưới cùng: `Lưu ${n} địa điểm` (`Button`, disabled khi `n === 0` hoặc đang lưu). Bấm → `authFetch<SaveShareImportResponse>(\`/share-imports/${id}/save\`, { method: 'POST', body: { selections } })` → `saved.reload()` → `router.replace('/saved')`. Lỗi → `Alert.alert('Chưa lưu được', e.message)`.
  - `failed`, hoặc `done` mà không có ứng viên: thông báo theo `errorCode` (`METADATA_UNAVAILABLE`: "Không đọc được nội dung link này."; `AI_UNAVAILABLE`/`TIMEOUT`/`INTERRUPTED`: "Chưa nhận diện được, thử lại sau."; không ứng viên: "Không thấy địa điểm nào trong bài."), kèm `TextField` nhiều dòng "Dán mô tả hoặc tên địa điểm" và nút "Nhận diện lại" → `POST /share-imports` với `{ text }` → `router.replace({ pathname: '/share-import/[id]', params: { id: newId } })`. (FR-4.8)

Dựng selections khi lưu: `Object.values(selection).filter(Boolean) as ShareImportSelection[]`, với mỗi lựa chọn `{ candidateKey, ...option.ref }`.

Tham khảo cách dùng `Button`, `Notice`, `TextField`, `Icon` trong `saved.tsx` và `src/components/ui/*` để giữ đúng props.

- [ ] **Step 4: Kiểm tra**

Run: `pnpm --filter @rong/mobile typecheck && pnpm --filter @rong/mobile lint`
Expected: sạch.

Thử tay (Android dev build, backend chạy local với `GEMINI_API_KEY`, `GOOGLE_MAPS_API_KEY`): mở YouTube → chia sẻ một video về Đà Lạt → chọn Rong → màn xác nhận hiện thẻ nguồn, "Đang tìm…", rồi ứng viên → Lưu → sang "Muốn đi". Thử bàn phím ở ô "Dán mô tả": ô và nút vẫn nhìn thấy.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src
git commit -m "feat(mobile): confirm places recognized from shared content"
```

---

### Task 14: Mobile — "Đang nhận diện" và nhãn nguồn trong "Muốn đi"

**Files:**
- Modify: `apps/mobile/src/app/(app)/saved.tsx`
- Create: `apps/mobile/src/hooks/use-share-imports.ts`

**Interfaces:**
- Consumes: `ShareImportSummary`, `SavedPlace.shareSource` (Task 3), `PLATFORM_LABELS` (Task 13).
- Produces: `useShareImports()` → `{ items: ShareImportSummary[]; reload(): void }` (lọc: `pending`, hoặc `done` với `candidateCount > 0 && savedCount === 0`).

- [ ] **Step 1: Hook**

```ts
import type { ShareImportSummary } from '@rong/shared-types';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/auth/auth-context';

/** Lượt chia sẻ còn cần người dùng xem: đang nhận diện, hoặc xong mà chưa lưu gì. */
export function useShareImports() {
  const { authFetch } = useAuth();
  const [items, setItems] = useState<ShareImportSummary[]>([]);

  const reload = useCallback(async () => {
    try {
      const data = await authFetch<ShareImportSummary[]>('/share-imports');
      setItems(data.filter((s) => s.status === 'pending' || (s.status === 'done' && s.candidateCount > 0 && s.savedCount === 0)));
    } catch {
      // Phần phụ của màn "Muốn đi": lỗi thì ẩn đi, không chặn danh sách chính.
      setItems([]);
    }
  }, [authFetch]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { items, reload };
}
```

- [ ] **Step 2: Sửa `saved.tsx`**

- Gọi `const shares = useShareImports();`. `RefreshControl.onRefresh` gọi cả `saved.reload()` và `shares.reload()`.
- `ListHeaderComponent`: dưới tiêu đề "Muốn đi", nếu `shares.items.length > 0` hiện khối "Từ bài chia sẻ" — mỗi mục một hàng Pressable: `PLATFORM_LABELS[s.source.platform]`, `s.source.title ?? 'Bài chia sẻ'`, trạng thái ("Đang nhận diện…" hoặc `${s.candidateCount} địa điểm chờ bạn chọn`), chạm → `router.push({ pathname: '/share-import/[id]', params: { id: s.id } })`.
- `SavedRow`: nếu `item.shareSource`, dòng meta thành `${CATEGORY_LABELS[item.category]} · Từ ${PLATFORM_LABELS[item.shareSource.platform]}`.
- Trạng thái rỗng: thêm một câu gợi ý "Hoặc chia sẻ video, bài viết từ TikTok, Facebook… vào Rong."

- [ ] **Step 3: Kiểm tra**

Run: `pnpm --filter @rong/mobile typecheck && pnpm --filter @rong/mobile lint`
Expected: sạch. Thử tay: chia sẻ một link rồi bấm quay lại ngay → tab "Muốn đi" có mục "Đang nhận diện…"; kéo làm mới sau vài giây → "N địa điểm chờ bạn chọn"; lưu xong → mục biến mất, địa điểm có nhãn "Từ YouTube".

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src
git commit -m "feat(mobile): show pending share imports and share source in wishlist"
```

---

## Cuối cùng

- [ ] Chạy toàn bộ từ gốc repo: `pnpm build && pnpm lint && pnpm typecheck && pnpm test`, và trong `apps/backend`: `pnpm test:e2e`. Mọi thứ phải qua; báo lại nguyên văn nếu có gì lỗi.
- [ ] Build EAS dev cho Android (`eas build --profile development --platform android`) chỉ khi người dùng đồng ý — tốn lượt build.
