# Địa điểm từ bài viết + Google, bỏ OSM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Danh sách địa điểm của mỗi vùng lấy từ bài viết trên web (Tavily + Gemini), ghép Google Places để lấy `place_id` + tọa độ, lưu vào `places` để chọn và lập lịch được; bỏ OSM cho địa điểm; tìm thêm địa điểm Google ngay trong form tạo và màn sửa lịch trình.

**Architecture:** Pipeline v2 hiện có (`langchain/place-search.service.ts` + `web-grounding.ts`) được giữ, nhưng thay Geocoding bằng `GooglePlacesService.findPlace` (Text Search có kiểm tra tên/loại) và **lưu kết quả** thành dòng `places.source = 'web'` cộng bảng `region_places` / `region_place_lists`. `GET /regions/:id/places` đọc danh sách đã lưu (chạy pipeline lần đầu, làm mới ở nền khi quá hạn). Lập lịch, "Đổi điểm tương tự", tìm theo tên và share-to-app đọc danh sách này thay cho dòng OSM. Tọa độ Google hết hạn được nhận diện bằng cột mới `location_source = 'google'` thay vì `source = 'google'`.

**Tech Stack:** NestJS 12, TypeORM (raw SQL), Postgres + PostGIS + pg_trgm/unaccent, vitest, Expo / React Native, `@rong/shared-types`.

**Spec:** `docs/superpowers/specs/2026-10-14-web-places-design.md`

## Global Constraints

- ESM: import tương đối kết thúc bằng `.js`.
- Comment, log, thông báo lỗi bằng tiếng Việt.
- Lỗi trả `{ statusCode, code, message }`; client và test so theo `code`.
- Schema chỉ đổi qua migration viết tay trong `apps/backend/src/database/migrations/`.
- PRD 7.4: chỉ lưu `google_place_id` (vô thời hạn) và tọa độ Google tối đa 30 ngày (`GOOGLE_LOCATION_TTL_DAYS`). Tên, loại, giờ, rating Google **không** được lưu. `displayName` / `primaryType` lấy về chỉ để kiểm tra trong request.
- Tên địa điểm `web` lấy từ bài viết (Gemini trích); tên dòng `google` là tên người dùng xác nhận.
- Mọi gọi Google đi qua `modules/google/GooglePlacesService`.
- Đổi `packages/shared-types` thì chạy `pnpm --filter @rong/backend build:deps` trước khi `vitest` / `tsc` trực tiếp.
- e2e phải dựng lại prefix `api` và `ValidationPipe` (copy `beforeAll` của spec có sẵn); không bật `PLACES_WARMUP`.
- Mobile: màn mới bọc `<Screen>`; danh sách trong sheet dùng `FlatList`/`ScrollView` của `react-native-gesture-handler`; form dài có `keyboardShouldPersistTaps="handled"`.
- Ngưỡng ghép tên ban đầu `0.5`; hạn danh sách `WEB_PLACES_REFRESH_DAYS` mặc định 30; chờ lần đầu `WEB_PLACES_WAIT_MS` mặc định 25000.

## Review Focus

1. **Hai request cùng lúc cho một vùng chưa có danh sách** → chỉ một lượt Tavily/Gemini chạy, cả hai nhận cùng kết quả (test ở Task 5).
2. **Pipeline lỗi khi vùng đã có danh sách cũ** → vẫn trả danh sách cũ, không 503, `region_place_lists.status` giữ `ready` (test ở Task 5).
3. **Kết quả Google trùng `place_id` với một dòng người dùng đã lưu (`source = 'google'`)** → dùng lại dòng đó, không tạo dòng thứ hai, không đổi tên (test ở Task 4).
4. **Làm mới danh sách khi đã có dòng tọa độ AI cùng tên** → không tạo dòng trùng; nếu lần này ghép được Google thì nâng cấp chính dòng đó (test ở Task 4).
5. **Lịch trình cũ tham chiếu dòng `osm`** → `GET /itineraries/:id` và `GET /places/:id` vẫn chạy sau khi gỡ OSM (test ở Task 9).

---

## File Structure

**Backend — tạo mới**
- `src/database/migrations/1759600000000-AddWebPlaces.ts` — cột `location_source`, nguồn `web`, unique index mới, bảng `region_place_lists`, `region_places`.
- `src/modules/places/web-place-match.ts` — hàm thuần: độ giống tên, loại Google có mâu thuẫn danh mục không, chọn kết quả Google.
- `src/modules/places/region-place-store.ts` — `RegionPlaceStore`: đọc/ghi `region_place_lists`, `region_places`, upsert dòng `web`.
- `src/modules/places/web-places.service.ts` — `WebPlacesService`: chạy pipeline cho một vùng, gộp request, làm mới nền, trả `PlacesPage`.
- `scripts/generate-province-bboxes.ts` — chạy một lần, sinh `regions/seed/province-bboxes.ts`.
- `src/modules/regions/seed/province-bboxes.ts` — khung bao tỉnh cũ / tỉnh mới không sáp nhập (sinh ra).
- `test/web-places.e2e-spec.ts`.

**Backend — sửa**
- `src/modules/places/entities/place.entity.ts`, `google-place-rows.service.ts`, `place-location.service.ts`, `google-location-janitor.ts`, `places.controller.ts`, `places.module.ts`, `places.service.ts` (chỉ còn chi tiết), `place-search.service.ts`, `catalog-match.ts`, `dto/save-google-place.dto.ts`, `dto/list-places.dto.ts`.
- `src/modules/google/google-places.service.ts` — `findPlace`, `searchByName` thêm `primaryType`.
- `src/langchain/place-search.service.ts` — nhiều địa điểm hơn, có lưu trú.
- `src/modules/itineraries/itineraries.service.ts`, `google-coordinates.ts`, `planning/snapshot.ts`, `planning/planning.types.ts`.
- `src/modules/share-import/share-imports.service.ts`.
- `src/modules/regions/region-area.service.ts`, `region-seeder.ts`.
- `src/modules/open-data/open-data.service.ts`, `src/config/configuration.ts`, `.env.example`.

**Backend — xóa**
- `places/places-v2.controller.ts`, `places-v2.service.ts`, `places-v2.service.spec.ts`, `places-warmer.ts`, `places-warmer.spec.ts`, `place-scoring.ts`, `osm-place-mapping.ts`, `ai-fallback.ts`, `ai-fallback.spec.ts`, `cursor.spec.ts` (và `cursor.ts` nếu có), `test/places-source.e2e-spec.ts`, `test/places-speed.e2e-spec.ts`.

**Shared types:** `packages/shared-types/src/place.ts`, `itinerary.ts`.

**Mobile — tạo mới**
- `src/components/ui/approximate-location.tsx` — nhãn + giải thích "Vị trí gần đúng".
- `src/components/place-picker.tsx` — ô tìm + danh sách chọn địa điểm (không phải FlatList) cho form và màn sửa.
- `src/hooks/use-add-google-place.ts` — biến kết quả Google thành `id`.

**Mobile — sửa**
- `src/hooks/use-region-places.ts`, `src/app/(app)/region/[id].tsx`, `src/components/ui/place-row.tsx`, `src/components/region-map.tsx`, `src/app/(app)/place/[id].tsx`, `src/app/(app)/itinerary/[id].tsx`, `src/app/(app)/itinerary/new.tsx`, `src/components/itinerary-editor.tsx`, `src/components/place-search-results.tsx`.

**Tài liệu:** `apps/backend/src/modules/README.md`, `CLAUDE.md`, `docs/PRD-Rong.md`.

---

### Task 1: Shared types — hợp đồng mới (bổ sung, chưa xóa)

Chỉ **thêm** trường / kiểu để backend và mobile cũ vẫn biên dịch. Task 13 xóa phần cũ.

**Files:**
- Modify: `packages/shared-types/src/place.ts`
- Modify: `packages/shared-types/src/itinerary.ts`

**Interfaces:**
- Produces: `LocationSource`, `PlacesPage.status`, `PlacesPage.sources`, `PlaceListItem.googlePlaceId`, `PlaceListItem.locationSource` (mở rộng), `GooglePlaceHit.suggestedCategory`, `SaveGooglePlaceRequest.addToSaved`, `ItineraryPlaceSnapshot.locationSource`, `PlaceListSource` có `'web'`.

- [ ] **Step 1: Sửa `place.ts`**

Thêm ngay sau `ArticleSource`:

```ts
/**
 * Tọa độ của một địa điểm lấy từ đâu:
 * - `google`: ghép được với Google Places (hạn 30 ngày, PRD 7.4).
 * - `ai`: không tìm thấy trên Google Maps; AI ước đoán từ bài viết — chỉ gần đúng.
 * - `osm`: dòng danh mục OSM cũ (không còn được liệt kê).
 */
export type LocationSource = 'google' | 'ai' | 'osm';
```

Trong `PlaceListItem` thay khối `locationSource` / `articles` bằng:

```ts
  /**
   * Tọa độ lấy từ đâu. Giá trị `catalog` / `geocoding` là của API v2 cũ, bỏ ở
   * bản sau; danh sách mới chỉ trả `google` hoặc `ai`.
   */
  locationSource?: LocationSource | 'catalog' | 'geocoding';
  /** Các bài viết có nhắc tới địa điểm này. */
  articles?: ArticleSource[];
  /** Có khi đã ghép được với Google Places. */
  googlePlaceId?: string | null;
```

Trong `GooglePlaceHit` thêm:

```ts
  /** Loại gợi ý từ `primaryType` của Google — chỉ để điền sẵn, không lưu. */
  suggestedCategory: PlaceCategory;
```

Trong `SaveGooglePlaceRequest` thêm:

```ts
  /** false: chỉ tạo/lấy địa điểm để đưa vào lịch trình, không thêm vào "Muốn đi". Mặc định true. */
  addToSaved?: boolean;
```

Đổi `PlaceListSource` và `PlacesPage`:

```ts
/**
 * - `web`: tổng hợp từ bài viết trên web (AI), định vị bằng Google Places.
 * Các giá trị còn lại thuộc pipeline cũ, bỏ ở bản sau.
 */
export type PlaceListSource = 'web' | 'catalog' | 'ai_google_maps' | 'ai_web_search';

export interface PlacesPage {
  /** `building`: vùng chưa có danh sách và đang tổng hợp — hỏi lại sau vài giây. */
  status?: 'ready' | 'building';
  items: PlaceListItem[];
  nextCursor: string | null;
  attribution: string;
  source: PlaceListSource;
  /** Các bài viết mà danh sách dựa vào. */
  sources?: ArticleSource[];
  groundingSources?: Array<{ title: string; uri: string; publishedAt?: string | null }>;
}
```

- [ ] **Step 2: Sửa `itinerary.ts`**

Trong `ItineraryPlaceSnapshot` thêm (import `LocationSource` từ `./place`):

```ts
  /** `ai`: vị trí do AI ước đoán, thời gian di chuyển tới đây chỉ là ước tính. Thiếu = không rõ (lịch trình cũ). */
  locationSource?: LocationSource;
```

- [ ] **Step 3: Build và typecheck toàn repo**

Run: `pnpm --filter @rong/shared-types build && pnpm typecheck`
Expected: PASS (chỉ thêm trường). Nếu `GooglePlaceHit.suggestedCategory` làm lỗi chỗ tạo `GooglePlaceHit` trong backend (`google-places.service.ts#searchByName`, test e2e), tạm thêm `suggestedCategory: 'check_in'` ở đó — Task 7 làm đúng.

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types apps/backend
git commit -m "feat(shared-types): describe web places, location source and add-without-saving"
```

---

### Task 2: Migration `AddWebPlaces` + tọa độ Google theo `location_source`

**Files:**
- Create: `apps/backend/src/database/migrations/1759600000000-AddWebPlaces.ts`
- Modify: `apps/backend/src/modules/places/entities/place.entity.ts`
- Modify: `apps/backend/src/modules/places/google-place-rows.service.ts`
- Modify: `apps/backend/src/modules/places/place-location.service.ts`
- Modify: `apps/backend/src/modules/places/google-location-janitor.ts`
- Modify: `apps/backend/src/modules/itineraries/google-coordinates.ts`
- Modify: `apps/backend/src/modules/itineraries/itineraries.service.ts` (`PLACE_SELECT`, `toCandidate`)
- Test: `apps/backend/test/web-places.e2e-spec.ts` (tạo file, phần "lưu trữ")

**Interfaces:**
- Produces: cột `places.location_source text NOT NULL DEFAULT 'osm'` (`'osm' | 'google' | 'ai'`); `places.source` thêm `'web'`; index `uq_place_google` = `(google_place_id) WHERE source IN ('google','web')`; bảng `region_place_lists(region_id uuid PK, status text, fetched_at timestamptz, expires_at timestamptz, error_code text, sources jsonb)`; bảng `region_places(region_id uuid, place_id uuid, rank smallint, articles jsonb, PK(region_id, place_id))`.
- Mọi chỗ "tọa độ Google hết hạn" dùng `location_source = 'google'`.

- [ ] **Step 1: Viết migration**

```ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Danh sách địa điểm từ bài viết (spec 2026-10-14-web-places):
 * - `places.source = 'web'`: tên từ bài viết, `google_place_id` khi ghép được.
 * - `location_source`: tọa độ từ OSM, Google (hạn 30 ngày) hay AI ước đoán.
 *   Thay cho việc suy ra "tọa độ Google" từ `source = 'google'`.
 * - Một `google_place_id` chỉ một dòng, dù nguồn `google` hay `web`.
 * - `region_place_lists` / `region_places`: danh sách đã tổng hợp của mỗi vùng.
 */
