# Place Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trong màn vùng, người dùng tìm địa điểm theo tên: tìm danh mục khi gõ, tìm Google Maps khi bấm tìm, xem trước kết quả Google, và lưu vào "Muốn đi" với tên tự xác nhận.

**Architecture:** Backend thêm `PlaceSearchService` trong `modules/places` với ba route (`GET /regions/:id/places/search`, `GET /places/google/:googlePlaceId`, `POST /places/google`). Tạo dòng `places` nguồn Google qua `GooglePlaceRowsService` tách từ share-to-app. Mobile thêm ô tìm trong `PlaceSheet` của màn vùng và màn xem trước `place/google/[googlePlaceId]`.

**Tech Stack:** NestJS 12, TypeORM raw SQL, Postgres + PostGIS + pg_trgm + unaccent, vitest + supertest; Expo SDK 57, expo-router, react-native-gesture-handler.

**Spec:** `docs/superpowers/specs/2026-10-12-place-search-design.md`

## Global Constraints

- ESM: import tương đối kết thúc bằng `.js`.
- Comment, log, thông báo lỗi bằng tiếng Việt; lỗi HTTP có thân `{ statusCode, code, message }`.
- Schema chỉ đổi qua migration SQL viết tay, timestamp sau `1759400000000`. `apps/backend/.env` trỏ DB Neon dev của người dùng (đã đồng ý dùng cho migration và e2e).
- Ép kiểu tham số SQL không rõ kiểu (`$3::float8`, `$1::text[]`).
- PRD 7.4: chỉ `GooglePlacesService` gọi Google; không lưu nội dung Google (tên, địa chỉ, loại); chỉ lưu `google_place_id` và tọa độ hạn 30 ngày; không xếp hạng trên dữ liệu Google.
- Tìm danh mục chỉ xét `p.source = 'osm'`; không khớp theo tên dòng Google.
- Danh sách Google giữ nguyên thứ tự Google trả về.
- Giới hạn: tìm online `PLACE_SEARCH_DAILY_LIMIT` (mặc định 60) lượt/người/24 giờ; danh mục tối đa 10 kết quả; Google tối đa 5; `q` 1–100 ký tự; `name` lưu 1–120 ký tự; `googlePlaceId` khớp `^[A-Za-z0-9_-]{1,300}$`.
- Sau khi sửa `packages/shared-types` chạy `pnpm --filter @rong/backend build:deps` trước khi gọi vitest/tsc trực tiếp.
- Biến môi trường mới thêm vào `src/config/configuration.ts` và `apps/backend/.env.example`.
- Mobile: theo `apps/mobile/CLAUDE.md` (ScrollView/FlatList trong `PlaceSheet` lấy từ `react-native-gesture-handler`; ô nhập không bị bàn phím che; màn mới bọc `<Screen>` hoặc tự chừa vùng an toàn).
- Lint backend: `npx oxlint --type-aware <paths>`; e2e chạy `npx vitest run --config vitest.config.e2e.ts <files>`.

## Review Focus

1. **Kết quả Google trùng một địa điểm OSM đã ghép `google_place_id`** — phải trả là địa điểm danh mục (có `id`, tên OSM), xem trước phải chuyển sang chi tiết thường, lưu phải lưu dòng OSM đó chứ không tạo dòng Google trùng. Test ở Task 5.
2. **Kết quả Google trùng một dòng Google do người khác lưu** — hiện tên Google lấy trực tiếp, không hiện tên người khác đặt. Test ở Task 5.
3. **Ô tìm có ký tự đặc biệt (`%`, `_`, `'`)** — không lỗi SQL, không khớp bừa. Test ở Task 5.
4. **Google lỗi hoặc chưa cấu hình khi bấm tìm** — vẫn trả danh mục, `google: null`, không 500. Test ở Task 5.
5. **Bấm lưu hai lần** — một dòng `places`, một dòng `saved_places`. Test ở Task 5.

---

## File Structure

**Backend — tạo mới**
- `src/database/migrations/1759500000000-AllowSearchSavedSource.ts` — CHECK `saved_places.source` thêm `'search'`.
- `src/modules/places/google-place-rows.service.ts` — tạo/dùng lại dòng `places` nguồn Google.
- `src/modules/places/google-category.ts` — `primaryType` → `PlaceCategory`.
- `src/modules/places/place-search-limiter.ts` — giới hạn tìm online theo người.
- `src/modules/places/google-place-id.ts` — kiểm tra định dạng `googlePlaceId`.
- `src/modules/places/place-search.service.ts`, `dto/place-search.dto.ts`, `dto/save-google-place.dto.ts`.
- Test: `*.spec.ts` cạnh từng file thuần; `test/place-search.e2e-spec.ts`.

**Backend — sửa**
- `src/modules/google/google-places.service.ts` (+ spec): `searchByName`, `preview`.
- `src/modules/places/places.controller.ts`, `places.module.ts`.
- `src/modules/share-import/share-imports.service.ts` (dùng `GooglePlaceRowsService`), `share-import.module.ts`.
- `src/modules/saved-places/saved-places.service.ts` (kiểu `source`).
- `src/config/configuration.ts`, `.env.example`, `src/modules/README.md`.

**Shared types**: `packages/shared-types/src/place.ts`.

**Mobile**
- Tạo: `src/hooks/use-place-search.ts`, `src/components/place-search-results.tsx`, `src/hooks/use-google-place-preview.ts`, `src/components/save-google-place-sheet.tsx`, `src/app/(app)/place/google/[googlePlaceId].tsx`.
- Sửa: `src/app/(app)/region/[id].tsx`, `src/app/(app)/_layout.tsx`, `src/app/(app)/share-import/[id].tsx`.

---

### Task 1: Shared types và migration nguồn `'search'`

**Files:**
- Modify: `packages/shared-types/src/place.ts`
- Create: `apps/backend/src/database/migrations/1759500000000-AllowSearchSavedSource.ts`
- Modify: `apps/backend/src/modules/saved-places/saved-places.service.ts` (kiểu `SaveOrigin.source`)

**Interfaces:**
- Produces (shared-types, `place.ts`):

```ts
/** Kết quả tìm có trong DB (danh mục OSM, hoặc dòng đã có khớp theo place_id). */
export interface PlaceSearchHit {
  id: string;
  name: string;
  category: PlaceCategory;
  coordinates: Coordinates | null;
}

/** Kết quả chỉ có trên Google: lấy trực tiếp để hiển thị, không lưu (PRD 7.4). */
export interface GooglePlaceHit {
  googlePlaceId: string;
  name: string | null;
  address: string | null;
}

export interface PlaceSearchResponse {
  catalog: PlaceSearchHit[];
  /** Kết quả Google trùng một địa điểm đã có trong DB, theo thứ tự Google. */
  existing: PlaceSearchHit[];
  /** null: không tìm Google (không bật online, hoặc Google không dùng được). */
  google: GooglePlaceHit[] | null;
}

export interface GooglePlacePreview {
  googlePlaceId: string;
  name: string | null;
  address: string | null;
  coordinates: Coordinates | null;
  suggestedCategory: PlaceCategory;
  google: GooglePlaceContent;
}

/** Địa điểm đã có trong DB thì chỉ trả id để mở chi tiết thường. */
export type GooglePlacePreviewResponse = { placeId: string } | GooglePlacePreview;

export interface SaveGooglePlaceRequest {
  googlePlaceId: string;
  name: string;
  category: PlaceCategory;
  regionId: string;
}

export interface SaveGooglePlaceResponse {
  placeId: string;
}
```