export class AddWebPlaces1759600000000 implements MigrationInterface {
  name = 'AddWebPlaces1759600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "places" ADD COLUMN "location_source" text NOT NULL DEFAULT 'osm'`,
    );
    await queryRunner.query(
      `UPDATE "places" SET "location_source" = 'google' WHERE "source" = 'google'`,
    );
    await queryRunner.query(`
      ALTER TABLE "places"
        ADD CONSTRAINT "chk_place_location_source" CHECK ("location_source" IN ('osm', 'google', 'ai')),
        DROP CONSTRAINT "chk_place_source",
        ADD CONSTRAINT "chk_place_source" CHECK (
          ("source" = 'osm' AND "osm_type" IS NOT NULL AND "osm_id" IS NOT NULL AND "location" IS NOT NULL)
          OR ("source" = 'google' AND "google_place_id" IS NOT NULL AND "location_source" = 'google')
          OR ("source" = 'web' AND (
                ("location_source" = 'google' AND "google_place_id" IS NOT NULL)
             OR ("location_source" = 'ai' AND "google_place_id" IS NULL AND "location" IS NOT NULL)))
        )
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_place_google"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_place_google" ON "places" ("google_place_id") WHERE "source" IN ('google', 'web')`,
    );
    await queryRunner.query(`
      CREATE TABLE "region_place_lists" (
        "region_id" uuid PRIMARY KEY REFERENCES "regions"("id") ON DELETE CASCADE,
        "status" text NOT NULL CHECK ("status" IN ('ready', 'building', 'failed')),
        "fetched_at" timestamptz,
        "expires_at" timestamptz,
        "error_code" text,
        "sources" jsonb NOT NULL DEFAULT '[]'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "region_places" (
        "region_id" uuid NOT NULL REFERENCES "regions"("id") ON DELETE CASCADE,
        "place_id" uuid NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
        "rank" smallint NOT NULL,
        "articles" jsonb NOT NULL DEFAULT '[]',
        PRIMARY KEY ("region_id", "place_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_region_places_rank" ON "region_places" ("region_id", "rank")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "region_places"`);
    await queryRunner.query(`DROP TABLE "region_place_lists"`);
    await queryRunner.query(`DELETE FROM "places" WHERE "source" = 'web'`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_place_google"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_place_google" ON "places" ("google_place_id") WHERE "source" = 'google'`,
    );
    await queryRunner.query(`
      ALTER TABLE "places"
        DROP CONSTRAINT "chk_place_source",
        ADD CONSTRAINT "chk_place_source" CHECK (
          ("source" = 'osm' AND "osm_type" IS NOT NULL AND "osm_id" IS NOT NULL AND "location" IS NOT NULL)
          OR ("source" = 'google' AND "google_place_id" IS NOT NULL)
        ),
        DROP CONSTRAINT "chk_place_location_source",
        DROP COLUMN "location_source"
    `);
  }
}
```

- [ ] **Step 2: Chạy migration**

Run: `cd apps/backend && pnpm migration:run`
Expected: `Migration AddWebPlaces1759600000000 has been executed successfully.`

- [ ] **Step 3: Viết test e2e thất bại (lưu trữ + làm mới tọa độ)**

Tạo `apps/backend/test/web-places.e2e-spec.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { GooglePlacesService } from '../src/modules/google/google-places.service.js';
import { GoogleLocationJanitor } from '../src/modules/places/google-location-janitor.js';
import { PlaceLocationService } from '../src/modules/places/place-location.service.js';

/** Dòng `web` của danh sách địa điểm từ bài viết (spec 2026-10-14). */
describe('Địa điểm từ bài viết (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;

  const google = {
    enabled: true,
    findPlace: vi.fn(),
    locate: vi.fn(),
    searchByName: vi.fn(async () => []),
    searchText: vi.fn(async () => []),
    details: vi.fn(async () => null),
    preview: vi.fn(),
    summary: vi.fn(async () => null),
    geocode: vi.fn(async () => null),
    matchPlaceId: vi.fn(async () => null),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GooglePlacesService)
      .useValue(google)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await db?.query(`DELETE FROM places WHERE name LIKE 'E2E wp %'`);
    await app?.close();
  });

  beforeEach(() => vi.clearAllMocks());

  const webRow = async (
    name: string,
    googlePlaceId: string | null,
    expiresInDays: number | null,
  ): Promise<string> => {
    const [row] = (await db.query(
      `INSERT INTO places (source, name, category, google_place_id, location, location_source,
                           location_expires_at, composite_score)
       VALUES ('web', $1, 'nature', $2, ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326), $3,
               CASE WHEN $4::int IS NULL THEN NULL ELSE now() + make_interval(days => $4::int) END, 0)
       RETURNING id`,
      [name, googlePlaceId, googlePlaceId ? 'google' : 'ai', expiresInDays],
    )) as Array<{ id: string }>;
    return row.id;
  };

  describe('lưu trữ', () => {
    it('janitor xóa tọa độ Google quá hạn của dòng web, giữ tọa độ AI', async () => {
      const expired = await webRow('E2E wp hết hạn', 'wp-expired', -1);
      const ai = await webRow('E2E wp AI', null, null);

      await app.get(GoogleLocationJanitor).sweep();

      const rows = (await db.query(
        `SELECT id, location IS NULL AS gone FROM places WHERE id = ANY($1::uuid[])`,
        [[expired, ai]],
      )) as Array<{ id: string; gone: boolean }>;
      expect(rows.find((r) => r.id === expired)!.gone).toBe(true);
      expect(rows.find((r) => r.id === ai)!.gone).toBe(false);
    });

    it('ensure lấy lại tọa độ Google cho dòng web đã hết hạn', async () => {
      const id = await webRow('E2E wp làm mới', 'wp-refresh', -1);
      google.locate.mockResolvedValueOnce({ lat: 11.95, lng: 108.45 });

      await expect(app.get(PlaceLocationService).ensure([id])).resolves.toEqual([]);

      expect(google.locate).toHaveBeenCalledWith('wp-refresh');
      const [row] = (await db.query(
        `SELECT ST_Y(location) AS lat, location_expires_at > now() AS fresh FROM places WHERE id = $1`,
        [id],
      )) as Array<{ lat: number; fresh: boolean }>;
      expect(Number(row.lat)).toBeCloseTo(11.95);
      expect(row.fresh).toBe(true);
    });

    it('không cho hai dòng web/google trùng place_id', async () => {
      await webRow('E2E wp trùng 1', 'wp-dup', 30);
      await expect(webRow('E2E wp trùng 2', 'wp-dup', 30)).rejects.toThrow(/uq_place_google/);
    });
  });
});
```

- [ ] **Step 4: Chạy để thấy thất bại**

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/web-places.e2e-spec.ts`
Expected: FAIL — test janitor (janitor chỉ quét `source = 'google'`) và test `ensure` (`ensure` chỉ chọn `source = 'google'`). Test trùng `place_id` đã PASS nhờ migration.

- [ ] **Step 5: Đổi điều kiện sang `location_source`**

`place-location.service.ts`, trong `ensure`:

```ts
      `SELECT id, google_place_id FROM places
        WHERE id = ANY($1::uuid[]) AND location_source = 'google'
          AND (location IS NULL OR location_expires_at <= now())`,
```

Comment lớp đổi thành: `Dòng có tọa độ Google (nguồn \`google\` hoặc \`web\`) mất tọa độ sau 30 ngày.`

`google-location-janitor.ts`, trong `sweep`:

```ts
      `UPDATE places SET location = NULL, location_expires_at = NULL
        WHERE location_source = 'google' AND location_expires_at <= now()`,
```

`itineraries/google-coordinates.ts`: `WHERE id = ANY($1::uuid[]) AND location_source = 'google'`.

`google-place-rows.service.ts`: thêm `location_source` vào INSERT và đổi đích ON CONFLICT cho khớp index mới:

```ts
      `INSERT INTO places (source, google_place_id, name, category, location, location_source, location_expires_at, composite_score)
       VALUES ('google', $1, $2, $3::place_category, ST_SetSRID(ST_MakePoint($4::float8, $5::float8), 4326), 'google',
               $7::timestamptz + make_interval(days => $6::int), 0)
       ON CONFLICT (google_place_id) WHERE source IN ('google', 'web')
       DO UPDATE SET
```

(giữ nguyên phần `DO UPDATE SET … RETURNING id`). Comment lớp thêm: `Trùng place_id với một dòng \`web\` thì dùng lại dòng đó.`

`itineraries.service.ts`: `PLACE_SELECT` thêm `p.location_source`; interface `PlaceRow` thêm `location_source: 'osm' | 'google' | 'ai';`; `toCandidate`:

```ts
    isGoogle: row.location_source === 'google',
```

`entities/place.entity.ts`: sửa union `source` và thêm cột:

```ts
  /** 'osm' (cũ, không còn liệt kê) | 'google' (người dùng lưu) | 'web' (từ bài viết). */
  @Column({ name: 'source', type: 'text', default: 'osm' })
  source!: 'osm' | 'google' | 'web';

  /** Tọa độ từ đâu: Google (hạn `location_expires_at`), AI ước đoán, hay OSM. */
  @Column({ name: 'location_source', type: 'text', default: 'osm' })
  locationSource!: 'osm' | 'google' | 'ai';
```

- [ ] **Step 6: Chạy lại test**

Run: `npx vitest run --config vitest.config.e2e.ts test/web-places.e2e-spec.ts test/share-imports.e2e-spec.ts test/place-search.e2e-spec.ts test/itinerary.e2e-spec.ts`
Expected: PASS hết (các spec cũ vẫn chạy vì dòng `google` đã có `location_source = 'google'`).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src apps/backend/test/web-places.e2e-spec.ts
git commit -m "feat(backend): add web place rows and track where coordinates come from"
```

---

### Task 3: Ghép Google — `findPlace` + bộ chọn thuần

**Files:**
- Create: `apps/backend/src/modules/places/web-place-match.ts`
- Create: `apps/backend/src/modules/places/web-place-match.spec.ts`
- Modify: `apps/backend/src/modules/google/google-places.service.ts`
- Test: `apps/backend/src/modules/google/google-places.service.spec.ts`

**Interfaces:**
- Produces:
  - `GooglePlacesService.findPlace(query: string, bbox: Bbox, timeoutMs?: number): Promise<GoogleCandidate[]>` với `export type GoogleCandidate = { placeId: string; lat: number; lng: number; name: string | null; primaryType: string | null }`.
  - `nameSimilarity(a: string, b: string): number` (0–1).
  - `pickGoogleMatch(name: string, category: PlaceCategory, candidates: GoogleCandidate[], minSimilarity = MATCH_MIN_SIMILARITY): GoogleCandidate | null`.
  - `export const MATCH_MIN_SIMILARITY = 0.5`.

- [ ] **Step 1: Viết test thất bại cho bộ chọn**

`web-place-match.spec.ts`:

```ts
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
```

- [ ] **Step 2: Chạy để thấy thất bại**

Run: `cd apps/backend && npx vitest run src/modules/places/web-place-match.spec.ts`
Expected: FAIL — `Cannot find module './web-place-match.js'`.

- [ ] **Step 3: Viết `web-place-match.ts`**

```ts
import type { PlaceCategory } from '@rong/shared-types';

import type { GoogleCandidate } from '../google/google-places.service.js';
import { foldText } from '../regions/search-text.js';
import { categoryFromGoogleType } from './google-category.js';

/** Độ giống tên tối thiểu để nhận một kết quả Google; chỉnh theo `pnpm bench:places`. */
export const MATCH_MIN_SIMILARITY = 0.5;

/**
 * Độ giống tên 0–1: bỏ dấu, chữ thường; một tên chứa trọn tên kia (theo từ)
 * thì 1 ("Quán cơm Linh" ~ "Quán cơm Linh Đà Lạt"); còn lại hệ số Dice trên
 * cặp ký tự.
 */
export function nameSimilarity(a: string, b: string): number {
  const x = foldText(a);
  const y = foldText(b);
  if (!x || !y) return 0;
  if (x === y || ` ${y} `.includes(` ${x} `) || ` ${x} `.includes(` ${y} `)) return 1;
  const pairs = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const p = s.slice(i, i + 2);
      out.set(p, (out.get(p) ?? 0) + 1);
    }
    return out;
  };
  const px = pairs(x);
  const py = pairs(y);
  let common = 0;
  for (const [p, n] of px) common += Math.min(n, py.get(p) ?? 0);
  return (2 * common) / (x.length - 1 + (y.length - 1));
}

/**
 * Loại Google có mâu thuẫn với danh mục AI trích từ bài viết không. Chỉ loại
 * những cặp chắc chắn sai: lưu trú ↔ không lưu trú, ăn uống/cà phê ↔ tham quan.
 * Loại Google không suy ra được gì (`check_in`) thì không mâu thuẫn.
 */
function conflicts(category: PlaceCategory, primaryType: string | null): boolean {
  const google = categoryFromGoogleType(primaryType);
  if ((category === 'stay') !== (google === 'stay')) return true;
  if (google === 'check_in') return false;
  const eating = (c: PlaceCategory) => c === 'food' || c === 'cafe' || c === 'nightlife';
  return eating(category) !== eating(google);
}

/** Kết quả Google đầu tiên (theo thứ tự Google) đủ giống tên và không mâu thuẫn loại. */
export function pickGoogleMatch(
  name: string,
  category: PlaceCategory,
  candidates: GoogleCandidate[],
  minSimilarity = MATCH_MIN_SIMILARITY,
): GoogleCandidate | null {
  return (
    candidates.find(
      (c) =>
        c.name !== null &&
        nameSimilarity(name, c.name) >= minSimilarity &&
        !conflicts(category, c.primaryType),
    ) ?? null
  );
}
```

- [ ] **Step 4: Viết test thất bại cho `findPlace`**

Thêm vào `google-places.service.spec.ts`:

```ts
describe('GooglePlacesService.findPlace', () => {
  it('Text Search giới hạn trong khung vùng, chỉ xin id/vị trí/tên/loại', async () => {
    const calls = mockFetch(() => ({
      body: {
        places: [
          {
            id: 'ChIJ1',
            location: { latitude: 11.9, longitude: 108.4 },
            displayName: { text: 'Thác Datanla' },
            primaryType: 'tourist_attraction',
          },
          { id: 'ChIJ2' },
        ],
      },
    }));

    await expect(
      service().findPlace('Thác Datanla, Đà Lạt', [11.8, 108.3, 12.0, 108.6]),
    ).resolves.toEqual([
      { placeId: 'ChIJ1', lat: 11.9, lng: 108.4, name: 'Thác Datanla', primaryType: 'tourist_attraction' },
    ]);

    const [call] = calls;
    expect(call.url).toBe(`${BASE}/places:searchText`);
    expect(header(call, 'X-Goog-FieldMask')).toBe(
      'places.id,places.location,places.displayName,places.primaryType',
    );
    const body = JSON.parse(call.init.body as string);
    expect(body).toMatchObject({
      textQuery: 'Thác Datanla, Đà Lạt',
      pageSize: 3,
      locationRestriction: {
        rectangle: { low: { latitude: 11.8, longitude: 108.3 }, high: { latitude: 12.0, longitude: 108.6 } },
      },
    });
  });

  it('Google lỗi thì ném GoogleUnavailableError', async () => {
    mockFetch(() => ({ status: 500, body: {} }));
    await expect(service().findPlace('x', [1, 2, 3, 4])).rejects.toBeInstanceOf(GoogleUnavailableError);
  });
});
```

- [ ] **Step 5: Chạy để thấy thất bại**

Run: `npx vitest run src/modules/google/google-places.service.spec.ts -t findPlace`
Expected: FAIL — `service(...).findPlace is not a function`.

- [ ] **Step 6: Thêm `findPlace`**

Trong `google-places.service.ts`, sau `export type GoogleHit …` thêm:

```ts
/** Một kết quả Text Search để ghép tên từ bài viết. `name`/`primaryType` chỉ để kiểm tra, không lưu (PRD 7.4). */
export type GoogleCandidate = GoogleHit & {
  name: string | null;
  primaryType: string | null;
};
```

Sửa `request` để nhận timeout: thêm `timeoutMs?: number` vào `options` và dùng `signal: AbortSignal.timeout(options.timeoutMs ?? 10_000)`.

Thêm phương thức sau `searchText`:

```ts
  /**
   * Ghép một địa điểm đọc từ bài viết: Text Search trong khung vùng, tối đa 3
   * kết quả theo thứ tự Google. Tên và loại Google chỉ để bên gọi kiểm tra
   * (web-place-match.ts) rồi bỏ; chỉ place_id và tọa độ được lưu.
   */
  async findPlace(
    query: string,
    bbox: Bbox,
    timeoutMs = 4000,
  ): Promise<GoogleCandidate[]> {
    const body = await this.request<{
      places?: Array<{
        id: string;
        location?: { latitude: number; longitude: number };
        displayName?: { text?: string };
        primaryType?: string;
      }>;
    }>('/places:searchText', {
      method: 'POST',
      fieldMask: 'places.id,places.location,places.displayName,places.primaryType',
      timeoutMs,
      body: {
        textQuery: query,
        languageCode: 'vi',
        regionCode: 'VN',
        pageSize: 3,
        locationRestriction: {
          rectangle: {
            low: { latitude: bbox[0], longitude: bbox[1] },
            high: { latitude: bbox[2], longitude: bbox[3] },
          },
        },
      },
    });
    return (body.places ?? []).flatMap((p) =>
      p.location
        ? [
            {
              placeId: p.id,
              lat: p.location.latitude,
              lng: p.location.longitude,
              name: p.displayName?.text ?? null,
              primaryType: p.primaryType ?? null,
            },
          ]
        : [],
    );
  }
```

- [ ] **Step 7: Chạy test**

Run: `npx vitest run src/modules/places/web-place-match.spec.ts src/modules/google/google-places.service.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/modules/places/web-place-match* apps/backend/src/modules/google
git commit -m "feat(backend): match places from articles to Google by name and type"
```

---

### Task 4: `RegionPlaceStore` — lưu danh sách của vùng

**Files:**
- Create: `apps/backend/src/modules/places/region-place-store.ts`
- Modify: `apps/backend/src/modules/places/places.module.ts` (thêm provider)
- Test: `apps/backend/test/web-places.e2e-spec.ts` (describe "RegionPlaceStore")

**Interfaces:**
- Consumes: `GOOGLE_LOCATION_TTL_DAYS` (`place-location.service.ts`), `searchKey` (`regions/search-text.ts`).
- Produces:

```ts
export interface WebPlaceInput {
  name: string;
  category: PlaceCategory;
  description: string | null;
  /** "HH:mm-HH:mm" (cú pháp opening_hours OSM hợp lệ), null nếu không rõ. */
  openingHours: string | null;
  articles: ArticleSource[];
  location:
    | { source: 'google'; placeId: string; lat: number; lng: number }
    | { source: 'ai'; lat: number; lng: number };
}
export type ListState = { status: 'ready' | 'building' | 'failed'; expiresAt: Date | null; sources: ArticleSource[] } | null;
class RegionPlaceStore {
  state(regionId: string): Promise<ListState>;
  markBuilding(regionId: string): Promise<void>;
  markFailed(regionId: string, code: string): Promise<void>;
  /** Thay toàn bộ danh sách của vùng; thứ tự mảng là thứ hạng. Trả id theo đúng thứ tự. */
  replace(regionId: string, places: WebPlaceInput[], sources: ArticleSource[], refreshDays: number): Promise<string[]>;
  list(regionId: string, categories: PlaceCategory[] | null): Promise<StoredPlaceRow[]>;
}
export interface StoredPlaceRow {
  id: string; name: string; category: PlaceCategory; description: string | null;
  lat: number | null; lng: number | null; location_source: 'google' | 'ai' | 'osm';
  google_place_id: string | null; opening_hours: string | null; rank: number; articles: ArticleSource[];
}
```

- [ ] **Step 1: Viết test thất bại**

Thêm vào `web-places.e2e-spec.ts` (thêm import `RegionPlaceStore` từ `../src/modules/places/region-place-store.js`; trong `beforeAll` lấy `daLat` như sau):

```ts
  let daLat: string;
  // trong beforeAll, sau db = app.get(DataSource):
  [{ id: daLat }] = (await db.query(
    `SELECT id FROM regions WHERE source_key = 'vn:destination:da-lat'`,
  )) as Array<{ id: string }>;
  // trong afterAll, trước khi xóa places:
  await db?.query(`DELETE FROM region_place_lists WHERE region_id = $1`, [daLat]);
  await db?.query(`DELETE FROM region_places WHERE region_id = $1`, [daLat]);