và `SavedPlace.source` thành `'manual' | 'share' | 'search'`.

- [ ] **Step 1: Thêm types** vào `packages/shared-types/src/place.ts` (đặt sau `GooglePlaceContent`; `Coordinates` và `PlaceCategory` đã có trong file). Sửa comment `SavedPlace.source`: `'share'` từ chia sẻ (F4), `'search'` từ ô tìm địa điểm.

- [ ] **Step 2: Migration**

```ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** "Muốn đi" lưu từ ô tìm địa điểm trong màn vùng: nguồn `'search'`. */
export class AllowSearchSavedSource1759500000000 implements MigrationInterface {
  name = 'AllowSearchSavedSource1759500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "saved_places"
        DROP CONSTRAINT "chk_saved_place_source",
        ADD CONSTRAINT "chk_saved_place_source" CHECK ("source" IN ('manual', 'share', 'search'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "saved_places" SET "source" = 'manual' WHERE "source" = 'search'`);
    await queryRunner.query(`
      ALTER TABLE "saved_places"
        DROP CONSTRAINT "chk_saved_place_source",
        ADD CONSTRAINT "chk_saved_place_source" CHECK ("source" IN ('manual', 'share'))
    `);
  }
}
```

- [ ] **Step 3: Kiểu `SaveOrigin`** trong `saved-places.service.ts`: `source: 'manual' | 'share' | 'search'`. Câu upsert hiện giữ `'share'` khi lưu lại thủ công (`CASE WHEN EXCLUDED.source = 'share' ...`) — đổi thành giữ nguồn không phải `'manual'`:

```sql
source = CASE WHEN EXCLUDED.source <> 'manual' THEN EXCLUDED.source ELSE saved_places.source END
```

(Mở file đọc câu hiện tại trước khi sửa; giữ nguyên phần còn lại.) `list()` map `r.source` đã là chuỗi; kiểu `SavedRow.source` cập nhật theo.

- [ ] **Step 4: Build, migrate, kiểm tra**

Run (trong `apps/backend`): `pnpm --filter @rong/shared-types build && pnpm migration:run && pnpm typecheck && npx vitest run --config vitest.config.e2e.ts test/saved-places.e2e-spec.ts test/share-imports.e2e-spec.ts`
Expected: migration chạy thành công; typecheck sạch; e2e qua. Mobile: `pnpm --filter @rong/mobile typecheck` sạch.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types apps/backend/src/database/migrations/1759500000000-AllowSearchSavedSource.ts apps/backend/src/modules/saved-places/saved-places.service.ts
git commit -m "feat: add place search contract and search saved-place source"
```

---

### Task 2: Tách `GooglePlaceRowsService` khỏi share-to-app

**Files:**
- Create: `apps/backend/src/modules/places/google-place-rows.service.ts`
- Modify: `apps/backend/src/modules/places/places.module.ts` (provider + export)
- Modify: `apps/backend/src/modules/share-import/share-imports.service.ts` (xóa hàm `upsertGooglePlace`, gọi service)
- Modify: `apps/backend/src/modules/share-import/share-import.module.ts` (import `PlacesModule` nếu chưa có)
- Test: `apps/backend/test/share-imports.e2e-spec.ts` (phải vẫn qua, không sửa)

**Interfaces:**
- Produces:

```ts
export interface GooglePlaceRowInput {
  googlePlaceId: string;
  /** Tên do người dùng đặt / lấy từ nội dung người dùng — không phải tên Google. */
  name: string;
  category: PlaceCategory;
  lat: number;
  lng: number;
  /** Lúc lấy tọa độ từ Google; hạn tọa độ = fetchedAt + GOOGLE_LOCATION_TTL_DAYS. */
  fetchedAt: Date;
}
@Injectable() export class GooglePlaceRowsService {
  upsert(input: GooglePlaceRowInput, runner?: Pick<DataSource, 'query'>): Promise<string>;  // trả places.id
}
```

- [ ] **Step 1: Tạo service** — chuyển nguyên SQL của `upsertGooglePlace` (`share-imports.service.ts`, cuối file) sang:

```ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { PlaceCategory } from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { GOOGLE_LOCATION_TTL_DAYS } from './place-location.service.js';

export interface GooglePlaceRowInput {
  googlePlaceId: string;
  name: string;
  category: PlaceCategory;
  lat: number;
  lng: number;
  fetchedAt: Date;
}

/**
 * Dòng `places` nguồn Google (F4, tìm địa điểm): chỉ `google_place_id`, tên do
 * người dùng đặt và tọa độ hạn 30 ngày tính từ lúc lấy (PRD 7.4). Dùng chung
 * theo place_id; dòng đã có tọa độ hạn lâu hơn thì giữ nguyên; không đổi tên
 * hay loại của dòng đã có.
 */
@Injectable()
export class GooglePlaceRowsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async upsert(
    input: GooglePlaceRowInput,
    runner: Pick<DataSource, 'query'> = this.db,
  ): Promise<string> {
    const [row] = (await runner.query(
      `INSERT INTO places (source, google_place_id, name, category, location, location_expires_at, composite_score)
       VALUES ('google', $1, $2, $3::place_category, ST_SetSRID(ST_MakePoint($4::float8, $5::float8), 4326),
               $7::timestamptz + make_interval(days => $6::int), 0)
       ON CONFLICT (google_place_id) WHERE source = 'google'
       DO UPDATE SET
         location = CASE WHEN places.location IS NULL OR EXCLUDED.location_expires_at > places.location_expires_at
                         THEN EXCLUDED.location ELSE places.location END,
         location_expires_at = CASE WHEN places.location IS NULL OR EXCLUDED.location_expires_at > places.location_expires_at
                                    THEN EXCLUDED.location_expires_at ELSE places.location_expires_at END,
         updated_at = now()
       RETURNING id`,
      [
        input.googlePlaceId,
        input.name,
        input.category,
        input.lng,
        input.lat,
        GOOGLE_LOCATION_TTL_DAYS,
        input.fetchedAt,
      ],
    )) as Array<{ id: string }>;
    return row.id;
  }
}
```

Đối chiếu SQL với bản đang có trong `share-imports.service.ts` trước khi xóa bản cũ: phải giống hệt về ngữ nghĩa.

- [ ] **Step 2: Đăng ký** trong `places.module.ts` (`providers`, `exports`).

- [ ] **Step 3: Share-to-app dùng service** — inject `GooglePlaceRowsService` vào `ShareImportsService`; thay lời gọi `upsertGooglePlace(m, candidate, option, row.created_at)` bằng:

```ts
await this.googleRows.upsert(
  {
    googlePlaceId: option.googlePlaceId,
    name: candidate.name,
    category: candidate.category,
    lat: option.lat,
    lng: option.lng,
    fetchedAt: row.created_at,
  },
  m,
)
```

Xóa hàm `upsertGooglePlace` và import không còn dùng. `share-import.module.ts` import `PlacesModule` (kiểm tra vòng import: `PlacesModule` không được import `ShareImportModule`).

- [ ] **Step 4: Chạy test**

Run: `pnpm typecheck && npx vitest run src && npx vitest run --config vitest.config.e2e.ts test/share-imports.e2e-spec.ts`
Expected: tất cả qua, đặc biệt các test lưu Google, hạn tọa độ, không ghi đè tọa độ mới hơn.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/places apps/backend/src/modules/share-import
git commit -m "refactor(backend): share Google place row upsert between share and search"
```

---

### Task 3: Hàm thuần — loại gợi ý, giới hạn tìm, định dạng place id

**Files:**
- Create: `apps/backend/src/modules/places/google-category.ts` (+ `google-category.spec.ts`)
- Create: `apps/backend/src/modules/places/place-search-limiter.ts` (+ `place-search-limiter.spec.ts`)
- Create: `apps/backend/src/modules/places/google-place-id.ts` (+ `google-place-id.spec.ts`)

**Interfaces:**
- Produces:

```ts
export function categoryFromGoogleType(primaryType: string | null | undefined): PlaceCategory;
export class PlaceSearchLimiter {
  constructor(limit: number, windowMs?: number /* 24h */, now?: () => number);
  /** true và ghi nhận một lượt nếu còn quota; false nếu đã hết. */
  tryConsume(userId: string): boolean;
}
export const GOOGLE_PLACE_ID_PATTERN: RegExp;   // /^[A-Za-z0-9_-]{1,300}$/
export function isValidGooglePlaceId(value: string): boolean;
```

- [ ] **Step 1: Viết test**

`google-category.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { categoryFromGoogleType } from './google-category.js';

describe('categoryFromGoogleType', () => {
  it.each([
    ['cafe', 'cafe'],
    ['coffee_shop', 'cafe'],
    ['vietnamese_restaurant', 'food'],
    ['restaurant', 'food'],
    ['bakery', 'food'],
    ['night_club', 'nightlife'],
    ['bar', 'nightlife'],
    ['hotel', 'stay'],
    ['lodging', 'stay'],
    ['amusement_park', 'kids'],
    ['zoo', 'kids'],
    ['buddhist_temple', 'culture'],
    ['museum', 'culture'],
    ['national_park', 'nature'],
    ['beach', 'nature'],
    ['tourist_attraction', 'check_in'],
    ['', 'check_in'],
  ])('%s → %s', (type, category) => {
    expect(categoryFromGoogleType(type)).toBe(category);
  });

  it('null/undefined → check_in', () => {
    expect(categoryFromGoogleType(null)).toBe('check_in');
    expect(categoryFromGoogleType(undefined)).toBe('check_in');
  });

  it('cafe trước food: "cafe_restaurant"? — loại chứa cafe được tính là cafe', () => {
    expect(categoryFromGoogleType('cafe_restaurant')).toBe('cafe');
  });
});
```

`place-search-limiter.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { PlaceSearchLimiter } from './place-search-limiter.js';

describe('PlaceSearchLimiter', () => {
  it('cho tối đa `limit` lượt mỗi người trong cửa sổ, người khác tính riêng', () => {
    let t = 0;
    const limiter = new PlaceSearchLimiter(2, 1000, () => t);
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(false);
    expect(limiter.tryConsume('b')).toBe(true);
    t = 1001;
    expect(limiter.tryConsume('a')).toBe(true);
  });

  it('cửa sổ trượt: lượt cũ hết hạn từng cái một', () => {
    let t = 0;
    const limiter = new PlaceSearchLimiter(2, 1000, () => t);
    limiter.tryConsume('a'); // t=0
    t = 500;
    limiter.tryConsume('a'); // t=500
    t = 1001; // lượt t=0 hết hạn, lượt t=500 còn
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(false);
  });
});
```

`google-place-id.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { isValidGooglePlaceId } from './google-place-id.js';