```

```ts
  describe('RegionPlaceStore', () => {
    const article = { title: 'Bài A', uri: 'https://a.test/1', publishedAt: null };
    const input = (name: string, location: WebPlaceInput['location']): WebPlaceInput => ({
      name,
      category: 'nature',
      description: 'Mô tả',
      openingHours: '07:00-17:00',
      articles: [article],
      location,
    });

    beforeEach(async () => {
      await db.query(`DELETE FROM region_places WHERE region_id = $1`, [daLat]);
      await db.query(`DELETE FROM region_place_lists WHERE region_id = $1`, [daLat]);
    });

    it('lưu danh sách theo thứ tự, đánh dấu ready và hạn làm mới', async () => {
      const store = app.get(RegionPlaceStore);
      const ids = await store.replace(
        daLat,
        [
          input('E2E wp Thác A', { source: 'google', placeId: 'wp-a', lat: 11.9, lng: 108.44 }),
          input('E2E wp Đồi B', { source: 'ai', lat: 11.92, lng: 108.45 }),
        ],
        [article],
        30,
      );
      expect(ids).toHaveLength(2);

      const rows = await store.list(daLat, null);
      expect(rows.map((r) => [r.name, r.location_source, r.rank])).toEqual([
        ['E2E wp Thác A', 'google', 0],
        ['E2E wp Đồi B', 'ai', 1],
      ]);
      expect(rows[0].opening_hours).toBe('07:00-17:00');
      expect(rows[0].articles).toEqual([article]);
      const state = await store.state(daLat);
      expect(state?.status).toBe('ready');
      expect(state!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    });

    it('trùng place_id với dòng người dùng đã lưu thì dùng lại dòng đó, giữ tên', async () => {
      const [saved] = (await db.query(
        `INSERT INTO places (source, google_place_id, name, category, location, location_source, location_expires_at, composite_score)
         VALUES ('google', 'wp-saved', 'E2E wp Tên người dùng', 'food', ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326),
                 'google', now() + interval '30 days', 0)
         RETURNING id`,
      )) as Array<{ id: string }>;

      const [id] = await app.get(RegionPlaceStore).replace(
        daLat,
        [input('E2E wp Tên bài viết', { source: 'google', placeId: 'wp-saved', lat: 11.94, lng: 108.44 })],
        [],
        30,
      );

      expect(id).toBe(saved.id);
      const [row] = (await db.query(`SELECT name FROM places WHERE id = $1`, [id])) as Array<{ name: string }>;
      expect(row.name).toBe('E2E wp Tên người dùng');
    });

    it('làm mới: dòng AI cùng tên được dùng lại, ghép được Google thì nâng cấp chính dòng đó', async () => {
      const store = app.get(RegionPlaceStore);
      const [first] = await store.replace(daLat, [input('E2E wp Hồ C', { source: 'ai', lat: 11.93, lng: 108.43 })], [], 30);
      const [again] = await store.replace(daLat, [input('E2E wp Hồ C', { source: 'ai', lat: 11.93, lng: 108.43 })], [], 30);
      expect(again).toBe(first);

      const [upgraded] = await store.replace(
        daLat,
        [input('E2E wp Hồ C', { source: 'google', placeId: 'wp-c', lat: 11.931, lng: 108.431 })],
        [],
        30,
      );
      expect(upgraded).toBe(first);
      const [row] = (await db.query(
        `SELECT location_source, google_place_id, location_expires_at IS NOT NULL AS expires FROM places WHERE id = $1`,
        [first],
      )) as Array<{ location_source: string; google_place_id: string; expires: boolean }>;
      expect(row).toEqual({ location_source: 'google', google_place_id: 'wp-c', expires: true });
    });

    it('list lọc theo danh mục', async () => {
      const store = app.get(RegionPlaceStore);
      await store.replace(
        daLat,
        [
          input('E2E wp Thác D', { source: 'ai', lat: 11.9, lng: 108.4 }),
          { ...input('E2E wp Quán E', { source: 'ai', lat: 11.9, lng: 108.4 }), category: 'food' },
        ],
        [],
        30,
      );
      expect((await store.list(daLat, ['food'])).map((r) => r.name)).toEqual(['E2E wp Quán E']);
    });
  });
```

- [ ] **Step 2: Chạy để thấy thất bại**

Run: `npx vitest run --config vitest.config.e2e.ts test/web-places.e2e-spec.ts -t RegionPlaceStore`
Expected: FAIL — không tìm thấy module `region-place-store.js`.

- [ ] **Step 3: Viết `region-place-store.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { ArticleSource, PlaceCategory } from '@rong/shared-types';
import { DataSource, type EntityManager } from 'typeorm';

import { searchKey } from '../regions/search-text.js';
import { GOOGLE_LOCATION_TTL_DAYS } from './place-location.service.js';

export interface WebPlaceInput {
  name: string;
  category: PlaceCategory;
  description: string | null;
  /** "HH:mm-HH:mm" (cú pháp opening_hours OSM hợp lệ), null nếu không rõ. */
  openingHours: string | null;
  articles: ArticleSource[];
  location:
    | { source: 'google'; placeId: string; lat: number; lng: number }
    | { source: 'ai'; lat: number; lng: number };
}

export type ListState = {
  status: 'ready' | 'building' | 'failed';
  expiresAt: Date | null;
  sources: ArticleSource[];
} | null;

export interface StoredPlaceRow {
  id: string;
  name: string;
  category: PlaceCategory;
  description: string | null;
  lat: number | null;
  lng: number | null;
  location_source: 'google' | 'ai' | 'osm';
  google_place_id: string | null;
  opening_hours: string | null;
  rank: number;
  articles: ArticleSource[];
}

/**
 * Danh sách địa điểm đã tổng hợp của mỗi vùng (`region_place_lists`,
 * `region_places`) và các dòng `places.source = 'web'` của nó.
 *
 * Mỗi `google_place_id` chỉ một dòng: đã có (người dùng lưu, hoặc vùng khác)
 * thì dùng lại, không đổi tên. Dòng tọa độ AI được nhận lại theo tên (bỏ dấu)
 * trong danh sách cũ của vùng, để làm mới không sinh dòng trùng.
 */
@Injectable()
export class RegionPlaceStore {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async state(regionId: string): Promise<ListState> {
    const [row] = (await this.db.query(
      `SELECT status, expires_at, sources FROM region_place_lists WHERE region_id = $1`,
      [regionId],
    )) as Array<{ status: 'ready' | 'building' | 'failed'; expires_at: Date | null; sources: ArticleSource[] }>;
    return row ? { status: row.status, expiresAt: row.expires_at, sources: row.sources } : null;
  }

  /** Chỉ đánh dấu khi chưa có danh sách: vùng đã `ready` thì giữ nguyên trong lúc làm mới. */
  async markBuilding(regionId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO region_place_lists (region_id, status) VALUES ($1, 'building')
       ON CONFLICT (region_id) DO UPDATE SET status = 'building', error_code = NULL
        WHERE region_place_lists.status <> 'ready'`,
      [regionId],
    );
  }

  /** Lỗi khi đã có danh sách thì giữ `ready` (vẫn phục vụ bản cũ). */
  async markFailed(regionId: string, code: string): Promise<void> {
    await this.db.query(
      `INSERT INTO region_place_lists (region_id, status, error_code) VALUES ($1, 'failed', $2)
       ON CONFLICT (region_id) DO UPDATE
         SET status = CASE WHEN region_place_lists.status = 'ready' THEN 'ready' ELSE 'failed' END,
             error_code = $2`,
      [regionId, code],
    );
  }

  async replace(
    regionId: string,
    places: WebPlaceInput[],
    sources: ArticleSource[],
    refreshDays: number,
  ): Promise<string[]> {
    return this.db.transaction(async (m) => {
      const previous = (await m.query(
        `SELECT p.id, p.name FROM region_places rp JOIN places p ON p.id = rp.place_id
          WHERE rp.region_id = $1 AND p.source = 'web' AND p.location_source = 'ai'`,
        [regionId],
      )) as Array<{ id: string; name: string }>;
      const aiByName = new Map(previous.map((r) => [searchKey(r.name), r.id]));

      const ids: string[] = [];
      for (const place of places) {
        ids.push(await this.upsertPlace(m, place, aiByName.get(searchKey(place.name)) ?? null));
      }

      await m.query(`DELETE FROM region_places WHERE region_id = $1`, [regionId]);
      const seen = new Set<string>();
      for (const [rank, id] of ids.entries()) {
        if (seen.has(id)) continue; // hai tên trong bài cùng ra một place_id
        seen.add(id);
        await m.query(
          `INSERT INTO region_places (region_id, place_id, rank, articles) VALUES ($1, $2, $3, $4::jsonb)`,
          [regionId, id, rank, JSON.stringify(places[rank].articles)],
        );
      }
      await m.query(
        `INSERT INTO region_place_lists (region_id, status, fetched_at, expires_at, error_code, sources)
         VALUES ($1, 'ready', now(), now() + make_interval(days => $2::int), NULL, $3::jsonb)
         ON CONFLICT (region_id) DO UPDATE
           SET status = 'ready', fetched_at = EXCLUDED.fetched_at, expires_at = EXCLUDED.expires_at,
               error_code = NULL, sources = EXCLUDED.sources`,
        [regionId, refreshDays, JSON.stringify(sources)],
      );
      return ids;
    });
  }

  async list(regionId: string, categories: PlaceCategory[] | null): Promise<StoredPlaceRow[]> {
    const rows = (await this.db.query(
      `SELECT p.id, p.name, p.category, p.description, p.location_source, p.google_place_id,
              CASE WHEN p.location_source <> 'google' OR p.location_expires_at > now() THEN ST_Y(p.location) END AS lat,
              CASE WHEN p.location_source <> 'google' OR p.location_expires_at > now() THEN ST_X(p.location) END AS lng,
              p.tags->>'opening_hours' AS opening_hours, rp.rank, rp.articles
         FROM region_places rp JOIN places p ON p.id = rp.place_id
        WHERE rp.region_id = $1
          AND ($2::place_category[] IS NULL OR p.category = ANY($2::place_category[]))
        ORDER BY rp.rank`,
      [regionId, categories],
    )) as StoredPlaceRow[];
    return rows.map((r) => ({
      ...r,
      lat: r.lat === null ? null : Number(r.lat),
      lng: r.lng === null ? null : Number(r.lng),
    }));
  }

  private async upsertPlace(m: EntityManager, place: WebPlaceInput, aiRowId: string | null): Promise<string> {
    const tags = JSON.stringify(place.openingHours ? { opening_hours: place.openingHours } : {});
    const { location } = place;

    if (location.source === 'google') {
      const [existing] = (await m.query(
        `SELECT id FROM places WHERE google_place_id = $1 AND source IN ('google', 'web')`,
        [location.placeId],
      )) as Array<{ id: string }>;
      if (existing) {
        await m.query(
          `UPDATE places SET location = ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326),
                  location_expires_at = now() + make_interval(days => $4::int), updated_at = now()
            WHERE id = $1`,
          [existing.id, location.lng, location.lat, GOOGLE_LOCATION_TTL_DAYS],
        );
        return existing.id;
      }
      if (aiRowId) {
        // Lần trước chưa ghép được, lần này được: nâng cấp chính dòng đó (giữ tham chiếu của lịch trình).
        await m.query(
          `UPDATE places SET google_place_id = $2, location_source = 'google',
                  location = ST_SetSRID(ST_MakePoint($3::float8, $4::float8), 4326),
                  location_expires_at = now() + make_interval(days => $5::int),
                  description = $6, updated_at = now()
            WHERE id = $1`,
          [aiRowId, location.placeId, location.lng, location.lat, GOOGLE_LOCATION_TTL_DAYS, place.description],
        );
        return aiRowId;
      }
      const [row] = (await m.query(
        `INSERT INTO places (source, name, category, description, tags, google_place_id, location, location_source,
                             location_expires_at, composite_score)
         VALUES ('web', $1, $2::place_category, $3, $4::jsonb, $5,
                 ST_SetSRID(ST_MakePoint($6::float8, $7::float8), 4326), 'google',
                 now() + make_interval(days => $8::int), 0)
         RETURNING id`,
        [place.name, place.category, place.description, tags, location.placeId, location.lng, location.lat, GOOGLE_LOCATION_TTL_DAYS],
      )) as Array<{ id: string }>;
      return row.id;
    }

    if (aiRowId) {
      await m.query(
        `UPDATE places SET location = ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326),
                description = $4, tags = $5::jsonb, updated_at = now()
          WHERE id = $1`,
        [aiRowId, location.lng, location.lat, place.description, tags],
      );
      return aiRowId;
    }
    const [row] = (await m.query(
      `INSERT INTO places (source, name, category, description, tags, location, location_source, composite_score)
       VALUES ('web', $1, $2::place_category, $3, $4::jsonb, ST_SetSRID(ST_MakePoint($5::float8, $6::float8), 4326), 'ai', 0)
       RETURNING id`,
      [place.name, place.category, place.description, tags, location.lng, location.lat],
    )) as Array<{ id: string }>;
    return row.id;
  }
}
```

Thêm `RegionPlaceStore` vào `providers` và `exports` của `places.module.ts`.

- [ ] **Step 4: Chạy test**

Run: `npx vitest run --config vitest.config.e2e.ts test/web-places.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/places apps/backend/test/web-places.e2e-spec.ts
git commit -m "feat(backend): store each region's places from articles"
```

---

### Task 5: `WebPlacesService` + `GET /regions/:id/places` mới

**Files:**
- Create: `apps/backend/src/modules/places/web-places.service.ts`
- Modify: `apps/backend/src/langchain/place-search.service.ts`
- Modify: `apps/backend/src/config/configuration.ts`, `apps/backend/.env.example`
- Modify: `apps/backend/src/modules/places/places.controller.ts`, `places.module.ts`, `dto/list-places.dto.ts`
- Delete: `places-v2.controller.ts`, `places-v2.service.ts`, `places-v2.service.spec.ts`
- Test: `apps/backend/test/web-places.e2e-spec.ts` (describe "GET /regions/:id/places")

**Interfaces:**
- Consumes: `RegionPlaceStore` (Task 4), `GooglePlacesService.findPlace` (Task 3), `pickGoogleMatch` (Task 3), `PlaceSearchService` (langchain, alias `AgentPlaceSearch`), `articlesMentioning`, `fetchPublishedDate` (`web-grounding.ts`), `RegionAreaService.ensure`, `PlaceLocationService.ensure`.
- Produces:
  - `WebPlacesService.listForRegion(regionId: string, categories: PlaceCategory[] | undefined): Promise<PlacesPage>`
  - `WebPlacesService.refresh(regionId: string): Promise<void>` (một lượt pipeline, dùng chung khi chạy song song)
  - Config `webPlaces: { refreshDays: number; waitMs: number }` (`AppConfig['webPlaces']`), token DI `WEB_PLACES_CONFIG`.

- [ ] **Step 1: Mở rộng agent tìm địa điểm**

`langchain/place-search.service.ts`:

```ts
/** Số địa điểm tối đa mỗi vùng, gồm cả quán ăn và nơi lưu trú (lập lịch cần đủ quán cho bữa). */
const MAX_PLACES = 40;

const queries = (regionName: string) => [
  `địa điểm tham quan nổi tiếng ${regionName}`,
  `quán ăn ngon ${regionName}`,
  `quán cà phê đẹp ${regionName}`,
  `khách sạn homestay đẹp ${regionName}`,
];
```

Trong `SYSTEM_PROMPT`: đổi "chọn tối đa ${MAX_PLACES} địa điểm" giữ nguyên; **xóa dòng** `- Bỏ khách sạn, homestay.`; thêm dòng `- Có ít nhất 6 quán ăn và 3 nơi lưu trú nếu bài viết có nhắc.`. Trong hàm `request`, đổi danh sách loại thành `điểm tham quan, check-in, thiên nhiên, văn hóa - lịch sử, ăn uống, cà phê, vui chơi, về đêm, lưu trú`.

- [ ] **Step 2: Config**

`configuration.ts`: thêm interface và khối giá trị:

```ts
/** Danh sách địa điểm từ bài viết (spec 2026-10-14-web-places). */
export interface WebPlacesConfig {
  /** Sau bao nhiêu ngày thì tổng hợp lại danh sách của một vùng (khớp hạn tọa độ Google). */
  refreshDays: number;
  /** Lần đầu mở vùng: chờ pipeline tối đa chừng này rồi trả `building`. */
  waitMs: number;
}
```

Trong `AppConfig` thêm `webPlaces: WebPlacesConfig;`, trong `loadConfig` thêm:

```ts
    webPlaces: {
      refreshDays: positiveInt('WEB_PLACES_REFRESH_DAYS', 30),
      waitMs: positiveInt('WEB_PLACES_WAIT_MS', 25000),
    },
```

`.env.example` thêm:

```
# Danh sách địa điểm từ bài viết: làm mới sau N ngày; lần đầu chờ tối đa N ms rồi trả "building".
WEB_PLACES_REFRESH_DAYS=30
WEB_PLACES_WAIT_MS=25000
```

- [ ] **Step 3: Viết test e2e thất bại**

Thêm vào `web-places.e2e-spec.ts`. Override agent và config (thêm vào chuỗi `Test.createTestingModule` trong `beforeAll`):

```ts
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { PlaceSearchService as AgentPlaceSearch } from '../src/langchain/place-search.service.js';
import { WEB_PLACES_CONFIG } from '../src/modules/places/web-places.service.js';

  const agent = { enabled: true, findPlaces: vi.fn() };
  // trong createTestingModule:
      .overrideProvider(AgentPlaceSearch)
      .useValue(agent)
      .overrideProvider(WEB_PLACES_CONFIG)
      .useValue({ refreshDays: 30, waitMs: 2000 })
  // trong beforeAll sau khi có db:
  const [user] = (await db.query(
    `INSERT INTO users (display_name) VALUES ('e2e-web-places') RETURNING id`,
  )) as Array<{ id: string }>;
  token = app.get(JwtService).sign({ sub: user.id });
  // afterAll:
  await db?.query(`DELETE FROM users WHERE display_name = 'e2e-web-places'`);
```

```ts
  describe('GET /regions/:id/places', () => {
    const article = (n: number, body: string) => ({
      title: `Bài ${n}`,
      uri: `https://wp.test/${n}`,
      content: body,
      publishedAt: '2026-01-01',
    });
    const agentPlace = (title: string, category: string) => ({
      title,
      description: `${title} đẹp`,
      address: '',
      location: { lat: 11.94, lng: 108.44 },
      category,
      openHours: { open: '07:00', close: '17:00' },
    });
    const get = (query = '') =>
      request(app.getHttpServer())
        .get(`/api/regions/${daLat}/places${query}`)
        .set('Authorization', `Bearer ${token}`);

    beforeEach(async () => {
      await db.query(`DELETE FROM region_places WHERE region_id = $1`, [daLat]);
      await db.query(`DELETE FROM region_place_lists WHERE region_id = $1`, [daLat]);
      agent.findPlaces.mockReset();
      google.findPlace.mockReset();
    });

    it('lần đầu: chạy pipeline, lưu, trả mục có id; ghép được thì google, không thì ai', async () => {
      agent.findPlaces.mockResolvedValue({
        places: [agentPlace('E2E wp Thác Một', 'nature'), agentPlace('E2E wp Quán Hai', 'food')],
        sources: [article(1, 'Ghé E2E wp Thác Một rồi ăn ở E2E wp Quán Hai.')],
      });
      google.findPlace.mockImplementation(async (query: string) =>
        query.startsWith('E2E wp Thác Một')
          ? [{ placeId: 'wp-g1', lat: 11.9, lng: 108.44, name: 'E2E wp Thác Một', primaryType: 'tourist_attraction' }]
          : [],
      );

      const res = await get('?categories=nature,food').expect(200);

      expect(res.body.status).toBe('ready');
      expect(res.body.source).toBe('web');
      expect(res.body.items.map((i: { name: string; locationSource: string; googlePlaceId: string | null }) =>
        [i.name, i.locationSource, i.googlePlaceId ?? null])).toEqual([
        ['E2E wp Thác Một', 'google', 'wp-g1'],
        ['E2E wp Quán Hai', 'ai', null],
      ]);
      expect(res.body.items.every((i: { id: string }) => typeof i.id === 'string')).toBe(true);
      expect(res.body.items[0].articles[0].uri).toBe('https://wp.test/1');
    });

    it('bỏ địa điểm không có trong bài viết nào', async () => {
      agent.findPlaces.mockResolvedValue({
        places: [agentPlace('E2E wp Có Thật', 'nature'), agentPlace('E2E wp Bịa', 'nature')],
        sources: [article(2, 'Nên đến E2E wp Có Thật.')],
      });
      google.findPlace.mockResolvedValue([]);
      const res = await get().expect(200);
      expect(res.body.items.map((i: { name: string }) => i.name)).toEqual(['E2E wp Có Thật']);
    });

    it('hai request song song chỉ chạy một lượt pipeline', async () => {
      agent.findPlaces.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 300));
        return { places: [agentPlace('E2E wp Song Song', 'nature')], sources: [article(3, 'E2E wp Song Song')] };
      });
      google.findPlace.mockResolvedValue([]);
      const [a, b] = await Promise.all([get().expect(200), get().expect(200)]);
      expect(agent.findPlaces).toHaveBeenCalledTimes(1);
      expect(a.body.items).toHaveLength(1);
      expect(b.body.items).toHaveLength(1);
    });

    it('quá thời gian chờ thì trả building, lần sau có kết quả', async () => {
      agent.findPlaces.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 2500));
        return { places: [agentPlace('E2E wp Chậm', 'nature')], sources: [article(4, 'E2E wp Chậm')] };
      });
      google.findPlace.mockResolvedValue([]);
      const first = await get().expect(200);
      expect(first.body).toMatchObject({ status: 'building', items: [] });
      await new Promise((r) => setTimeout(r, 1000));
      const second = await get().expect(200);
      expect(second.body.status).toBe('ready');
      expect(second.body.items.map((i: { name: string }) => i.name)).toEqual(['E2E wp Chậm']);
    });

    it('pipeline lỗi khi đã có danh sách cũ: vẫn trả danh sách cũ', async () => {
      agent.findPlaces.mockResolvedValueOnce({
        places: [agentPlace('E2E wp Cũ', 'nature')],
        sources: [article(5, 'E2E wp Cũ')],
      });
      google.findPlace.mockResolvedValue([]);
      await get().expect(200);
      await db.query(`UPDATE region_place_lists SET expires_at = now() - interval '1 day' WHERE region_id = $1`, [daLat]);
      agent.findPlaces.mockRejectedValueOnce(new Error('Tavily sập'));

      const res = await get().expect(200);
      expect(res.body.items.map((i: { name: string }) => i.name)).toEqual(['E2E wp Cũ']);
      await new Promise((r) => setTimeout(r, 200)); // làm mới nền chạy xong
      const [state] = (await db.query(`SELECT status FROM region_place_lists WHERE region_id = $1`, [daLat])) as Array<{ status: string }>;
      expect(state.status).toBe('ready');
    });

    it('pipeline lỗi và chưa có gì: 503 PLACES_UNAVAILABLE', async () => {
      agent.findPlaces.mockRejectedValue(new Error('Tavily sập'));
      const res = await get().expect(503);
      expect(res.body.code).toBe('PLACES_UNAVAILABLE');
    });

    it('Google lỗi: mọi địa điểm dùng tọa độ AI, danh sách vẫn lưu', async () => {
      agent.findPlaces.mockResolvedValue({
        places: [agentPlace('E2E wp Không Google', 'nature')],
        sources: [article(6, 'E2E wp Không Google')],
      });
      google.findPlace.mockRejectedValue(new Error('500'));
      const res = await get().expect(200);
      expect(res.body.items[0].locationSource).toBe('ai');
    });

    it('vùng không tồn tại: 404 REGION_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/regions/00000000-0000-4000-8000-000000000000/places')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      expect(res.body.code).toBe('REGION_NOT_FOUND');
    });
  });
```

(Khai báo `let token: string;` ở đầu describe ngoài cùng.)

- [ ] **Step 4: Chạy để thấy thất bại**

Run: `npx vitest run --config vitest.config.e2e.ts test/web-places.e2e-spec.ts -t "GET /regions"`
Expected: FAIL — không có `web-places.service.js`.

- [ ] **Step 5: Viết `web-places.service.ts`**

```ts
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { ArticleSource, PlaceCategory, PlaceListItem, PlacesPage } from '@rong/shared-types';
import { DataSource } from 'typeorm';

import type { WebPlacesConfig } from '../../config/configuration.js';
import type { WebPlacesType } from '../../chat-models/schema.js';
import { PlaceSearchService as AgentPlaceSearch } from '../../langchain/place-search.service.js';
import { GooglePlacesService } from '../google/google-places.service.js';
import type { Bbox } from '../regions/bbox.js';
import { RegionAreaService } from '../regions/region-area.service.js';
import { PLACE_CATEGORIES } from './entities/place.entity.js';
import { hoursToday } from './opening-hours.js';
import { PlaceLocationService } from './place-location.service.js';
import { RegionPlaceStore, type StoredPlaceRow, type WebPlaceInput } from './region-place-store.js';
import { articlesMentioning, fetchPublishedDate } from './web-grounding.js';
import { pickGoogleMatch } from './web-place-match.js';