describe('isValidGooglePlaceId', () => {
  it.each(['ChIJN1t_tDeuEmsRUsoyG83frY4', 'abc-DEF_123'])('nhận %s', (id) => {
    expect(isValidGooglePlaceId(id)).toBe(true);
  });
  it.each(['', 'a/b', 'a b', '../x', 'x'.repeat(301), "a'b"])('từ chối %j', (id) => {
    expect(isValidGooglePlaceId(id)).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy, xác nhận lỗi** — `npx vitest run src/modules/places/google-category.spec.ts src/modules/places/place-search-limiter.spec.ts src/modules/places/google-place-id.spec.ts` → FAIL (module không tồn tại).

- [ ] **Step 3: Viết code**

`google-category.ts`:

```ts
import type { PlaceCategory } from '@rong/shared-types';

/**
 * Loại gợi ý từ `primaryType` của Google — chỉ để điền sẵn khi lưu; người dùng
 * xác nhận và chỉ giá trị của Rong được lưu (PRD 7.4). Thứ tự kiểm tra quan
 * trọng: "cafe" trước "restaurant".
 */
const RULES: Array<[PlaceCategory, RegExp]> = [
  ['cafe', /cafe|coffee|tea_house/],
  ['nightlife', /(^|_)bar$|night_club|pub/],
  ['stay', /lodging|hotel|hostel|resort|guest_house|motel|inn/],
  ['kids', /amusement_park|zoo|aquarium|water_park|playground/],
  ['culture', /museum|place_of_worship|church|temple|pagoda|mosque|historical|cultural|monument/],
  ['nature', /park|natural_feature|beach|hiking|garden|lake|mountain/],
  ['food', /restaurant|food|bakery|meal|bistro|diner/],
];

export function categoryFromGoogleType(
  primaryType: string | null | undefined,
): PlaceCategory {
  if (!primaryType) return 'check_in';
  for (const [category, pattern] of RULES) {
    if (pattern.test(primaryType)) return category;
  }
  return 'check_in';
}
```

(Lưu ý: `amusement_park`/`water_park` phải ra `kids`, nên `kids` đứng trước `nature`; `national_park` ra `nature`. Chạy test để xác nhận thứ tự.)

`place-search-limiter.ts`:

```ts
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Giới hạn số lượt tìm Google theo người dùng (cửa sổ trượt). Đếm trong bộ nhớ
 * process — đủ khi chạy một instance (spec §1.1).
 */
export class PlaceSearchLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = DAY_MS,
    private readonly now: () => number = Date.now,
  ) {}

  tryConsume(userId: string): boolean {
    const now = this.now();
    const recent = (this.hits.get(userId) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(userId, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(userId, recent);
    return true;
  }
}
```

(Test "cửa sổ trượt": t=1001, lượt t=0 có `now - t = 1001 ≥ 1000` → hết hạn; lượt t=500 còn → 1 lượt + lượt mới = 2 → `true`, lượt tiếp `false`. Test đầu: t=1001 mọi lượt t=0 hết hạn.)

`google-place-id.ts`:

```ts
/** place_id của Google: chữ, số, `_`, `-`. Chặn ký tự đường dẫn trước khi ghép vào URL Places API. */
export const GOOGLE_PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,300}$/;

export function isValidGooglePlaceId(value: string): boolean {
  return GOOGLE_PLACE_ID_PATTERN.test(value);
}
```

- [ ] **Step 4: Chạy test** → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/places/google-category.ts apps/backend/src/modules/places/google-category.spec.ts apps/backend/src/modules/places/place-search-limiter.ts apps/backend/src/modules/places/place-search-limiter.spec.ts apps/backend/src/modules/places/google-place-id.ts apps/backend/src/modules/places/google-place-id.spec.ts
git commit -m "feat(backend): add place search helpers for category, quota and place id"
```

---

### Task 4: Google — `searchByName` và `preview`

**Files:**
- Modify: `apps/backend/src/modules/google/google-places.service.ts`
- Test: `apps/backend/src/modules/google/google-places.service.spec.ts`

**Interfaces:**
- Consumes: `Bbox` (`[south, west, north, east]`).
- Produces:

```ts
searchByName(query: string, bbox: Bbox, max?: number /* 5 */): Promise<GooglePlaceHit[]>;
preview(placeId: string): Promise<{
  content: GooglePlaceContent;
  location: { lat: number; lng: number } | null;
  primaryType: string | null;
} | null>;   // null khi Google trả 404
```

- [ ] **Step 1: Viết test** (dùng `service()`, `mockFetch`, `header` có sẵn trong spec):

```ts
describe('GooglePlacesService.searchByName', () => {
  it('xin id + tên + địa chỉ, giới hạn trong khung vùng, giữ thứ tự Google', async () => {
    const calls = mockFetch(() => ({
      body: {
        places: [
          { id: 'B', displayName: { text: 'Quán B' }, formattedAddress: '2 Đường B' },
          { id: 'A', displayName: { text: 'Quán A' } },
        ],
      },
    }));
    await expect(
      service().searchByName('quán', [11.8, 108.3, 12.0, 108.6]),
    ).resolves.toEqual([
      { googlePlaceId: 'B', name: 'Quán B', address: '2 Đường B' },
      { googlePlaceId: 'A', name: 'Quán A', address: null },
    ]);
    const [call] = calls;
    expect(call.url).toBe(`${BASE}/places:searchText`);
    expect(header(call, 'X-Goog-FieldMask')).toBe(
      'places.id,places.displayName,places.formattedAddress',
    );
    const body = JSON.parse(call.init.body as string);
    expect(body).toMatchObject({ textQuery: 'quán', regionCode: 'VN', languageCode: 'vi', pageSize: 5 });
    expect(body.locationRestriction.rectangle).toEqual({
      low: { latitude: 11.8, longitude: 108.3 },
      high: { latitude: 12.0, longitude: 108.6 },
    });
  });
});

describe('GooglePlacesService.preview', () => {
  it('như details, thêm location và primaryType', async () => {
    const calls = mockFetch((url) =>
      url.includes('/media')
        ? { body: {} }
        : {
            body: {
              id: 'P1',
              displayName: { text: 'Quán P' },
              location: { latitude: 11.9, longitude: 108.4 },
              primaryType: 'cafe',
            },
          },
    );
    const result = await service().preview('P1');
    expect(result?.content).toMatchObject({ placeId: 'P1', name: 'Quán P' });
    expect(result?.location).toEqual({ lat: 11.9, lng: 108.4 });
    expect(result?.primaryType).toBe('cafe');
    expect(header(calls[0], 'X-Goog-FieldMask')).toContain('location');
    expect(header(calls[0], 'X-Goog-FieldMask')).toContain('primaryType');
  });

  it('404 → null', async () => {
    mockFetch(() => ({ status: 404, body: {} }));
    await expect(service().preview('gone')).resolves.toBeNull();
  });
});
```

Thêm test hồi quy: `details` vẫn **không** xin `location`/`primaryType` (field mask của `details` giữ nguyên).

- [ ] **Step 2: Chạy, xác nhận lỗi** — `npx vitest run src/modules/google` → FAIL.

- [ ] **Step 3: Viết code**

- Import `GooglePlaceHit` từ `@rong/shared-types`.
- Thêm `location?: { latitude: number; longitude: number }` và `primaryType?: string` vào `RawPlace`.
- Tách thân `details` thành `private async fetchDetails(placeId, fieldMask): Promise<{ raw: RawPlace; content: GooglePlaceContent } | null>` (giữ nguyên phần ảnh và ánh xạ); `details` gọi với `DETAILS_FIELDS` và trả `content`; `preview` gọi với `` `${DETAILS_FIELDS},location,primaryType` `` và trả `{ content, location: raw.location ? { lat, lng } : null, primaryType: raw.primaryType ?? null }`.
- `searchByName`:

```ts
  /**
   * Tìm địa điểm theo tên trong khung một vùng (ô tìm địa điểm). Tên/địa chỉ
   * chỉ để hiển thị trực tiếp, không lưu (PRD 7.4); giữ thứ tự Google trả về.
   */
  async searchByName(query: string, bbox: Bbox, max = 5): Promise<GooglePlaceHit[]> {
    const body = await this.request<{
      places?: Array<{ id: string; displayName?: { text?: string }; formattedAddress?: string }>;
    }>('/places:searchText', {
      method: 'POST',
      fieldMask: 'places.id,places.displayName,places.formattedAddress',
      body: {
        textQuery: query,
        languageCode: 'vi',
        regionCode: 'VN',
        pageSize: max,
        locationRestriction: {
          rectangle: {
            low: { latitude: bbox[0], longitude: bbox[1] },
            high: { latitude: bbox[2], longitude: bbox[3] },
          },
        },
      },
    });
    return (body.places ?? []).map((p) => ({
      googlePlaceId: p.id,
      name: p.displayName?.text ?? null,
      address: p.formattedAddress ?? null,
    }));
  }
```

- [ ] **Step 4: Chạy test** — `npx vitest run src/modules/google` → PASS; `pnpm typecheck` sạch.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/google
git commit -m "feat(backend): add Google name search and place preview lookups"
```

---

### Task 5: `PlaceSearchService`, route và e2e

**Files:**
- Create: `apps/backend/src/modules/places/place-search.service.ts`
- Create: `apps/backend/src/modules/places/dto/place-search.dto.ts`, `dto/save-google-place.dto.ts`
- Modify: `apps/backend/src/modules/places/places.controller.ts`, `places.module.ts`
- Modify: `apps/backend/src/config/configuration.ts`, `apps/backend/.env.example`
- Test: `apps/backend/test/place-search.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1 types; `GooglePlaceRowsService` (2); `categoryFromGoogleType`, `PlaceSearchLimiter`, `isValidGooglePlaceId` (3); `GooglePlacesService.searchByName/preview/locate/enabled` (4); `SavedPlacesService.save(userId, placeId, regionId, { source: 'search', shareImportId: null, displayName }, runner)`; `RegionAreaService.ensure(regionId): Promise<Bbox>`.
- Produces routes:
  - `GET /api/regions/:id/places/search?q=&online=` → `PlaceSearchResponse`
  - `GET /api/places/google/:googlePlaceId` → `GooglePlacePreviewResponse`
  - `POST /api/places/google` → 201 `SaveGooglePlaceResponse`
- `AppConfig.placeSearch: { dailyLimit: number }`, provider token `PLACE_SEARCH_CONFIG`.

- [ ] **Step 1: Viết e2e**

`test/place-search.e2e-spec.ts` — `beforeAll` chép từ `test/saved-places.e2e-spec.ts` (AppModule, prefix `api`, ValidationPipe, user `e2e-place-search` + `e2e-place-search-other`, token), thêm override:

```ts
    const google = {
      enabled: true,
      searchByName: vi.fn(),
      preview: vi.fn(),
      locate: vi.fn(),
      details: vi.fn(async () => null),
      matchPlaceId: vi.fn(async () => null),
      searchText: vi.fn(async () => []),
      summary: vi.fn(async () => null),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GooglePlacesService).useValue(google)
      .overrideProvider(PLACE_SEARCH_CONFIG).useValue({ dailyLimit: 3 })
      .compile();
```

Dữ liệu trong Đà Lạt (`vn:destination:da-lat`): OSM `E2E ps Bánh căn Nhà Chung` (osm_id `-9600`, 108.4384/11.9421, `food`), OSM `E2E ps Cà phê Rêu` (osm_id `-9601`, `google_place_id = 'e2e-ps-osm-reu'`), OSM ngoài vùng `E2E ps Bánh căn Sài Gòn` (osm_id `-9602`, 106.7/10.78), dòng Google `E2E ps tên người khác` (`google_place_id = 'e2e-ps-other'`, có tọa độ còn hạn). `beforeEach`: `vi.clearAllMocks()` (xóa lịch sử gọi, giữ implementation mặc định). Limiter không đặt lại được giữa các test: `dailyLimit: 3`, các test khác dùng tối đa 2 lượt online với `token`, test quota dùng `otherToken` riêng. `afterAll` xóa users, `places` có `osm_id <= -9600 AND osm_id > -9700` hoặc `google_place_id LIKE 'e2e-ps-%'`.

Helper `api(as)` với `search(regionId, q, online?)`, `preview(id)`, `save(body)`.

Test:

```ts
  it('danh mục: không dấu vẫn khớp, chỉ OSM trong vùng, không đọc tên dòng Google', async () => {
    const res = await api().search(daLat, 'banh can').expect(200);
    const names = res.body.catalog.map((h: { name: string }) => h.name);
    expect(names).toContain('E2E ps Bánh căn Nhà Chung');
    expect(names).not.toContain('E2E ps Bánh căn Sài Gòn');
    const other = await api().search(daLat, 'tên người khác').expect(200);
    expect(other.body.catalog.map((h: { name: string }) => h.name)).not.toContain('E2E ps tên người khác');
    expect(res.body.google).toBeNull();
    expect(google.searchByName).not.toHaveBeenCalled();
  });

  it('ký tự đặc biệt không lỗi và không khớp bừa', async () => {
    const res = await api().search(daLat, "%_'").expect(200);
    expect(res.body.catalog).toEqual([]);
  });

  it('online: trùng place_id đã có → existing (OSM: tên OSM; Google: tên Google trực tiếp), còn lại giữ thứ tự Google', async () => {
    google.searchByName.mockResolvedValueOnce([
      { googlePlaceId: 'e2e-ps-new-2', name: 'Mới 2', address: 'A2' },
      { googlePlaceId: 'e2e-ps-osm-reu', name: 'Rêu (Google)', address: null },
      { googlePlaceId: 'e2e-ps-other', name: 'Tên Google thật', address: null },
      { googlePlaceId: 'e2e-ps-new-1', name: 'Mới 1', address: 'A1' },
    ]);
    const res = await api().search(daLat, 'quan', true).expect(200);
    expect(res.body.google.map((g: { googlePlaceId: string }) => g.googlePlaceId)).toEqual([
      'e2e-ps-new-2',
      'e2e-ps-new-1',
    ]);
    expect(res.body.existing.map((h: { name: string }) => h.name)).toEqual([
      'E2E ps Cà phê Rêu',
      'Tên Google thật',
    ]);
    expect(google.searchByName.mock.calls[0][1]).toHaveLength(4); // bbox của vùng
  });

  it('Google lỗi → vẫn có danh mục, google: null', async () => {
    google.searchByName.mockRejectedValueOnce(new GoogleUnavailableError('quota'));
    const res = await api().search(daLat, 'banh can', true).expect(200);
    expect(res.body.google).toBeNull();
    expect(res.body.catalog.length).toBeGreaterThan(0);
  });

  it('quá giới hạn tìm online → 429; tìm danh mục vẫn được', async () => {
    google.searchByName.mockResolvedValue([]);
    for (let i = 0; i < 3; i++) await api(otherToken).search(daLat, 'x', true).expect(200);
    const res = await api(otherToken).search(daLat, 'x', true).expect(429);
    expect(res.body.code).toBe('PLACE_SEARCH_LIMIT');
    await api(otherToken).search(daLat, 'x').expect(200);
  });

  it('vùng không tồn tại → 404 REGION_NOT_FOUND', async () => {
    const res = await api().search('00000000-0000-0000-0000-000000000000', 'x').expect(404);
    expect(res.body.code).toBe('REGION_NOT_FOUND');
  });

  it('xem trước: đã có trong DB → { placeId }; chưa có → nội dung trực tiếp; không ghi DB', async () => {
    const before = await countPlaces();
    const known = await api().preview('e2e-ps-osm-reu').expect(200);
    expect(known.body).toEqual({ placeId: osmReu });
    google.preview.mockResolvedValueOnce({
      content: { placeId: 'e2e-ps-new-1', name: 'Mới 1', googleMapsUri: null, address: 'A1', rating: 4.5,
                 ratingCount: 10, openNow: null, weekdayHours: [], reviews: [], photos: [] },
      location: { lat: 11.95, lng: 108.44 },
      primaryType: 'coffee_shop',
    });
    const fresh = await api().preview('e2e-ps-new-1').expect(200);
    expect(fresh.body).toMatchObject({
      googlePlaceId: 'e2e-ps-new-1',
      name: 'Mới 1',
      suggestedCategory: 'cafe',
      coordinates: { lat: 11.95, lng: 108.44 },
    });
    expect(await countPlaces()).toBe(before);
  });

  it('xem trước: id sai định dạng → 400; Google không còn → 404', async () => {
    expect((await api().preview('a%2Fb').expect(400)).body.code).toBe('INVALID_GOOGLE_PLACE_ID');
    google.preview.mockResolvedValueOnce(null);
    expect((await api().preview('e2e-ps-gone').expect(404)).body.code).toBe('PLACE_NOT_FOUND');
  });

  it('lưu: tạo một dòng Google với tên người dùng, lưu "Muốn đi" nguồn search; lưu lại idempotent', async () => {
    google.locate.mockResolvedValue({ lat: 11.95, lng: 108.44 });
    const body = { googlePlaceId: 'e2e-ps-new-1', name: '  Quán của tôi  ', category: 'cafe', regionId: daLat };
    const first = await api().save(body).expect(201);
    const second = await api().save(body).expect(201);
    expect(second.body.placeId).toBe(first.body.placeId);
    const rows = await db.query(
      `SELECT name, source FROM places WHERE google_place_id = 'e2e-ps-new-1'`,
    );
    expect(rows).toEqual([{ name: 'Quán của tôi', source: 'google' }]);
    const [saved] = await db.query(
      `SELECT source, display_name FROM saved_places WHERE place_id = $1`, [first.body.placeId],
    );
    expect(saved).toEqual({ source: 'search', display_name: 'Quán của tôi' });
  });

  it('lưu một place_id đã ghép vào OSM → lưu dòng OSM, không tạo dòng Google', async () => {
    const res = await api().save({ googlePlaceId: 'e2e-ps-osm-reu', name: 'Rêu', category: 'cafe', regionId: daLat }).expect(201);
    expect(res.body.placeId).toBe(osmReu);
    const [{ n }] = await db.query(
      `SELECT count(*)::int AS n FROM places WHERE source = 'google' AND google_place_id = 'e2e-ps-osm-reu'`,
    );
    expect(n).toBe(0);
  });

  it('lưu: Google không trả tọa độ → 404; tên rỗng → 400', async () => {
    google.locate.mockResolvedValueOnce(null);
    expect((await api().save({ googlePlaceId: 'e2e-ps-gone2', name: 'x', category: 'food', regionId: daLat }).expect(404)).body.code).toBe('PLACE_NOT_FOUND');
    await api().save({ googlePlaceId: 'e2e-ps-new-9', name: '   ', category: 'food', regionId: daLat }).expect(400);
  });
```

`countPlaces()` = `SELECT count(*)::int FROM places`. `osmReu` là id dòng OSM `-9601`. Đà Lạt cần có bbox (seed điểm đến có sẵn bbox).

- [ ] **Step 2: Chạy, xác nhận lỗi** — `npx vitest run --config vitest.config.e2e.ts test/place-search.e2e-spec.ts` → FAIL (route 404).

- [ ] **Step 3: Cấu hình** — `configuration.ts`: `export interface PlaceSearchConfig { dailyLimit: number }`, `placeSearch: PlaceSearchConfig` trong `AppConfig`, `placeSearch: { dailyLimit: toInt(process.env.PLACE_SEARCH_DAILY_LIMIT, 60) }`. `.env.example`:

```
# Tìm địa điểm trong màn vùng: số lượt tìm Google Maps tối đa mỗi người trong 24 giờ.
PLACE_SEARCH_DAILY_LIMIT=60
```

- [ ] **Step 4: DTO**

`dto/place-search.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class PlaceSearchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  q!: string;

  /** Tìm thêm Google Maps — chỉ khi người dùng bấm tìm (tính phí theo lượt). */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  online?: boolean;
}
```

`dto/save-google-place.dto.ts`:

```ts
import { Transform } from 'class-transformer';
import { IsIn, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import type { PlaceCategory } from '@rong/shared-types';

import { PLACE_CATEGORIES } from '../entities/place.entity.js';
import { GOOGLE_PLACE_ID_PATTERN } from '../google-place-id.js';

export class SaveGooglePlaceDto {
  @IsString()
  @Matches(GOOGLE_PLACE_ID_PATTERN)
  googlePlaceId!: string;

  /** Tên người dùng xác nhận — không phải tên Google (PRD 7.4). */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsIn(PLACE_CATEGORIES)
  category!: PlaceCategory;

  @IsUUID()
  regionId!: string;
}
```

(`@Matches` sai trả 400 với mã mặc định của ValidationPipe; mã `INVALID_GOOGLE_PLACE_ID` chỉ bắt buộc cho route GET xem trước — kiểm trong service.)

- [ ] **Step 5: `PlaceSearchService`**

```ts
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  GooglePlaceHit,
  GooglePlacePreviewResponse,
  PlaceCategory,
  PlaceSearchHit,
  PlaceSearchResponse,
  SaveGooglePlaceResponse,
} from '@rong/shared-types';
import { DataSource } from 'typeorm';

import type { PlaceSearchConfig } from '../../config/configuration.js';
import { GooglePlacesService, GoogleUnavailableError } from '../google/google-places.service.js';
import { RegionAreaService } from '../regions/region-area.service.js';
import { SavedPlacesService } from '../saved-places/saved-places.service.js';
import type { SaveGooglePlaceDto } from './dto/save-google-place.dto.js';
import { categoryFromGoogleType } from './google-category.js';
import { isValidGooglePlaceId } from './google-place-id.js';
import { GooglePlaceRowsService } from './google-place-rows.service.js';
import { PlaceSearchLimiter } from './place-search-limiter.js';

export const PLACE_SEARCH_CONFIG = 'PLACE_SEARCH_CONFIG';

const CATALOG_LIMIT = 10;
const GOOGLE_LIMIT = 5;
const MIN_SIMILARITY = 0.3;

interface HitRow {
  id: string;
  name: string;
  category: PlaceCategory;
  source: 'osm' | 'google';
  google_place_id: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * Tìm địa điểm theo tên trong một vùng: danh mục OSM khi gõ, Google Maps khi
 * bấm tìm; xem trước và lưu kết quả Google vào "Muốn đi". Không lưu nội dung
 * Google; không xếp hạng trên dữ liệu Google (PRD 7.4).
 */
@Injectable()
export class PlaceSearchService {
  private readonly logger = new Logger(PlaceSearchService.name);
  private readonly limiter: PlaceSearchLimiter;

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly areas: RegionAreaService,
    private readonly google: GooglePlacesService,
    private readonly googleRows: GooglePlaceRowsService,
    private readonly saved: SavedPlacesService,
    @Inject(PLACE_SEARCH_CONFIG) config: PlaceSearchConfig,
  ) {
    this.limiter = new PlaceSearchLimiter(config.dailyLimit);
  }

  async search(userId: string, regionId: string, q: string, online: boolean): Promise<PlaceSearchResponse> {
    await this.requireRegion(regionId);
    if (online && !this.limiter.tryConsume(userId)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'PLACE_SEARCH_LIMIT',
          message: 'Bạn đã tìm trên Google Maps nhiều lần hôm nay. Thử lại sau nhé.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const bbox = await this.areas.ensure(regionId);
    const query = q.trim();

    const catalog = (await this.db.query(
      `WITH nq AS (SELECT unaccent(lower($1)) AS q)
       SELECT p.id, p.name, p.category, p.source, p.google_place_id,
              ST_Y(p.location) AS lat, ST_X(p.location) AS lng
         FROM places p, nq
        WHERE p.source = 'osm'
          AND p.location && ST_MakeEnvelope($2, $3, $4, $5, 4326)
          AND (similarity(unaccent(lower(p.name)), nq.q) >= $6
               OR position(nq.q IN unaccent(lower(p.name))) > 0)
        ORDER BY similarity(unaccent(lower(p.name)), nq.q) DESC, p.composite_score DESC, p.id
        LIMIT $7`,
      [query, bbox[1], bbox[0], bbox[3], bbox[2], MIN_SIMILARITY, CATALOG_LIMIT],
    )) as HitRow[];

    let google: GooglePlaceHit[] | null = null;
    let existing: PlaceSearchHit[] = [];
    if (online && this.google.enabled) {
      try {
        const hits = await this.google.searchByName(query, bbox, GOOGLE_LIMIT);
        const known = await this.byGoogleIds(hits.map((h) => h.googlePlaceId));
        existing = hits.flatMap((h) => {
          const row = known.get(h.googlePlaceId);
          if (!row) return [];
          // Dòng Google: tên trong DB do người khác đặt — hiện tên Google trực tiếp.
          return [toHit(row, row.source === 'google' ? (h.name ?? row.name) : row.name)];
        });
        google = hits.filter((h) => !known.has(h.googlePlaceId));
      } catch (error) {
        if (!(error instanceof GoogleUnavailableError)) throw error;
        this.logger.warn(`Tìm Google "${query}" lỗi: ${error.message}`);
        google = null;
      }
    }
    return { catalog: catalog.map((r) => toHit(r, r.name)), existing, google };
  }

  async preview(googlePlaceId: string): Promise<GooglePlacePreviewResponse> {
    if (!isValidGooglePlaceId(googlePlaceId)) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_GOOGLE_PLACE_ID',
        message: 'Mã địa điểm không hợp lệ.',
      });
    }
    const known = (await this.byGoogleIds([googlePlaceId])).get(googlePlaceId);
    if (known) return { placeId: known.id };
    if (!this.google.enabled) throw googleUnavailable();
    let result: Awaited<ReturnType<GooglePlacesService['preview']>>;
    try {
      result = await this.google.preview(googlePlaceId);
    } catch (error) {
      if (error instanceof GoogleUnavailableError) throw googleUnavailable();
      throw error;
    }
    if (!result) throw placeNotFound();
    return {
      googlePlaceId,
      name: result.content.name,
      address: result.content.address,
      coordinates: result.location,
      suggestedCategory: categoryFromGoogleType(result.primaryType),
      google: result.content,
    };
  }

  async save(userId: string, dto: SaveGooglePlaceDto): Promise<SaveGooglePlaceResponse> {
    const known = (await this.byGoogleIds([dto.googlePlaceId])).get(dto.googlePlaceId);
    let placeId = known?.id ?? null;
    let location: { lat: number; lng: number } | null = null;
    if (!placeId) {
      if (!this.google.enabled) throw googleUnavailable();
      try {
        location = await this.google.locate(dto.googlePlaceId);
      } catch (error) {
        if (error instanceof GoogleUnavailableError) throw googleUnavailable();
        throw error;
      }
      if (!location) throw placeNotFound();
    }
    await this.db.transaction(async (m) => {
      if (!placeId && location) {
        placeId = await this.googleRows.upsert(
          { googlePlaceId: dto.googlePlaceId, name: dto.name, category: dto.category,
            lat: location.lat, lng: location.lng, fetchedAt: new Date() },
          m,
        );
      }
      await this.saved.save(
        userId,
        placeId!,
        dto.regionId,
        { source: 'search', shareImportId: null, displayName: dto.name },
        m,
      );
    });
    return { placeId: placeId! };
  }

  /** Dòng `places` (OSM đã ghép hoặc nguồn Google) theo place_id; OSM ưu tiên. */
  private async byGoogleIds(ids: string[]): Promise<Map<string, HitRow>> {
    if (ids.length === 0) return new Map();
    const rows = (await this.db.query(
      `SELECT p.id, p.name, p.category, p.source, p.google_place_id,
              ST_Y(p.location) AS lat, ST_X(p.location) AS lng
         FROM places p
        WHERE p.google_place_id = ANY($1::text[])
        ORDER BY (p.source = 'osm') DESC`,
      [ids],
    )) as HitRow[];
    const map = new Map<string, HitRow>();
    for (const row of rows) if (!map.has(row.google_place_id!)) map.set(row.google_place_id!, row);
    return map;
  }

  private async requireRegion(regionId: string): Promise<void> {
    const [row] = (await this.db.query(`SELECT 1 FROM regions WHERE id = $1`, [regionId])) as unknown[];
    if (!row) {
      throw new NotFoundException({ statusCode: 404, code: 'REGION_NOT_FOUND', message: 'Không tìm thấy vùng này.' });
    }
  }
}

function toHit(row: HitRow, name: string): PlaceSearchHit {
  return {
    id: row.id,
    name,
    category: row.category,
    coordinates: row.lat !== null && row.lng !== null ? { lat: Number(row.lat), lng: Number(row.lng) } : null,
  };
}

function googleUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    statusCode: 503,
    code: 'GOOGLE_UNAVAILABLE',
    message: 'Tạm thời không kết nối được Google Maps. Thử lại sau nhé.',
  });
}