export const WEB_PLACES_CONFIG = 'WEB_PLACES_CONFIG';

/** Nới khung bao khi giữ tọa độ AI (~2 km): lệch xa hơn thì chắc chắn sai. */
const AI_LOCATION_PADDING_DEG = 0.02;
/** Số lượt Text Search chạy cùng lúc cho một vùng. */
const MATCH_CONCURRENCY = 5;
/** Chờ đọc ngày đăng bài tối đa chừng này; phần còn lại bỏ qua. */
const DATES_WAIT_MS = 1500;
const DEFAULT_CATEGORIES = PLACE_CATEGORIES.filter((c) => c !== 'stay');
const HHMM = /^([01]?\d|2[0-4]):[0-5]\d$/;

/**
 * Danh sách địa điểm của một vùng (spec 2026-10-14-web-places): tổng hợp từ
 * bài viết (Tavily + Gemini), ghép Google Places để lấy place_id + tọa độ,
 * lưu vào `places` / `region_places`. Lần đầu request chờ tối đa
 * `waitMs`; quá hạn thì trả bản cũ và làm mới ở nền.
 */
@Injectable()
export class WebPlacesService {
  private readonly logger = new Logger(WebPlacesService.name);
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(WEB_PLACES_CONFIG) private readonly config: WebPlacesConfig,
    private readonly agent: AgentPlaceSearch,
    private readonly google: GooglePlacesService,
    private readonly areas: RegionAreaService,
    private readonly store: RegionPlaceStore,
    private readonly locations: PlaceLocationService,
  ) {}

  async listForRegion(regionId: string, categories: PlaceCategory[] | undefined): Promise<PlacesPage> {
    const regionName = await this.regionName(regionId);
    const state = await this.store.state(regionId);

    if (state?.status !== 'ready') {
      if (!this.agent.enabled) throw unavailable();
      const done = await waitAtMost(this.refresh(regionId, regionName), this.config.waitMs);
      if (!done) return building();
      const after = await this.store.state(regionId);
      if (after?.status !== 'ready') throw unavailable();
    } else if (state.expiresAt && state.expiresAt.getTime() <= Date.now() && this.agent.enabled) {
      // Quá hạn: trả bản đang có, làm mới ở nền.
      void this.refresh(regionId, regionName).catch(() => undefined);
    }

    const wanted = categories && categories.length > 0 ? categories : DEFAULT_CATEGORIES;
    let rows = await this.store.list(regionId, wanted);
    const stale = rows.filter((r) => r.location_source === 'google' && r.lat === null).map((r) => r.id);
    if (stale.length > 0) {
      await this.locations.ensure(stale);
      rows = await this.store.list(regionId, wanted);
    }
    const current = await this.store.state(regionId);
    return {
      status: 'ready',
      items: rows.flatMap((r) => toItem(r, regionName)),
      nextCursor: null,
      attribution: 'Tổng hợp từ bài viết trên web (AI) · Vị trí: Google Maps',
      source: 'web',
      sources: current?.sources ?? [],
    };
  }

  /** Một lượt pipeline cho vùng; các lời gọi trong lúc đang chạy dùng chung. Lỗi được ghi vào `region_place_lists`. */
  refresh(regionId: string, regionName?: string): Promise<void> {
    let pending = this.inFlight.get(regionId);
    if (!pending) {
      pending = this.build(regionId, regionName).finally(() => this.inFlight.delete(regionId));
      this.inFlight.set(regionId, pending);
    }
    return pending;
  }

  private async build(regionId: string, knownName?: string): Promise<void> {
    const regionName = knownName ?? (await this.regionName(regionId));
    const started = Date.now();
    await this.store.markBuilding(regionId);
    try {
      const bbox = await this.areas.ensure(regionId).catch((error: Error) => {
        this.logger.warn(`Không tính được khung bao "${regionName}": ${error.message}`);
        return null;
      });
      const found = await this.agent.findPlaces(regionName);
      const grounded = found.places.flatMap((place) => {
        const articles = articlesMentioning(place.title, regionName, found.sources);
        return articles.length > 0 ? [{ place, articles }] : [];
      });

      const cited = new Map<string, ArticleSource>();
      for (const { articles } of grounded) {
        for (const a of articles) {
          if (!cited.has(a.uri)) cited.set(a.uri, { title: a.title, uri: a.uri, publishedAt: a.publishedAt });
        }
      }
      await waitAtMost(
        Promise.all(
          [...cited.values()]
            .filter((a) => a.publishedAt === null)
            .map(async (a) => {
              a.publishedAt = await fetchPublishedDate(a.uri);
            }),
        ),
        DATES_WAIT_MS,
      );

      const located = await this.locate(grounded.map((g) => g.place), regionName, bbox);
      const inputs: WebPlaceInput[] = grounded.flatMap(({ place, articles }, i) => {
        const location = located[i];
        if (!location) return [];
        return [
          {
            name: place.title.trim(),
            category: place.category,
            description: place.description?.trim() || null,
            openingHours: openingHours(place.openHours),
            articles: articles.map((a) => cited.get(a.uri)!),
            location,
          },
        ];
      });

      await this.store.replace(regionId, inputs, [...cited.values()], this.config.refreshDays);
      this.logger.log(
        `"${regionName}": lưu ${inputs.length}/${found.places.length} địa điểm (${inputs.filter((p) => p.location.source === 'google').length} ghép Google) trong ${Date.now() - started} ms`,
      );
    } catch (error) {
      this.logger.error(`Tổng hợp địa điểm "${regionName}" lỗi`, error as Error);
      await this.store.markFailed(regionId, 'PLACES_UNAVAILABLE');
    }
  }

  /** Ghép từng địa điểm với Google (song song có giới hạn); không ghép được thì tọa độ AI trong vùng; ngoài vùng thì bỏ. */
  private async locate(
    places: WebPlacesType,
    regionName: string,
    bbox: Bbox | null,
  ): Promise<Array<WebPlaceInput['location'] | null>> {
    const out: Array<WebPlaceInput['location'] | null> = places.map(() => null);
    let googleErrors = 0;
    let next = 0;
    const worker = async () => {
      while (next < places.length) {
        const i = next++;
        const place = places[i];
        if (bbox && this.google.enabled) {
          try {
            const query = [place.title, place.address, regionName].map((s) => s?.trim()).filter(Boolean).join(', ');
            const match = pickGoogleMatch(place.title, place.category, await this.google.findPlace(query, bbox));
            if (match) {
              out[i] = { source: 'google', placeId: match.placeId, lat: match.lat, lng: match.lng };
              continue;
            }
          } catch {
            googleErrors++;
          }
        }
        const { lat, lng } = place.location ?? {};
        if (Number.isFinite(lat) && Number.isFinite(lng) && insideBbox({ lat, lng }, bbox)) {
          out[i] = { source: 'ai', lat, lng };
        }
      }
    };
    await Promise.all(Array.from({ length: MATCH_CONCURRENCY }, worker));
    if (googleErrors > 0) {
      this.logger.warn(`"${regionName}": ghép Google lỗi ${googleErrors}/${places.length} lượt, dùng tọa độ AI`);
    }
    return out;
  }

  private async regionName(regionId: string): Promise<string> {
    const [row] = (await this.db.query(
      `SELECT r.name, p.name AS parent_name FROM regions r LEFT JOIN regions p ON p.id = r.parent_id WHERE r.id = $1`,
      [regionId],
    )) as Array<{ name: string; parent_name: string | null }>;
    if (!row) {
      throw new NotFoundException({ statusCode: 404, code: 'REGION_NOT_FOUND', message: 'Không tìm thấy vùng này.' });
    }
    return row.parent_name ? `${row.name}, ${row.parent_name}` : row.name;
  }
}

function toItem(row: StoredPlaceRow, regionName: string): PlaceListItem[] {
  // Tọa độ Google hết hạn mà chưa lấy lại được: không hiện trên danh sách lần này.
  if (row.lat === null || row.lng === null) return [];
  const query = encodeURIComponent(`${row.name}, ${regionName}`);
  return [
    {
      id: row.id,
      name: row.name,
      category: row.category,
      coordinates: { lat: row.lat, lng: row.lng },
      compositeScore: 0,
      description: row.description,
      openingHours: row.opening_hours,
      hours: hoursToday(row.opening_hours),
      website: null,
      wikidataId: null,
      sourceUrl: row.google_place_id
        ? `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${row.google_place_id}`
        : `https://www.google.com/maps/search/?api=1&query=${query}`,
      locationSource: row.location_source === 'google' ? 'google' : 'ai',
      googlePlaceId: row.google_place_id,
      articles: row.articles,
    },
  ];
}

function openingHours(hours: { open?: string; close?: string } | undefined): string | null {
  const { open, close } = hours ?? {};
  return open && close && HHMM.test(open) && HHMM.test(close) ? `${open}-${close}` : null;
}

function insideBbox({ lat, lng }: { lat: number; lng: number }, bbox: Bbox | null): boolean {
  if (lat < 8 || lat > 23.6 || lng < 102 || lng > 110) return false;
  if (!bbox) return true;
  const [south, west, north, east] = bbox;
  const pad = AI_LOCATION_PADDING_DEG;
  return lat >= south - pad && lat <= north + pad && lng >= west - pad && lng <= east + pad;
}

async function waitAtMost(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([promise.then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function building(): PlacesPage {
  return {
    status: 'building',
    items: [],
    nextCursor: null,
    attribution: 'Tổng hợp từ bài viết trên web (AI) · Vị trí: Google Maps',
    source: 'web',
    sources: [],
  };
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    statusCode: 503,
    code: 'PLACES_UNAVAILABLE',
    message: 'Tạm thời không lấy được địa điểm. Hãy thử lại sau.',
  });
}
```

- [ ] **Step 6: Nối controller và module**

`places.controller.ts`: constructor của `PlacesController` thêm `private readonly webPlaces: WebPlacesService` (bỏ `PlacesService` khỏi `PlacesController`); route list:

```ts
  /**
   * Địa điểm của vùng, tổng hợp từ bài viết và định vị bằng Google. Lần đầu mở
   * một vùng có thể trả `status: 'building'`: client hỏi lại sau vài giây.
   */
  @Get(':id/places')
  list(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() dto: ListPlacesDto,
  ): Promise<PlacesPage> {
    return this.webPlaces.listForRegion(id, dto.categories);
  }
```

`dto/list-places.dto.ts`: xóa `cursor` và `limit` (giữ `categories`).

`places.module.ts`: bỏ `PlacesV2Controller`, `PlacesV2Service`, `PlacesWarmer` khỏi `controllers`/`providers`; thêm `WebPlacesService` và

```ts
    {
      provide: WEB_PLACES_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<AppConfig['webPlaces']>('webPlaces'),
    },
```

Xóa file `places-v2.controller.ts`, `places-v2.service.ts`, `places-v2.service.spec.ts`, `places-warmer.ts`, `places-warmer.spec.ts`. Trong `places.service.ts` xóa `listForRegion`, `hasPlaces`, `aiFallback`, `warm`, `freshness`, `maxAgeMs`, `ensureFresh`, `refreshIfStale` và mọi helper chỉ chúng dùng (giữ `getDetail`, `googleContent`, `toListItem`).

- [ ] **Step 7: Chạy test**

Run: `npx vitest run --config vitest.config.e2e.ts test/web-places.e2e-spec.ts && pnpm typecheck`
Expected: PASS. (`test/places-source.e2e-spec.ts`, `test/places-speed.e2e-spec.ts` sẽ hỏng — xóa ở Task 9; tạm chạy riêng file.)

- [ ] **Step 8: Commit**

```bash
git add -A apps/backend
git commit -m "feat(backend): list a region's places from articles matched to Google"
```

---

### Task 6: Lập lịch trình đọc danh sách của vùng

**Files:**
- Modify: `apps/backend/src/modules/itineraries/itineraries.service.ts`
- Modify: `apps/backend/src/modules/itineraries/planning/snapshot.ts`, `planning/planning.types.ts`
- Modify: nơi dựng `ItineraryPlaceSnapshot` (tìm bằng `grep -rn "snapshotCoordinates" apps/backend/src`)
- Test: `apps/backend/test/itinerary.e2e-spec.ts`

**Interfaces:**
- Consumes: bảng `region_places` (Task 2/4).
- Produces: `Candidate.locationSource: 'osm' | 'google' | 'ai'`; snapshot có `locationSource`; `poolInArea(regionId: string, categories: PlaceCategory[] | null, limit: number)`.

- [ ] **Step 1: Đổi seed của test e2e sang dòng web + region_places (test sẽ fail)**

Trong `itinerary.e2e-spec.ts`, thay vòng lặp INSERT địa điểm bằng:

```ts
    await db.query(`DELETE FROM region_places WHERE region_id = $1`, [regionId]);
    await db.query(
      `INSERT INTO region_place_lists (region_id, status, fetched_at, expires_at)
       VALUES ($1, 'ready', now(), now() + interval '30 days')
       ON CONFLICT (region_id) DO UPDATE SET status = 'ready', expires_at = EXCLUDED.expires_at`,
      [regionId],
    );
    // Thứ hạng theo điểm cũ: điểm cao trước. Dòng `web` + tọa độ AI không cần google_place_id.
    const ranked = [...places].sort((a, b) => b[5] - a[5]);
    for (const [rank, [key, category, lat, lng, hours]] of ranked.entries()) {
      const [row] = (await db.query(
        `INSERT INTO places (source, name, category, location, location_source, tags, composite_score)
         VALUES ('web', $1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), 'ai', $5, 0)
         RETURNING id`,
        [`E2E it ${key}`, category, lng, lat, hours ? { opening_hours: hours } : {}],
      )) as Array<{ id: string }>;
      ids[key] = row.id;
      await db.query(`INSERT INTO region_places (region_id, place_id, rank) VALUES ($1, $2, $3)`, [regionId, row.id, rank]);
    }
```

`afterAll`: thay câu xóa OSM bằng

```ts
    await db?.query(`DELETE FROM region_places WHERE region_id = $1`, [regionId]);
    await db?.query(`DELETE FROM places WHERE name LIKE 'E2E it %'`);
```

Thêm test mới cuối file:

```ts
  it('ảnh chụp lịch trình ghi locationSource để app hiện "Vị trí gần đúng"', async () => {
    planItinerary.mockRejectedValueOnce(new Error('AI lỗi'));
    const res = await create({ ...baseBody(), selectedPlaceIds: [ids.ga] }).expect(201);
    const visit = res.body.days
      .flatMap((d: { items: Array<{ placeId: string; place: { locationSource?: string } }> }) => d.items)
      .find((i: { placeId: string }) => i.placeId === ids.ga);
    expect(visit.place.locationSource).toBe('ai');
  });
```

- [ ] **Step 2: Chạy để thấy thất bại**

Run: `npx vitest run --config vitest.config.e2e.ts test/itinerary.e2e-spec.ts`
Expected: FAIL — điểm gợi ý thêm và quán ăn không có (vì `poolInArea` lọc `source = 'osm'`), và `locationSource` thiếu.

- [ ] **Step 3: Sửa `itineraries.service.ts`**

`poolInArea` thay bằng:

```ts
  /**
   * Địa điểm bổ sung / quán ăn: danh sách đã tổng hợp của vùng (spec
   * 2026-10-14-web-places), theo thứ hạng. Điểm suy từ thứ hạng để pickExtras
   * và kMeans vẫn so được: hạng 0 → 100, mỗi hạng sau trừ 2, không âm.
   */
  private async poolInArea(
    regionId: string,
    categories: PlaceCategory[] | null,
    limit: number,
  ): Promise<Candidate[]> {
    const rows = (await this.db.query(
      `${PLACE_SELECT}
         JOIN region_places rp ON rp.place_id = p.id AND rp.region_id = $1
        WHERE ($2::place_category[] IS NULL OR p.category = ANY($2::place_category[]))
          AND p.location IS NOT NULL
        ORDER BY rp.rank
        LIMIT $3`,
      [regionId, categories, limit],
    )) as PlaceRow[];
    return rows.map((r, i) => toCandidate({ ...r, composite_score: Math.max(0, 100 - i * 2) }, false));
  }
```

Hai chỗ gọi đổi `this.poolInArea(bbox, …)` → `this.poolInArea(input.regionId, …)`. Biến `bbox` và `searchArea` không còn dùng thì xóa (cùng import `Bbox`, `HttpException` nếu thừa).

`alternatives` thay câu SQL bằng:

```ts
      `SELECT p.id, p.name, p.category, p.description,
              ST_Distance(p.location::geography, t.location::geography) / 1000 AS km
         FROM places t
         JOIN itineraries it ON it.id = $6
         JOIN region_places rp ON rp.region_id = it.region_id
         JOIN places p ON p.id = rp.place_id AND p.category = t.category
          AND p.location IS NOT NULL
          AND ST_DWithin(p.location::geography, t.location::geography, $3)
        WHERE t.id = $1
          AND p.id <> ALL($2::uuid[])
          AND NOT (p.category = ANY($4::place_category[]))
        ORDER BY rp.rank, km
        LIMIT $5`,
      [placeId, used, ALTERNATIVES_RADIUS_M, avoid, ALTERNATIVES, id],
```

`toCandidate`: thêm `locationSource: row.location_source`.

`planning/planning.types.ts`: trong `Candidate` thêm

```ts
  /** Tọa độ từ đâu; `ai` là gần đúng (thời gian di chuyển chỉ là ước tính). */
  locationSource?: 'osm' | 'google' | 'ai';
```

Nơi dựng snapshot (`place: { name, category, coordinates: snapshotCoordinates(c) }`): thêm `locationSource: c.locationSource`.

- [ ] **Step 4: Chạy test**

Run: `npx vitest run --config vitest.config.e2e.ts test/itinerary.e2e-spec.ts && npx vitest run src/modules/itineraries`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend
git commit -m "feat(backend): plan itineraries from the region's article-based places"
```

---

### Task 7: Tìm theo tên, lưu không vào "Muốn đi", chia sẻ vào app, chi tiết

**Files:**
- Modify: `apps/backend/src/modules/google/google-places.service.ts` (`searchByName`)
- Modify: `apps/backend/src/modules/places/place-search.service.ts`, `dto/save-google-place.dto.ts`
- Modify: `apps/backend/src/modules/places/catalog-match.ts`
- Modify: `apps/backend/src/modules/places/places.service.ts` (`getDetail`, `googleContent`)
- Test: `apps/backend/test/place-search.e2e-spec.ts`, `test/share-imports.e2e-spec.ts`

**Interfaces:**
- Produces: `GooglePlaceHit.suggestedCategory`; `SaveGooglePlaceDto.addToSaved?: boolean`; `matchCatalog` khớp dòng `source = 'web'`.

- [ ] **Step 1: Sửa test e2e tìm địa điểm cho dữ liệu mới (fail)**

Trong `place-search.e2e-spec.ts`, đổi helper `osm(...)` thành `web(...)`:

```ts
    const web = async (
      name: string,
      category: string,
      lng: number,
      lat: number,
      googlePlaceId: string | null = null,
    ): Promise<string> => {
      const [row] = (await db.query(
        `INSERT INTO places (source, name, category, location, location_source, location_expires_at, google_place_id, composite_score)
         VALUES ('web', $1, $2::place_category, ST_SetSRID(ST_MakePoint($3::float8, $4::float8), 4326),
                 $5, CASE WHEN $6::text IS NULL THEN NULL ELSE now() + interval '30 days' END, $6, 0)
         RETURNING id`,
        [name, category, lng, lat, googlePlaceId ? 'google' : 'ai', googlePlaceId],
      )) as Array<{ id: string }>;
      return row.id;
    };
```

Thay mọi `osm(-96xx, …)` bằng `web(…)` (bỏ tham số id OSM); `afterAll` xóa `DELETE FROM places WHERE name LIKE 'E2E ps %'`. Đổi các kỳ vọng nói "dòng OSM" thành "dòng web" (nội dung so sánh giữ nguyên). Thêm mock `searchByName` trả `suggestedCategory` trong mỗi hit (ví dụ `{ googlePlaceId: 'g1', name: 'X', address: null, suggestedCategory: 'cafe' }`).

Thêm test:

```ts
  it('lưu với addToSaved=false: có id nhưng không vào "Muốn đi"', async () => {
    google.locate.mockResolvedValueOnce({ lat: 11.94, lng: 108.44 });
    const res = await request(app.getHttpServer())
      .post('/api/places/google')
      .set('Authorization', `Bearer ${token}`)
      .send({ googlePlaceId: 'ChIJnosave123', name: 'E2E ps Không lưu', category: 'cafe', regionId: daLat, addToSaved: false })
      .expect(201);
    expect(res.body.placeId).toEqual(expect.any(String));
    const saved = (await db.query(
      `SELECT 1 FROM saved_places WHERE place_id = $1`,
      [res.body.placeId],
    )) as unknown[];
    expect(saved).toHaveLength(0);
  });
```

(`ChIJnosave123` phải khớp `GOOGLE_PLACE_ID_PATTERN`; xem `google-place-id.ts` và chỉnh nếu cần.)

- [ ] **Step 2: Chạy để thấy thất bại**

Run: `npx vitest run --config vitest.config.e2e.ts test/place-search.e2e-spec.ts`
Expected: FAIL — catalog không thấy dòng web; `addToSaved` bị `forbidNonWhitelisted` từ chối (400).

- [ ] **Step 3: Sửa code**

`place-search.service.ts`, câu `catalog`: `WHERE p.source = 'osm'` → `WHERE p.source = 'web' AND p.location IS NOT NULL`; `ORDER BY … p.composite_score DESC, p.id` → `ORDER BY similarity(unaccent(lower(p.name)), nq.q) DESC, p.id`. `HitRow.source` thêm `'web'`. Trong `existingRow`: `row.source === 'osm'` → `row.source !== 'google'`. `toHit(row, row.source === 'google' ? h.name! : row.name)` giữ nguyên. `byGoogleIds`: `ORDER BY (p.source = 'osm') DESC` → `ORDER BY (p.source = 'web') DESC`.

`save`: thay khối `await this.saved.save(...)` bằng

```ts
      if (dto.addToSaved !== false) {
        await this.saved.save(
          userId,
          placeId!,
          dto.regionId,
          { source: 'search', shareImportId: null, displayName: dto.name },
          m,
        );
      }
```

`dto/save-google-place.dto.ts` thêm:

```ts
  /** false: chỉ lấy id để đưa vào lịch trình, không thêm vào "Muốn đi". */
  @IsOptional()
  @IsBoolean()
  addToSaved?: boolean;
```

(import `IsBoolean`, `IsOptional` từ `class-validator`.)

`google-places.service.ts#searchByName`: field mask thêm `places.primaryType`; kiểu raw thêm `primaryType?: string`; map thêm `suggestedCategory: categoryFromGoogleType(p.primaryType)` (import từ `../places/google-category.js` — nếu tạo vòng import giữa module `google` và `places`, chuyển `google-category.ts` sang `modules/google/google-category.ts` và sửa các import). Xóa `suggestedCategory: 'check_in'` tạm ở Task 1.

`catalog-match.ts`: `WHERE p.source = 'osm'` → `WHERE p.source = 'web' AND p.location IS NOT NULL`; bỏ các cột `osm_type`, `osm_id`, `wikidata_id`, `website` khỏi SELECT và khỏi `CatalogMatch`. Comment: `Chỉ dòng \`web\`: danh sách tổng hợp của các vùng.`

`places.service.ts#getDetail`: SELECT thêm `p.location_source`, bỏ `p.osm_type, p.osm_id` khỏi chỗ dựng `sourceUrl` cho dòng `web` (dùng link Google như dòng `google`); điều kiện `row.source === 'google'` khi đặt `sourceUrl` đổi thành `row.source !== 'osm'`; `attribution` cho dòng `web`: `'Tổng hợp từ bài viết (AI) · Google Maps'`. Trong `googleContent` bỏ nhánh `matchPlaceId` (không ghép dòng OSM nữa): chỉ dùng `row.google_place_id`. Dòng `web` có `location_source = 'ai'` → `googleStatus: 'not_found'`, không gọi Google. Trả thêm `locationSource: row.location_source` trong `PlaceDetail`.

- [ ] **Step 4: Chạy test**

Run: `npx vitest run --config vitest.config.e2e.ts test/place-search.e2e-spec.ts test/share-imports.e2e-spec.ts test/saved-places.e2e-spec.ts && npx vitest run src/modules/share-import src/modules/places src/modules/google`
Expected: PASS. Nếu `share-imports.e2e-spec.ts` seed dòng OSM để test khớp danh mục, đổi seed sang dòng `web` như Step 1.

- [ ] **Step 5: Commit**

```bash
git add apps/backend
git commit -m "feat(backend): search and match against article-based places, add Google places without saving"
```

---

### Task 8: Khung bao vùng không cần Overpass

**Files:**
- Create: `apps/backend/scripts/generate-province-bboxes.ts`
- Create: `apps/backend/src/modules/regions/seed/province-bboxes.ts` (sinh ra)
- Modify: `apps/backend/src/modules/regions/region-seeder.ts`
- Modify: `apps/backend/src/modules/regions/region-area.service.ts`
- Test: `apps/backend/src/modules/regions/seed/vietnam-admin.spec.ts`, `test/region-search.e2e-spec.ts`

**Interfaces:**
- Produces: `export const PROVINCE_BBOXES: Record<string, Bbox>` khóa theo `OldProvince.key` (tỉnh cũ) và `NewProvince.key` (tỉnh mới không sáp nhập), giá trị `[south, west, north, east]`.

- [ ] **Step 1: Viết script sinh khung bao (chạy một lần)**

```ts
/**
 * Sinh `src/modules/regions/seed/province-bboxes.ts`: khung bao tỉnh cũ (ngày
 * 30/6/2025) và tỉnh mới không sáp nhập, lấy từ Overpass MỘT LẦN rồi commit,
 * để app không còn gọi Overpass lúc chạy. Chạy lại khi sửa danh sách tỉnh.
 *
 *   pnpm tsx scripts/generate-province-bboxes.ts
 */
import { writeFileSync } from 'node:fs';

import { pickRelation } from '../src/modules/regions/bbox.js';
import { NEW_PROVINCES, OLD_PROVINCES } from '../src/modules/regions/seed/vietnam-admin.js';

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const PRE_MERGER_DATE = '2025-06-30T00:00:00Z';

async function boundaries(date?: string) {
  const query = `[out:json][timeout:180]${date ? `[date:"${date}"]` : ''};relation["boundary"="administrative"]["admin_level"="4"](area:3600049915);out tags bb;`;
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        headers: { 'User-Agent': 'rong-seed/1.0 (dev@rong.local)' },
        signal: AbortSignal.timeout(200_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { elements: Array<{ tags: Record<string, string>; bounds: { minlat: number; minlon: number; maxlat: number; maxlon: number } }> };
      return body.elements;
    } catch (error) {
      console.warn(`${url}: ${(error as Error).message}`);
    }
  }
  throw new Error('Mọi máy chủ Overpass đều lỗi; thử lại sau.');
}

const out: Record<string, [number, number, number, number]> = {};
const old = await boundaries(PRE_MERGER_DATE);
for (const p of OLD_PROVINCES) {
  const b = pickRelation(old, p.name)?.bounds;
  if (!b) throw new Error(`Không thấy relation tỉnh cũ "${p.name}"`);
  out[p.key] = [b.minlat, b.minlon, b.maxlat, b.maxlon];
}
const current = await boundaries();
for (const p of NEW_PROVINCES.filter((n) => n.mergedFrom.length === 0)) {
  const b = pickRelation(current, p.name)?.bounds;
  if (!b) throw new Error(`Không thấy relation tỉnh "${p.name}"`);
  out[p.key] = [b.minlat, b.minlon, b.maxlat, b.maxlon];
}

writeFileSync(
  new URL('../src/modules/regions/seed/province-bboxes.ts', import.meta.url),
  `/**\n * Khung bao [south, west, north, east] của tỉnh cũ (30/6/2025) và tỉnh mới không\n * sáp nhập. SINH TỰ ĐỘNG bởi scripts/generate-province-bboxes.ts — không sửa tay.\n */\nexport const PROVINCE_BBOXES: Record<string, [number, number, number, number]> = ${JSON.stringify(out, null, 2)};\n`,
);
console.log(`Đã ghi ${Object.keys(out).length} khung bao.`);
```

Kiểm tra trước: `pickRelation` nhận đúng dạng `elements` (xem chữ ký trong `regions/bbox.ts`; nếu nó cần `{ tags, bounds }` thì dạng trên khớp). `3600049915` là area id của Việt Nam (relation 49915); kiểm tra bằng `OpenDataService.listBoundaries` hiện có và dùng lại đúng area/query của nó nếu khác.

- [ ] **Step 2: Chạy script, kiểm tra kết quả**

Run: `cd apps/backend && npx tsx scripts/generate-province-bboxes.ts`
Expected: `Đã ghi N khung bao.` với N = số tỉnh cũ + số tỉnh mới không sáp nhập. Mở file, kiểm tra Lâm Đồng cũ chứa Đà Lạt (11.94, 108.44).

- [ ] **Step 3: Viết test thất bại**

Thêm vào `vietnam-admin.spec.ts`:

```ts
import { PROVINCE_BBOXES } from './province-bboxes.js';

it('mọi tỉnh cũ và tỉnh mới không sáp nhập đều có khung bao trong seed', () => {
  for (const p of OLD_PROVINCES) expect(PROVINCE_BBOXES[p.key], p.name).toBeDefined();
  for (const p of NEW_PROVINCES.filter((n) => n.mergedFrom.length === 0)) {
    expect(PROVINCE_BBOXES[p.key], p.name).toBeDefined();
  }
});

it('khung bao Lâm Đồng cũ chứa Đà Lạt', () => {
  const [s, w, n, e] = PROVINCE_BBOXES[OLD_PROVINCES.find((p) => p.name.includes('Lâm Đồng'))!.key];
  expect(11.94).toBeGreaterThan(s);
  expect(11.94).toBeLessThan(n);
  expect(108.44).toBeGreaterThan(w);
  expect(108.44).toBeLessThan(e);
});
```

Run: `npx vitest run src/modules/regions/seed/vietnam-admin.spec.ts`
Expected: PASS ngay nếu Step 2 đã sinh file (test này canh gác file sinh ra).

- [ ] **Step 4: Seeder ghi khung bao, `RegionAreaService` bỏ Overpass**

`region-seeder.ts`: với `OLD_PROVINCES` và `NEW_PROVINCES` không sáp nhập, thêm `bboxSouth/West/North/East` từ `PROVINCE_BBOXES[p.key]` và `center` = tâm khung (giống khối `DESTINATIONS`). Tỉnh mới sáp nhập: khung = `unionBbox(p.mergedFrom.map((k) => PROVINCE_BBOXES[k]))`, cũng ghi luôn. `areaSource` giữ nguyên (tham khảo). Kiểm tra lệnh upsert hiện tại có ghi đè khung bao không (comment "Hai lệnh riêng: …"): khung bao từ seed phải được ghi cho cả dòng đã có, nên thêm cột bbox vào nhóm upsert ghi đè cho tỉnh.

`region-area.service.ts#compute`: xóa nhánh `source.name && source.adminLevel` và hàm `findRelationBounds`; giữ `unionOf`, tâm + bán kính, Nominatim. `OpenDataService`: xóa `listBoundaries`, `placesInBbox`, `wikidata`, mọi phần Overpass/Wikidata (failover, fail-fast); giữ `searchPlaces` (Nominatim). `OpenDataConfig` bỏ `overpassUrls`, `wikidataUrl`, `placesRefreshDays`, `placesWarmup`; `configuration.ts` bỏ các dòng tương ứng; `.env.example` bỏ `OVERPASS_URL`, `PLACES_REFRESH_DAYS`, `PLACES_WARMUP` (và `WIKIDATA_URL` nếu có).

- [ ] **Step 5: Chạy test**

Run: `pnpm typecheck && npx vitest run src/modules/regions src/modules/open-data && npx vitest run --config vitest.config.e2e.ts test/region-search.e2e-spec.ts test/web-places.e2e-spec.ts`
Expected: PASS. Spec unit của open-data test Overpass/Wikidata: xóa các `describe` đó.

- [ ] **Step 6: Commit**

```bash
git add -A apps/backend
git commit -m "feat(backend): seed province areas and stop calling Overpass"
```

---

### Task 9: Gỡ phần OSM còn lại, test cũ, tài liệu

**Files:**
- Delete: `src/modules/places/place-scoring.ts`, `osm-place-mapping.ts`, `ai-fallback.ts`, `ai-fallback.spec.ts`, `cursor.spec.ts` (+ `cursor.ts` nếu có), `test/places-source.e2e-spec.ts`, `test/places-speed.e2e-spec.ts`
- Modify: `apps/backend/package.json` (script `test:speed` trỏ tới file đã xóa → xóa script), `test/places.live-spec.ts`
- Modify: `apps/backend/src/modules/README.md`, `CLAUDE.md`, `docs/PRD-Rong.md`
- Test: `apps/backend/test/web-places.e2e-spec.ts` (describe "dòng OSM cũ")

- [ ] **Step 1: Viết test cho dữ liệu cũ (Review Focus 5)**

```ts
  describe('dòng OSM cũ', () => {
    it('GET /places/:id vẫn trả chi tiết của dòng osm đã có', async () => {
      const [row] = (await db.query(
        `INSERT INTO places (osm_type, osm_id, name, category, location, composite_score)
         VALUES ('node', -97001, 'E2E wp OSM cũ', 'nature', ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326), 50)
         ON CONFLICT (osm_type, osm_id) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
      )) as Array<{ id: string }>;
      const res = await request(app.getHttpServer())
        .get(`/api/places/${row.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toMatchObject({ id: row.id, name: 'E2E wp OSM cũ', locationSource: 'osm' });
      await db.query(`DELETE FROM places WHERE id = $1`, [row.id]);
    });
  });
```

Run: `npx vitest run --config vitest.config.e2e.ts test/web-places.e2e-spec.ts -t "OSM cũ"`
Expected: PASS nếu Task 7 làm đúng; FAIL thì sửa `getDetail` cho dòng `osm` (không gọi `matchPlaceId`, `googleStatus: 'not_found'` khi không có `google_place_id`).

- [ ] **Step 2: Xóa file và script cũ**

Xóa các file trong mục **Files**. `package.json`: bỏ `test:speed`; `bench:places` giữ, sửa `test/places.live-spec.ts` để gọi `WebPlacesService.refresh` thật và in: số địa điểm, số ghép Google, số tọa độ AI, thời gian.

Run: `cd apps/backend && pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`
Expected: PASS hết. Lỗi import tới file đã xóa → sửa chỗ import (thường là `places.service.ts`, `places.module.ts`).

- [ ] **Step 3: Tài liệu**

- `apps/backend/src/modules/README.md`: bảng module — `places/` thành "Danh sách địa điểm từ bài viết (Tavily + Gemini), ghép Google Places, lưu `places.source = 'web'`; chi tiết; tìm theo tên"; `open-data/` thành "Cổng duy nhất gọi Nominatim". Thay mục "Tìm điểm đến không dùng AI" phần địa điểm, "Chi tiết địa điểm và Google", "Dự phòng khi nguồn dữ liệu mở lỗi" bằng một mục "Danh sách địa điểm của vùng" mô tả luồng ở spec §3, `region_place_lists` / `region_places`, `location_source`, ghi chú "Vị trí gần đúng". Mục "`places.source` và dòng Google" thêm `web` và quy tắc một `google_place_id` một dòng.
- `CLAUDE.md`: thay mục "Places: two pipelines" bằng mô tả pipeline mới (một đoạn), sửa bảng gateway `OpenDataService` thành "Nominatim", bỏ `PLACES_WARMUP`, `test:speed`; sửa câu "every catalog query … must filter `p.source = 'osm'`" thành "danh sách / gợi ý đọc `region_places` của vùng".
- `docs/PRD-Rong.md` §7.4: nguyên tắc 3 thành "Danh mục riêng có tên lấy từ bài viết trên web (AI trích, đối chiếu với bài); tọa độ là tọa độ Google (cache ≤ 30 ngày) hoặc AI ước đoán (ghi rõ là gần đúng)."; Q9(a) ghi thêm quyết định 14/10/2026; §7.1/7.5 bỏ OSM/Overpass/Wikidata khỏi nguồn địa điểm; FR-1.10 sửa "danh mục tổng hợp sẵn" thành "tổng hợp lần đầu khi có người mở vùng, lưu lại và làm mới sau 30 ngày".

- [ ] **Step 4: Commit**

```bash
git add -A apps/backend CLAUDE.md docs/PRD-Rong.md
git commit -m "chore(backend): remove the OSM places pipeline and document article-based places"
```

---

### Task 10: Mobile — màn vùng một danh sách, trạng thái "đang tổng hợp"

**Files:**
- Modify: `apps/mobile/src/hooks/use-region-places.ts`
- Modify: `apps/mobile/src/app/(app)/region/[id].tsx`
- Modify: `apps/mobile/src/components/itinerary-editor.tsx` (`RegionOptions`), `apps/mobile/src/app/(app)/itinerary/new.tsx` (`StayPicker`) — chỉ chữ ký hook

**Interfaces:**
- Produces: `useRegionPlaces(regionId: string, categories: PlaceCategory[])` trả `{ status: 'loading' | 'building' | 'done' | 'error'; items: PlaceListItem[]; sources: ArticleSource[]; attribution: string | null; error: ApiError | null; retry: () => void }`.

- [ ] **Step 1: Viết lại hook**

```ts
import type { ArticleSource, PlaceCategory, PlaceListItem, PlacesPage } from '@rong/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/auth/auth-context';
import { ApiError } from '@/lib/api';

/** Vùng chưa có danh sách thì backend trả `building`: hỏi lại sau chừng này. */
const BUILDING_RETRY_MS = 3000;

export type RegionPlacesState = {
  /** `building`: backend đang tổng hợp lần đầu cho vùng này (10–30 giây). */
  status: 'loading' | 'building' | 'done' | 'error';
  items: PlaceListItem[];
  sources: ArticleSource[];
  attribution: string | null;
  error: ApiError | null;
};

const INITIAL: RegionPlacesState = { status: 'loading', items: [], sources: [], attribution: null, error: null };

/**
 * Địa điểm của vùng, tổng hợp từ bài viết và định vị bằng Google. Mọi mục có
 * id nên chọn được vào lịch trình. Mảng danh mục rỗng nghĩa là "Tất cả"
 * (backend tự bỏ Lưu trú).
 */
export function useRegionPlaces(regionId: string, categories: PlaceCategory[]) {
  const { authFetch } = useAuth();
  const [state, setState] = useState<RegionPlacesState>(INITIAL);
  const latest = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filter = categories.join(',');

  const load = useCallback(
    async (quiet: boolean) => {
      const id = ++latest.current;
      if (!quiet) setState(INITIAL);
      try {
        const params = new URLSearchParams();
        if (filter) params.set('categories', filter);
        const page = await authFetch<PlacesPage>(`/regions/${regionId}/places?${params}`);
        if (id !== latest.current) return;
        if (page.status === 'building') {
          setState({ ...INITIAL, status: 'building' });
          retryTimer.current = setTimeout(() => load(true), BUILDING_RETRY_MS);
          return;
        }
        setState({ status: 'done', items: page.items, sources: page.sources ?? [], attribution: page.attribution, error: null });
      } catch (error) {
        if (id !== latest.current) return;
        const apiError = error instanceof ApiError ? error : new ApiError(0, 'UNKNOWN', 'Có lỗi không mong muốn. Thử lại sau.');
        setState((prev) => ({ ...prev, status: 'error', error: apiError }));
      }
    },
    [authFetch, regionId, filter],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(false);
    return () => {
      latest.current++;
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [load]);

  const retry = useCallback(() => load(false), [load]);
  return { ...state, retry };
}
```

- [ ] **Step 2: Sửa màn vùng**

Trong `region/[id].tsx`:
- Xóa state `api`, `switchApi`, hook `articles`, import `PlacesApi`; `const places = useRegionPlaces(params.id, categories);`.
- Xóa khối chip "Danh mục" / "Từ bài viết" (`styles.sources`).
- `canPlan`: `const canPlan = places.items.length > 0;` (mọi mục đều có id).
- `tripAction` / `saveAction`: bỏ kiểm tra `if (!place.id)` (id luôn có); `openDetail` dùng `place.id`.
- `count`: `places.status === 'loading' ? 'Đang tải địa điểm…' : places.status === 'building' ? 'Đang tổng hợp…' : \`${places.items.length} địa điểm\``.
- `FlatList`: bỏ `onEndReached`, `onEndReachedThreshold`.
- `ListStatus`: bỏ tham số `api`; nhánh `loading` hiện "Đang tải địa điểm…"; thêm nhánh:

```tsx
  if (places.status === 'building') {
    return (
      <View style={styles.status}>
        <ActivityIndicator color={Colors.light.primary} />
        <Text style={styles.hint}>
          Đang tổng hợp địa điểm từ các bài viết về vùng này. Lần đầu mất 10–30 giây, những lần sau mở ngay.
        </Text>
      </View>
    );
  }
```

- `ListFooter` / `Attribution`: bỏ phần `loadingMore` và link OSM; hiện `places.attribution` và danh sách `places.sources` (giữ cách hiện link bài viết đang dùng cho `groundingSources`).

Trong `itinerary-editor.tsx#RegionOptions`: `useRegionPlaces(regionId, NO_FILTER)`, bỏ nút "Xem thêm" và `nextCursor`, thêm `building` hiển thị như `loading`. Trong `itinerary/new.tsx#StayPicker`: `useRegionPlaces(regionId, STAY_ONLY)`; `stays.status === 'building'` hiển thị như `loading`.

- [ ] **Step 3: Kiểm tra**

Run: `pnpm --filter @rong/mobile typecheck && pnpm --filter @rong/mobile lint`
Expected: PASS.

Chạy app (Metro) trỏ tới backend local đã có Task 5, mở một vùng chưa có danh sách: thấy "Đang tổng hợp…", sau đó danh sách có nút "+", "Lập lịch trình" bấm được, AI tạo được lịch trình.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): show one article-based place list and wait while a region is being built"
```

---

### Task 11: Mobile — ghi chú "Vị trí gần đúng"

**Files:**
- Create: `apps/mobile/src/components/ui/approximate-location.tsx`
- Modify: `apps/mobile/src/components/ui/place-row.tsx`, `apps/mobile/src/components/region-map.tsx` (`PlaceMarker`), `apps/mobile/src/app/(app)/place/[id].tsx`, `apps/mobile/src/app/(app)/itinerary/[id].tsx` (`ItemCard`)

**Interfaces:**
- Produces: `<ApproximateLocation compact? />` — `compact`: chỉ nhãn nhỏ, chạm mở giải thích; mặc định: nhãn + câu giải thích luôn hiện.

- [ ] **Step 1: Viết component**

```tsx
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';