function placeNotFound(): NotFoundException {
  return new NotFoundException({
    statusCode: 404,
    code: 'PLACE_NOT_FOUND',
    message: 'Địa điểm này không còn trên Google Maps.',
  });
}
```

Ghi chú: dòng `places` có `location` NULL (Google hết hạn) vẫn được trả trong `existing` với `coordinates: null` — chi tiết sẽ gọi `ensure`. Kiểm tra `SavedPlacesService.save` đã nhận `runner` (tham số thứ 5) — có từ share-to-app.

- [ ] **Step 6: Route và module**

`places.controller.ts`: trong `PlacesController` thêm

```ts
  /** Tìm địa điểm theo tên trong vùng: danh mục khi gõ, thêm Google Maps khi `online`. */
  @Get(':id/places/search')
  search(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() dto: PlaceSearchDto,
  ): Promise<PlaceSearchResponse> {
    return this.search.search(user.userId, id, dto.q, dto.online ?? false);
  }
```

(đặt tên field inject khác tên method, ví dụ `private readonly placeSearch: PlaceSearchService`), và trong `PlaceDetailController` thêm `@Get('google/:googlePlaceId')` → `preview`, `@Post('google')` → `save` (trả 201 mặc định). Import `CurrentUser`, `AuthUser` như `saved-places.controller.ts`.

`places.module.ts`: providers thêm `PlaceSearchService`, `GooglePlaceRowsService` (nếu chưa), provider `{ provide: PLACE_SEARCH_CONFIG, inject: [ConfigService], useFactory: (c) => c.getOrThrow<AppConfig['placeSearch']>('placeSearch') }`; imports thêm `SavedPlacesModule`.

- [ ] **Step 7: Chạy test**

Run: `pnpm typecheck && npx oxlint --type-aware src/modules/places && npx vitest run src && npx vitest run --config vitest.config.e2e.ts test/place-search.e2e-spec.ts test/share-imports.e2e-spec.ts test/saved-places.e2e-spec.ts test/places-source.e2e-spec.ts`
Expected: tất cả qua.

- [ ] **Step 8: Commit**

```bash
git add apps/backend
git commit -m "feat(backend): search places by name within a region with Google preview and save"
```

---

### Task 6: Mobile — ô tìm trong màn vùng

**Files:**
- Create: `apps/mobile/src/hooks/use-place-search.ts`
- Create: `apps/mobile/src/components/place-search-results.tsx`
- Modify: `apps/mobile/src/app/(app)/region/[id].tsx`

**Interfaces:**
- Produces:

```ts
export function usePlaceSearch(regionId: string, query: string): {
  status: 'idle' | 'loading' | 'done' | 'error';
  catalog: PlaceSearchHit[];
  existing: PlaceSearchHit[];
  google: GooglePlaceHit[] | null;
  searchedOnline: boolean;
  error: ApiError | null;
  submit: () => void;   // tìm online với query hiện tại
  retry: () => void;
};
export function PlaceSearchResults(props: {
  search: ReturnType<typeof usePlaceSearch>;
  regionId: string;
  regionName: string;
  query: string;
}): JSX.Element;
```

- [ ] **Step 1: Hook** — theo mẫu `src/hooks/use-region-search.ts` (đọc file): debounce 300 ms gọi `GET /regions/${regionId}/places/search?q=…` không online; `submit` gọi với `online=true`; chỉ nhận phản hồi lần gọi mới nhất (`latest` ref); query rỗng → `idle`; lỗi → `ApiError` (`PLACE_SEARCH_LIMIT` hiển thị nguyên `message`).

- [ ] **Step 2: `PlaceSearchResults`** — `FlatList` từ `react-native-gesture-handler`, `keyboardShouldPersistTaps="handled"`, `keyboardDismissMode="on-drag"`; dữ liệu là danh sách phẳng có tiêu đề nhóm:
  - "Trong Rong": `catalog` rồi `existing` (bỏ trùng id); mỗi dòng tên + `CATEGORY_LABELS[category]`; chạm → `router.push({ pathname: '/place/[id]', params: { id, name, category, regionId, regionName } })`.
  - Nút "Tìm trên Google Maps" (`Button`, kiểu chính khi `catalog` và `existing` rỗng, ngược lại `variant="plain"`), ẩn khi `searchedOnline` và đang `done`; `loading` hiện `ActivityIndicator`.
  - "Từ Google Maps": khi `google` khác null; mỗi dòng tên (`name ?? 'Không rõ tên'`), địa chỉ; chân nhóm ghi "Kết quả từ Google Maps"; chạm → `router.push({ pathname: '/place/google/[googlePlaceId]', params: { googlePlaceId, regionId, regionName, q: query } })`.
  - `searchedOnline` mà cả ba rỗng → "Không tìm thấy “q” ở <vùng>".
  - `error` → `Notice` tone danger + "Thử lại".

- [ ] **Step 3: Màn vùng** — trong `header` của `PlaceSheet`, trên hàng chip nguồn, thêm `SearchField` (`src/components/ui/search-field.tsx`) với `placeholder={\`Tìm quán, điểm tham quan ở ${regionName}\`}`, `onSubmitEditing={search.submit}`, `onFocus={() => setDetent('full')}`. State `placeQuery`; khi `placeQuery.trim()` khác rỗng, `children` của `PlaceSheet` là `<PlaceSearchResults …/>` thay cho `FlatList` hiện tại và ẩn hai hàng chip. Đọc param `q` (thêm `q?: string` vào `Params`) để điền sẵn ô tìm khi mở từ màn share (Task 7). Nếu `SearchField` (viên kính) không hợp nền sheet, dùng `TextField` hiện có — ghi lại lựa chọn trong report.

- [ ] **Step 4: Kiểm tra** — `pnpm --filter @rong/mobile typecheck && pnpm --filter @rong/mobile lint` sạch (route `/place/google/[googlePlaceId]` chưa có thì tạo file tạm `export default function GooglePlacePreviewScreen() { return null; }` cho typed routes; Task 7 viết đầy đủ; nếu typed routes chưa nhận route mới, chạy `pnpm --filter @rong/mobile start` một lúc để sinh lại `.expo/types`).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src
git commit -m "feat(mobile): search places by name in the region screen"
```

---

### Task 7: Mobile — màn xem trước, lưu, "Tự tìm"

**Files:**
- Create: `apps/mobile/src/hooks/use-google-place-preview.ts`
- Create: `apps/mobile/src/components/save-google-place-sheet.tsx`
- Modify/Create: `apps/mobile/src/app/(app)/place/google/[googlePlaceId].tsx`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx` (`<Stack.Screen name="place/google/[googlePlaceId]" />`)
- Modify: `apps/mobile/src/app/(app)/share-import/[id].tsx` ("Tự tìm")

**Interfaces:**
- Consumes: `GooglePlacePreviewResponse`, `SaveGooglePlaceRequest`, `SaveGooglePlaceResponse`; `GooglePlaceContentBlock` (`src/components/google-place-content.tsx`); `ActionSheet` (`src/components/ui/action-sheet.tsx`, nhận `children`); `useSavedPlaces().reload`.

- [ ] **Step 1: Hook** `useGooglePlacePreview(googlePlaceId)` → `{ status, data: GooglePlacePreviewResponse | null, error, reload }` theo mẫu `use-place-detail.ts`.

- [ ] **Step 2: Màn xem trước**
  - Khi `data` có `placeId` → `router.replace({ pathname: '/place/[id]', params: { id: data.placeId, regionId, regionName } })`.
  - Ngược lại hiện: nút quay lại (như `place/[id].tsx`), tên Google (`data.name ?? 'Địa điểm trên Google Maps'`), địa chỉ, nhãn "Chưa có trong Rong", bản đồ nhỏ một ghim nếu `coordinates` (dùng thành phần bản đồ đang dùng ở `place/[id].tsx` nếu có; không có thì bỏ bản đồ), `<GooglePlaceContentBlock content={data.google} />`.
  - Nút chính "Lưu vào Muốn đi" mở `SaveGooglePlaceSheet`.
  - Lỗi: `PLACE_NOT_FOUND` → "Địa điểm này không còn trên Google Maps."; còn lại → `Notice` + "Thử lại".
  - Bọc `<Screen>` (hoặc tự chừa vùng an toàn nếu có bản đồ tràn mép, theo `apps/mobile/CLAUDE.md`).

- [ ] **Step 3: `SaveGooglePlaceSheet`** — dùng `ActionSheet` với `children`: `TextField` "Tên" (giá trị đầu = param `q` nếu có, không thì `data.name ?? ''`), dòng phụ "Tên trên Google: <data.name>" khi khác; hàng `Chip` chọn loại (`CATEGORIES`, chọn sẵn `suggestedCategory`); nút "Lưu" disabled khi tên rỗng hoặc đang lưu. Lưu → `authFetch<SaveGooglePlaceResponse>('/places/google', { method: 'POST', body: { googlePlaceId, name, category, regionId } })` → `saved.reload()` → `router.replace` sang `/place/[id]`. Lỗi → `Alert.alert('Chưa lưu được', message)`. Ô nhập không bị bàn phím che (`KeyboardAvoider` từ `src/components/screen.tsx`).

- [ ] **Step 4: "Tự tìm" trong màn share** — nút hiện `router.push('/search')`. Đổi: nếu ứng viên có `options[0]` → `router.push({ pathname: '/region/[id]', params: { id: options[0].regionId, name: options[0].regionName, q: candidate.name } })`; ứng viên không có lựa chọn → giữ `/search`.

- [ ] **Step 5: Kiểm tra** — `pnpm --filter @rong/mobile typecheck && pnpm --filter @rong/mobile lint` sạch. Mô tả trong report cách từng trạng thái hiển thị.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src
git commit -m "feat(mobile): preview Google places and save them to the wishlist"
```

---

### Task 8: Tài liệu

**Files:**
- Modify: `apps/backend/src/modules/README.md`, `CLAUDE.md` (gốc)

- [ ] **Step 1: README** — mục `places/`: thêm ba route tìm/xem trước/lưu, quy tắc (danh mục chỉ OSM; Google khi bấm tìm, giới hạn `PLACE_SEARCH_DAILY_LIMIT`; tên lưu là tên người dùng xác nhận; kết quả trùng place_id trả là địa điểm có sẵn); `GooglePlaceRowsService` dùng chung với share-to-app; nguồn `'search'` của "Muốn đi".

- [ ] **Step 2: CLAUDE.md gốc** — trong phần "Places: two pipelines" hoặc ngay sau, thêm một gạch đầu dòng ngắn: "**Place search** (`GET /regions/:id/places/search`, `GET /places/google/:googlePlaceId`, `POST /places/google`): catalog matches while typing, Google Text Search only on submit (per-user daily limit), Google results previewed live and saved as `source = 'google'` rows named by the user."

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/modules/README.md CLAUDE.md
git commit -m "docs: document place search"
```

---

## Cuối cùng

- [ ] Backend: `pnpm test`, `pnpm typecheck`, e2e chạy tuần tự `npx vitest run --config vitest.config.e2e.ts --no-file-parallelism`.
- [ ] Mobile: typecheck, lint; thử tay trên Android dev/release build: tìm danh mục, tìm Google, xem trước, lưu, mở chi tiết, "Tự tìm" từ màn share.