export const APPROXIMATE_LOCATION_NOTE =
  'Chưa tìm thấy địa điểm này trên Google Maps. Vị trí do AI ước đoán từ bài viết nên có thể lệch, thời gian di chuyển tới đây chỉ là ước tính.';

/** Nhãn cho địa điểm có tọa độ AI ước đoán (`locationSource: 'ai'`). */
export function ApproximateLocation({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Vị trí gần đúng. ${APPROXIMATE_LOCATION_NOTE}`}
        disabled={!compact}
        hitSlop={8}
        onPress={() => setOpen((v) => !v)}
        style={styles.badge}>
        <Icon name="pin" size={12} color={Colors.light.warning} />
        <Text style={styles.badgeText}>Vị trí gần đúng</Text>
      </Pressable>
      {open ? <Text style={styles.note}>{APPROXIMATE_LOCATION_NOTE}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one, alignItems: 'flex-start' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.warningBackground,
  },
  badgeText: { ...Type.caption1, color: Colors.light.warning },
  note: { ...Type.footnote, color: Colors.light.textSecondary },
});
```

Kiểm tra `Colors.light.warning` / `warningBackground`, `Type.caption1`, icon `pin` có trong `constants/theme.ts` và `ui/icon.tsx`; nếu tên khác thì dùng tên đang có (ví dụ token mà `Notice tone="warning"` dùng).

- [ ] **Step 2: Gắn vào các màn**

- `place-row.tsx`: bỏ `'Vị trí gần đúng'` khỏi `meta`; dưới `description` thêm `{approximate ? <ApproximateLocation compact /> : null}`; `extras` thêm `approximate ? 'vị trí gần đúng' : null`.
- `region-map.tsx#PlaceMarker`: khi `place.locationSource === 'ai'` truyền `approximate` cho `MapMarker` (thêm prop này vào `ui/map-marker.tsx`: viền nét đứt `borderStyle: 'dashed'` và độ mờ 0.85).
- `place/[id].tsx`: nếu `detail.locationSource === 'ai'` hiện `<ApproximateLocation />` ngay dưới tên.
- `itinerary/[id].tsx#ItemCard`: sau dòng `kind`, `{item.place?.locationSource === 'ai' ? <ApproximateLocation compact /> : null}`. Làm tương tự trong dòng mục của `itinerary-editor.tsx` (nơi hiển thị `item.place?.name`).

- [ ] **Step 3: Kiểm tra**

Run: `pnpm --filter @rong/mobile typecheck && pnpm --filter @rong/mobile lint`
Expected: PASS. Trên thiết bị: mục `ai` có nhãn vàng; chạm ở danh sách mở câu giải thích; TalkBack/VoiceOver đọc cả câu.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): flag places whose location is an AI estimate"
```

---

### Task 12: Mobile — tìm thêm địa điểm khi lập lịch

**Files:**
- Create: `apps/mobile/src/hooks/use-add-google-place.ts`
- Create: `apps/mobile/src/components/place-picker.tsx`
- Modify: `apps/mobile/src/app/(app)/itinerary/new.tsx`
- Modify: `apps/mobile/src/components/itinerary-editor.tsx` (`AddPlace`)

**Interfaces:**
- Consumes: `usePlaceSearch(regionId, query)` (có sẵn), `POST /places/google` với `addToSaved: false` (Task 7), `GooglePlaceHit.suggestedCategory` (Task 1/7).
- Produces:
  - `useAddGooglePlace(regionId: string): { add: (hit: GooglePlaceHit) => Promise<PickedPlace | null>; pending: string | null; error: ApiError | null }`
  - `type PickedPlace = { id: string; name: string; category: PlaceCategory }`
  - `<PlacePicker regionId exclude?: Set<string> onPick: (place: PickedPlace) => void />`

- [ ] **Step 1: Hook thêm kết quả Google**

```ts
import type { GooglePlaceHit, PlaceCategory, SaveGooglePlaceRequest, SaveGooglePlaceResponse } from '@rong/shared-types';
import { useCallback, useState } from 'react';

import { useAuth } from '@/auth/auth-context';
import { ApiError } from '@/lib/api';

export type PickedPlace = { id: string; name: string; category: PlaceCategory };

/**
 * Biến một kết quả Google thành địa điểm có id để đưa vào lịch trình, không
 * thêm vào "Muốn đi" (`addToSaved: false`). Tên lấy từ kết quả tìm.
 */
export function useAddGooglePlace(regionId: string) {
  const { authFetch } = useAuth();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const add = useCallback(
    async (hit: GooglePlaceHit): Promise<PickedPlace | null> => {
      if (!hit.name) return null;
      setPending(hit.googlePlaceId);
      setError(null);
      const body: SaveGooglePlaceRequest = {
        googlePlaceId: hit.googlePlaceId,
        name: hit.name,
        category: hit.suggestedCategory,
        regionId,
        addToSaved: false,
      };
      try {
        const res = await authFetch<SaveGooglePlaceResponse>('/places/google', { method: 'POST', body });
        return { id: res.placeId, name: hit.name, category: hit.suggestedCategory };
      } catch (e) {
        setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Có lỗi không mong muốn. Thử lại sau.'));
        return null;
      } finally {
        setPending(null);
      }
    },
    [authFetch, regionId],
  );

  return { add, pending, error };
}
```

- [ ] **Step 2: Component `PlacePicker`**

Không dùng `FlatList` (nằm trong `ScrollView` của form / sheet của màn sửa).

```tsx
import type { PlaceSearchHit } from '@rong/shared-types';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { SearchField } from '@/components/ui/search-field';
import { CATEGORY_LABELS } from '@/constants/places';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useAddGooglePlace, type PickedPlace } from '@/hooks/use-add-google-place';
import { usePlaceSearch } from '@/hooks/use-place-search';

/**
 * Tìm và chọn thêm địa điểm khi lập lịch: gõ thì khớp danh sách của vùng;
 * bấm "Tìm trên Google Maps" thì thêm kết quả Google (tính vào hạn mức ngày).
 */
export function PlacePicker({
  regionId,
  exclude,
  onPick,
}: {
  regionId: string;
  exclude?: Set<string>;
  onPick: (place: PickedPlace) => void;
}) {
  const [query, setQuery] = useState('');
  const search = usePlaceSearch(regionId, query);
  const google = useAddGooglePlace(regionId);
  const q = query.trim();
  const fresh = search.forQuery === q;

  const seen = new Set<string>();
  const inRong = fresh
    ? [...search.catalog, ...search.existing].filter((p) => {
        if (seen.has(p.id) || exclude?.has(p.id)) return false;
        seen.add(p.id);
        return true;
      })
    : [];
  const fromGoogle = fresh ? (search.google ?? []).filter((h) => h.name) : [];

  const pick = (p: PlaceSearchHit) => {
    onPick({ id: p.id, name: p.name, category: p.category });
    setQuery('');
  };

  return (
    <View style={styles.wrap}>
      <SearchField value={query} onChangeText={setQuery} placeholder="Tìm thêm địa điểm theo tên" onSubmitEditing={search.submit} />
      {q && search.status === 'loading' ? <ActivityIndicator color={Colors.light.primary} /> : null}
      {inRong.map((p) => (
        <Option key={p.id} title={p.name} subtitle={CATEGORY_LABELS[p.category]} onPress={() => pick(p)} />
      ))}
      {fromGoogle.length > 0 ? <Text style={styles.group}>Từ Google Maps</Text> : null}
      {fromGoogle.map((h) => (
        <Option
          key={h.googlePlaceId}
          title={h.name!}
          subtitle={h.address ?? CATEGORY_LABELS[h.suggestedCategory]}
          loading={google.pending === h.googlePlaceId}
          onPress={async () => {
            const picked = await google.add(h);
            if (picked) {
              onPick(picked);
              setQuery('');
            }
          }}
        />
      ))}
      {q && fresh && !search.searchedOnline && search.status === 'done' ? (
        <Button label="Tìm trên Google Maps" variant="plain" size="sm" onPress={search.submit} style={styles.inline} />
      ) : null}
      {search.error ? <Notice tone="danger" title="Chưa tìm được">{search.error.message}</Notice> : null}
      {google.error ? <Notice tone="danger" title="Chưa thêm được">{google.error.message}</Notice> : null}
    </View>
  );
}

function Option({ title, subtitle, loading, onPress }: { title: string; subtitle: string; loading?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Thêm ${title}, ${subtitle}`}
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
      <View style={styles.flex}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Text style={styles.sub} numberOfLines={1}>{subtitle}</Text>
      </View>
      {loading ? <ActivityIndicator color={Colors.light.primary} /> : <Icon name="add" size={18} color={Colors.light.primary} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  group: { ...Type.footnote, color: Colors.light.textSecondary, marginTop: Spacing.two },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  pressed: { opacity: 0.7 },
  flex: { flex: 1 },
  title: { ...Type.callout, color: Colors.light.text },
  sub: { ...Type.footnote, color: Colors.light.textSecondary },
  inline: { alignSelf: 'flex-start', marginLeft: -Spacing.three },
});
```

Kiểm tra `usePlaceSearch` trả `forQuery`, `searchedOnline`, `submit` (có trong hook hiện tại) — nếu `forQuery` chưa được trả ra trong object return, thêm vào.

- [ ] **Step 3: Gắn vào form và màn sửa**

`itinerary/new.tsx`, trong `Section "Địa điểm đã chọn"`, trước nút "Chọn thêm trên bản đồ":

```tsx
          <PlacePicker
            regionId={regionId}
            exclude={new Set(draft.places.map((p) => p.id))}
            onPick={(p) => tripDraft.togglePlace(regionId, p)}
          />
```

`itinerary-editor.tsx#AddPlace`: trong nhánh `source === 'region'`, trên `<RegionOptions …/>` thêm `<PlacePicker regionId={itinerary.regionId} exclude={inTrip} onPick={onPick} />`. `onPick` nhận `EditPlace` — `PickedPlace` có cùng trường `id/name/category`; nếu `EditPlace` cần thêm trường, ánh xạ tại chỗ.

`place-search-results.tsx`: không đổi hành vi (màn vùng vẫn mở xem trước), nhưng hiển thị `CATEGORY_LABELS[hit.suggestedCategory]` khi Google không có địa chỉ.

- [ ] **Step 4: Kiểm tra**

Run: `pnpm --filter @rong/mobile typecheck && pnpm --filter @rong/mobile lint`
Expected: PASS. Trên thiết bị: trong form tạo lịch trình gõ tên một quán, bấm "Tìm trên Google Maps", chọn kết quả → quán xuất hiện trong "Địa điểm đã chọn" và **không** có trong "Muốn đi"; tạo lịch trình AI thành công có quán đó. Trong màn sửa, "Thêm vào ngày N" → "Trong vùng" → tìm → chọn → điểm vào cuối ngày. Bàn phím mở: ô tìm và kết quả không bị che.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): search and add more places while planning a trip"
```

---

### Task 13: Dọn hợp đồng shared-types và kiểm tra toàn repo

**Files:**
- Modify: `packages/shared-types/src/place.ts`
- Modify: các chỗ backend/mobile còn dùng trường bị xóa (theo lỗi `tsc`)

- [ ] **Step 1: Bỏ phần cũ**

`place.ts`:
- `PlaceListItem.id: string` (bỏ `| null` và comment `ai_google_maps`).
- `locationSource: LocationSource` (bắt buộc, bỏ `'catalog' | 'geocoding'`); `articles: ArticleSource[]` bắt buộc.
- Bỏ `compositeScore`, `wikidataId`; comment `sourceUrl` thành "Link mở địa điểm trên Google Maps".
- `PlaceListSource = 'web'`; `PlacesPage`: `status: 'ready' | 'building'` bắt buộc, `sources: ArticleSource[]` bắt buộc, bỏ `nextCursor`, `groundingSources`.
- Comment đầu file: thay "Tên và tọa độ trong danh mục riêng phải đến từ nguồn không phải Google (OSM, curate)" bằng "Tên địa điểm lấy từ bài viết (hoặc người dùng đặt); tọa độ Google chỉ giữ ≤ 30 ngày".

- [ ] **Step 2: Sửa lỗi biên dịch**

Run: `pnpm --filter @rong/shared-types build && pnpm typecheck`
Expected: lỗi ở chỗ còn dùng `compositeScore` (`place-row.tsx` → bỏ phần điểm, luôn hiện "Theo N bài viết"), `wikidataId`, `nextCursor`, `groundingSources`, `id ?? …`. Sửa từng chỗ cho đến khi PASS.

- [ ] **Step 3: Chạy toàn bộ**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @rong/backend test:e2e`
Expected: PASS hết.

- [ ] **Step 4: Commit**

```bash
git add -A packages apps
git commit -m "refactor(shared-types): drop OSM catalog fields from the places contract"
```

---

### Task 14: Đo thật và chỉnh ngưỡng ghép

**Files:**
- Modify (nếu cần): `apps/backend/src/modules/places/web-place-match.ts` (`MATCH_MIN_SIMILARITY`)

- [ ] **Step 1: Chạy bench thật (tốn tiền Tavily/Gemini/Google — xin xác nhận người dùng trước)**

Run: `cd apps/backend && for r in vn:destination:da-lat vn:destination:hoi-an vn:destination:sa-pa vn:destination:can-gio; do PLACES_LIVE_REGION=$r pnpm bench:places; done`
Expected: mỗi vùng in số địa điểm, số ghép Google, số tọa độ AI, thời gian. Ghi lại vào mô tả PR.

- [ ] **Step 2: Soát ghép nhầm**

Với 10 mục `google` ngẫu nhiên mỗi vùng, mở `sourceUrl` kiểm tra đúng địa điểm. Nếu ghép nhầm > 10%: tăng `MATCH_MIN_SIMILARITY` (0.6) và thêm ca nhầm vào `web-place-match.spec.ts`. Nếu tỉ lệ `ai` > 40%: thử bỏ `place.address` khỏi câu truy vấn trong `WebPlacesService.locate`, chạy lại.

- [ ] **Step 3: Commit (nếu có chỉnh)**

```bash
git add apps/backend/src/modules/places/web-place-match*
git commit -m "tune(backend): adjust the Google name-match threshold from live measurements"
```

---

## Tiến độ thực hiện

Nhánh `feat/web-places`. Cập nhật sau mỗi task; khi bị ngắt (rate limit), tiếp tục từ task đầu tiên chưa có dòng "xong".

| Task | Trạng thái | Commit | Ghi chú |
| --- | --- | --- | --- |
| 1 | xong | 7dbe731 | |
| 2 | xong | a7cdb69 | migration đã chạy trên DB dev |
| 3 | xong | a2053c0 | |
| 4 | xong | 48c5511 | |
| 5 | xong | e8931d9 | xóa luôn `ai-fallback.*`, `places-source`/`places-speed` e2e và script `test:speed` (chỉ kiểm thử pipeline cũ) |
| 6 | xong | 8788f7d | e2e lịch trình chỉ xóa dòng `E2E it %` của Đà Lạt; test locationSource kiểm mọi điểm thăm (`ga` có thể rơi vào "Chưa xếp") |
| 7 | xong | 1831970 | `google-category.ts` giữ ở `places/` (không có vòng import); `getDetail` bỏ hẳn ghép theo tên nên `GooglePlacesService.matchPlaceId` không còn chỗ gọi — gỡ ở Task 9; thêm e2e chi tiết dòng web |
| 8 | **chờ** | fb160db (Step 1) | Step 2 cần mạng tới Overpass/Nominatim; môi trường cloud chặn (proxy 403). Chạy `cd apps/backend && npx tsx scripts/generate-province-bboxes.ts` ở máy có mạng, rồi làm tiếp Step 3–6. Task 9 phụ thuộc Task 8 (gỡ Overpass, tài liệu) |
| 10 | đang làm | | |

Quyết định khi thực hiện:
- web-places e2e dùng vùng test riêng (`e2e:web-places`) thay vì Đà Lạt, vì các file e2e chạy song song.
- Nếu Task 7 chuyển `google-category.ts` sang `modules/google/`, phải sửa cả import trong `places/web-place-match.ts`.
- Task 8: Overpass lỗi thì lấy khung bao tỉnh từ Nominatim; vẫn thiếu thì dừng và báo.
- Task 14 (đo thật, tốn tiền) phải hỏi người dùng trước khi chạy.
