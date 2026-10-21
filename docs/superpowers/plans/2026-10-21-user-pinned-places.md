# Địa điểm tự ghim và ghi chú riêng — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người dùng tự ghim một địa điểm app không tìm được (từ màn chia sẻ hoặc màn Vùng), ghi chú riêng (mô tả, giờ mở cửa, giá) cho mọi điểm, và lịch trình đọc trực tiếp ghi chú của người tạo, dùng giờ mở cửa đó khi xếp giờ.

**Architecture:** Điểm tự ghim là dòng `places.source = 'user'` (có `created_by`), nên lịch trình và "Muốn đi" dùng được ngay. Ghi chú nằm ở bảng `place_notes (user_id, place_id)`, một bản duy nhất: `GET /saved-places`, `GET /places/:id` đọc ghi chú của người xem; lịch trình (app, nhóm, link công khai) đọc ghi chú của người tạo lịch trình qua `withItineraryPlaceData`; bộ xếp giờ lấy giờ mở cửa của người tạo qua `ItineraryPlanner.loadPlaces`/`poolInArea`. Địa chỉ dưới ghim lấy bằng Nominatim reverse qua `OpenDataService`.

**Tech Stack:** NestJS 12 (ESM, raw SQL `DataSource.query`, vitest, e2e trên Neon dev), Postgres/PostGIS, Expo SDK 57 / React Native 0.86 (Jest + RNTL 14), `react-native-maps`, Next.js 16 (trang `/t/:token`).

**Spec:** `docs/superpowers/specs/2026-10-21-user-pinned-places-design.md`

## Global Constraints

- **Điều kiện trước:** branch `feat/saved-places-to-region` đã vào `main` (SavedPlace có `coordinates`, `locationSource`; màn Vùng có mục "Muốn đi"). Trước Task 1: `git fetch && git rebase origin/main` trên `feat/user-pinned-places`.
- **Hỏi người dùng trước khi chạy `pnpm migration:run` trên Neon dev** (Task 1 Step 4 là điểm dừng).
- Backend ESM: import tương đối kết thúc `.js`. Lỗi dạng `{ statusCode, code, message }`. Comment, log, thông báo lỗi bằng tiếng Việt.
- Sau khi sửa `packages/shared-types`: chạy `pnpm build:deps` trong `apps/backend` trước `vitest`/`tsc`.
- Điểm `user` **không bao giờ** lọt vào danh sách vùng, tìm theo tên, khớp khi share, gợi ý trang chủ, điểm AI thêm (các luồng này chỉ đọc `source = 'web'` / `region_places`; không sửa chúng).
- Ghi chú: `note` ≤ 1 000 ký tự; `opening_hours` ≤ 200 ký tự và `parseOpeningHours` đọc được; `price_min`, `price_max` số nguyên 0…100 000 000, `price_max ≥ price_min`.
- Ghim: trong khung bao vùng nới `0.02` độ (~2 km); 30 điểm mỗi người trong 24 giờ, 500 điểm mỗi người.
- Reverse geocode: cache ô làm tròn 4 chữ số, 24 giờ; 60 lần mỗi người mỗi giờ; timeout 3 giây; mọi lỗi → `{ address: null }`.
- Thẻ địa chỉ ở màn ghim gọi reverse sau khi ghim đứng yên **1 giây**.
- Mobile: tuân `apps/mobile/CLAUDE.md` (màn tràn mép tự chừa insets, ô nhập trong `KeyboardAvoider`, `ScrollView`/`FlatList` trong sheet lấy từ `react-native-gesture-handler`). Nhãn nút một dòng.
- Commit nhỏ; kết thúc commit message bằng hai dòng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` và `Claude-Session: https://claude.ai/code/session_015S5xgNGKuhWfNwaXixQCX4`.

## Review Focus

1. **Lộ điểm tự ghim:** một người khác tìm theo tên trong vùng, mở danh sách vùng, share bài có cùng tên quán → không bao giờ thấy điểm `user` của người khác (test cách ly ở Task 3).
2. **Ghi chú trong lịch trình nhóm:** thành viên nhóm (không phải người tạo) mở lịch trình → thấy ghi chú của **người tạo**, không phải của mình; `PATCH /places/:id/notes` của thành viên chỉ sửa ghi chú riêng của họ (Task 6).
3. **Giờ trong ghi chú làm thay đổi xếp giờ:** quán ghi "đóng cửa trước 10:00" mà mục xếp 14:00 → `PUT` sinh cảnh báo `place_closed` (Task 6).
4. **Phản hồi reverse cũ về muộn:** kéo ghim A → dừng → kéo sang B → phản hồi của A về sau B → thẻ vẫn hiện địa chỉ B (Task 8, hook `usePinAddress`).
5. **Chuỗi giờ form không biểu diễn được** (ví dụ `Mo-Fr 08:00-12:00,13:30-17:00`) → form hiện chuỗi gốc, không ghi đè khi người dùng chỉ sửa giá (Task 7).

---

### Task 1: Migration và kiểu dùng chung

**Files:**
- Create: `apps/backend/src/database/migrations/1792500000000-AddUserPlacesAndNotes.ts`
- Modify: `apps/backend/src/modules/places/entities/place.entity.ts` (kiểu `source`, `location_source`, cột `created_by`)
- Modify: `packages/shared-types/src/place.ts`, `packages/shared-types/src/itinerary.ts`, `packages/shared-types/src/share-import.ts` (hoặc file đang chứa `ShareImportCandidate`)
- Test: `apps/backend/test/user-places.e2e-spec.ts` (tạo mới; test ràng buộc DB)

**Interfaces:**
- Produces (shared-types):
  ```ts
  export type LocationSource = 'google' | 'ai' | 'user';
  export interface PlaceNotes { note: string | null; openingHours: string | null; priceMin: number | null; priceMax: number | null }
  // SavedPlace += notes: PlaceNotes | null
  // PlaceDetail += notes: PlaceNotes | null; createdByMe: boolean
  // ItineraryPlaceSnapshot += notes?: PlaceNotes | null
  // ShareImportCandidate += regionHint: { id: string; name: string } | null
  export interface CreateUserPlaceRequest { name: string; category: PlaceCategory; lat: number; lng: number; regionId: string; address?: string | null; notes?: Partial<PlaceNotes>; shareImportId?: string }
  export interface CreateUserPlaceResponse { placeId: string }
  export interface ReverseGeocodeResponse { address: string | null }
  ```

- [ ] **Step 1: Viết migration**

```ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Địa điểm tự ghim và ghi chú riêng (spec 2026-10-21-user-pinned-places).
 * - `places.source = 'user'`: người dùng tự ghim, `created_by` là người tạo, tọa độ do người dùng đặt.
 * - `place_notes`: mỗi (người dùng, địa điểm) một ghi chú — mô tả, giờ mở cửa, giá mỗi người.
 */
export class AddUserPlacesAndNotes1792500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "places"
        ADD COLUMN "created_by" uuid,
        ADD CONSTRAINT "fk_place_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE CASCADE,
        DROP CONSTRAINT "chk_place_location_source",
        DROP CONSTRAINT "chk_place_source",
        ADD CONSTRAINT "chk_place_location_source" CHECK ("location_source" IN ('google', 'ai', 'user')),
        ADD CONSTRAINT "chk_place_source" CHECK (
          ("source" = 'google' AND "google_place_id" IS NOT NULL AND "location_source" = 'google' AND "created_by" IS NULL)
          OR ("source" = 'web' AND "created_by" IS NULL AND (
                ("location_source" = 'google' AND "google_place_id" IS NOT NULL)
             OR ("location_source" = 'ai' AND "google_place_id" IS NULL AND "location" IS NOT NULL)))
          OR ("source" = 'user' AND "created_by" IS NOT NULL AND "location" IS NOT NULL
              AND "location_source" = 'user' AND "google_place_id" IS NULL)
        )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_places_created_by" ON "places" ("created_by", "created_at") WHERE "source" = 'user'`,
    );
    await queryRunner.query(`
      CREATE TABLE "place_notes" (
        "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
        "place_id" uuid NOT NULL REFERENCES "places" ("id") ON DELETE CASCADE,
        "note" text,
        "opening_hours" text,
        "price_min" integer,
        "price_max" integer,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_place_notes" PRIMARY KEY ("user_id", "place_id"),
        CONSTRAINT "chk_place_notes_note" CHECK (char_length("note") <= 1000),
        CONSTRAINT "chk_place_notes_hours" CHECK (char_length("opening_hours") <= 200),
        CONSTRAINT "chk_place_notes_price" CHECK (
          ("price_min" IS NULL OR "price_min" BETWEEN 0 AND 100000000)
          AND ("price_max" IS NULL OR "price_max" BETWEEN 0 AND 100000000)
          AND ("price_min" IS NULL OR "price_max" IS NULL OR "price_max" >= "price_min"))
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "place_notes"`);
    await queryRunner.query(`DELETE FROM "places" WHERE "source" = 'user'`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_places_created_by"`);
    await queryRunner.query(`
      ALTER TABLE "places"
        DROP CONSTRAINT "chk_place_source",
        DROP CONSTRAINT "chk_place_location_source",
        DROP CONSTRAINT "fk_place_created_by",
        DROP COLUMN "created_by",
        ADD CONSTRAINT "chk_place_location_source" CHECK ("location_source" IN ('google', 'ai')),
        ADD CONSTRAINT "chk_place_source" CHECK (
          ("source" = 'google' AND "google_place_id" IS NOT NULL AND "location_source" = 'google')
          OR ("source" = 'web' AND (
                ("location_source" = 'google' AND "google_place_id" IS NOT NULL)
             OR ("location_source" = 'ai' AND "google_place_id" IS NULL AND "location" IS NOT NULL)))
        )
    `);
  }
}
```

(`places.created_at` đã có từ migration `CreateRegionsAndPlaces`; index và giới hạn 24 giờ ở Task 3 dùng cột này.)

- [ ] **Step 2: Cập nhật entity và shared-types** theo Interfaces ở trên. Trong `place.entity.ts`: `source!: 'google' | 'web' | 'user'`, `locationSource` thêm `'user'`, thêm `@Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy!: string | null;`. `PlaceDetail` thêm `notes` và `createdByMe`; `SavedPlace` thêm `notes`; `ItineraryPlaceSnapshot` thêm `notes?`; `ShareImportCandidate` thêm `regionHint`. Thêm các kiểu request/response ở Interfaces.

- [ ] **Step 3: Viết test ràng buộc (sẽ đỏ tới khi migration chạy)** — `apps/backend/test/user-places.e2e-spec.ts`, dựng `beforeAll` theo `test/saved-places.e2e-spec.ts` (AppModule, prefix `api`, `ValidationPipe`, user `e2e-user-places` và `e2e-user-places-other`, JWT). Test đầu tiên:

```ts
it('DB: dòng user cần created_by và tọa độ; place_notes chặn giá ngược', async () => {
  await expect(
    db.query(
      `INSERT INTO places (source, name, category, location, location_source)
       VALUES ('user', 'E2E up thiếu người tạo', 'food', ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326), 'user')`,
    ),
  ).rejects.toThrow(/chk_place_source/);
  const [row] = (await db.query(
    `INSERT INTO places (source, name, category, location, location_source, created_by)
     VALUES ('user', 'E2E up hợp lệ', 'food', ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326), 'user', $1)
     RETURNING id`,
    [userId],
  )) as Array<{ id: string }>;
  await expect(
    db.query(`INSERT INTO place_notes (user_id, place_id, price_min, price_max) VALUES ($1, $2, 200, 100)`, [userId, row.id]),
  ).rejects.toThrow(/chk_place_notes_price/);
});
```
`afterAll`: `DELETE FROM places WHERE name LIKE 'E2E up %'`, xóa user `e2e-user-places%`.

- [ ] **Step 4: DỪNG — hỏi người dùng** "Chạy `pnpm migration:run` (AddUserPlacesAndNotes) trên Neon dev?" Chỉ chạy khi được đồng ý.

Run: `cd apps/backend && pnpm migration:run`
Expected: `Migration AddUserPlacesAndNotes1792500000000 has been executed successfully.`

- [ ] **Step 5: Chạy test**

Run: `cd apps/backend && pnpm build:deps && npx vitest run --config vitest.config.e2e.ts test/user-places.e2e-spec.ts`
Expected: PASS (1 test). `npx tsc --noEmit -p tsconfig.json` sạch; mobile `npx tsc --noEmit` sẽ báo các chỗ dựng `SavedPlace`/`PlaceDetail` thiếu trường — sửa tối thiểu (`notes: null`, `createdByMe: false` ở object lạc quan trong `lib/saved-places.tsx`) để typecheck sạch.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/database/migrations/1792500000000-AddUserPlacesAndNotes.ts apps/backend/src/modules/places/entities packages/shared-types apps/backend/test/user-places.e2e-spec.ts apps/mobile/src/lib/saved-places.tsx
git commit -m "feat(backend): user-pinned places and place_notes schema"
```

---

### Task 2: Ghi chú riêng (`place_notes`) ở backend

**Files:**
- Create: `apps/backend/src/modules/places/place-notes.service.ts`, `apps/backend/src/modules/places/place-notes.ts` (hàm thuần), `apps/backend/src/modules/places/place-notes.spec.ts`, `apps/backend/src/modules/places/dto/update-place-notes.dto.ts`
- Modify: `apps/backend/src/modules/places/places.controller.ts` (`PATCH /places/:id/notes`, `GET /places/:id` nhận user), `places.service.ts` (`getDetail(id, viewerId)` thêm `notes`, `createdByMe`, nhánh `user`), `places.module.ts` (provider + export `PlaceNotesService`), `apps/backend/src/modules/saved-places/saved-places.service.ts` (`list` join `place_notes`)
- Test: `apps/backend/test/user-places.e2e-spec.ts`

**Interfaces:**
- Produces:
  ```ts
  // place-notes.ts
  export type NotesPatch = Partial<PlaceNotes>;
  export function mergeNotes(current: PlaceNotes | null, patch: NotesPatch): PlaceNotes | null; // null khi mọi trường null
  export function validateNotes(notes: PlaceNotes): void; // ném BadRequest INVALID_OPENING_HOURS | INVALID_PRICE
  // place-notes.service.ts
  class PlaceNotesService {
    forUser(userId: string, placeIds: string[]): Promise<Map<string, PlaceNotes>>;
    update(userId: string, placeId: string, patch: NotesPatch): Promise<PlaceNotes | null>;
  }
  ```

- [ ] **Step 1: Test hàm thuần (đỏ)** — `place-notes.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mergeNotes, validateNotes } from './place-notes.js';

const empty = { note: null, openingHours: null, priceMin: null, priceMax: null };

describe('mergeNotes', () => {
  it('trường không gửi thì giữ, gửi null thì xóa', () => {
    const current = { ...empty, note: 'Ngon', priceMin: 50_000 };
    expect(mergeNotes(current, { priceMin: null, openingHours: '07:00-22:00' })).toEqual({
      note: 'Ngon', openingHours: '07:00-22:00', priceMin: null, priceMax: null,
    });
  });
  it('mọi trường rỗng thì trả null (xóa dòng)', () => {
    expect(mergeNotes({ ...empty, note: 'x' }, { note: '  ' })).toBeNull();
  });
});

describe('validateNotes', () => {
  it('giờ không đọc được → INVALID_OPENING_HOURS', () => {
    expect(() => validateNotes({ ...empty, openingHours: 'mở cả ngày' })).toThrow(/INVALID_OPENING_HOURS|Giờ mở cửa/);
  });
  it('giá đến nhỏ hơn giá từ → INVALID_PRICE', () => {
    expect(() => validateNotes({ ...empty, priceMin: 200, priceMax: 100 })).toThrow(/INVALID_PRICE|Giá/);
  });
  it('hợp lệ thì không ném', () => {
    expect(() => validateNotes({ note: 'a', openingHours: 'Mo-Su 07:00-22:00', priceMin: 0, priceMax: 0 })).not.toThrow();
  });
});
```

Run: `npx vitest run src/modules/places/place-notes.spec.ts` → FAIL (module chưa có).

- [ ] **Step 2: Cài đặt `place-notes.ts`**

```ts
import { BadRequestException } from '@nestjs/common';
import type { PlaceNotes } from '@rong/shared-types';

import { parseOpeningHours } from './opening-hours.js';

export type NotesPatch = Partial<PlaceNotes>;

const EMPTY: PlaceNotes = { note: null, openingHours: null, priceMin: null, priceMax: null };

/** Trường không có trong `patch` thì giữ; có (kể cả null) thì thay. Chuỗi trắng = null. Mọi trường null → null. */
export function mergeNotes(current: PlaceNotes | null, patch: NotesPatch): PlaceNotes | null {
  const base = current ?? EMPTY;
  const text = (v: string | null | undefined, keep: string | null) =>
    v === undefined ? keep : v?.trim() ? v.trim() : null;
  const merged: PlaceNotes = {
    note: text(patch.note, base.note),
    openingHours: text(patch.openingHours, base.openingHours),
    priceMin: patch.priceMin === undefined ? base.priceMin : patch.priceMin,
    priceMax: patch.priceMax === undefined ? base.priceMax : patch.priceMax,
  };
  return Object.values(merged).every((v) => v === null) ? null : merged;
}

export function validateNotes(notes: PlaceNotes): void {
  if (notes.openingHours && !parseOpeningHours(notes.openingHours)) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'INVALID_OPENING_HOURS',
      message: 'Giờ mở cửa chưa đúng định dạng.',
    });
  }
  if (notes.priceMin !== null && notes.priceMax !== null && notes.priceMax < notes.priceMin) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'INVALID_PRICE',
      message: 'Giá "đến" phải lớn hơn hoặc bằng giá "từ".',
    });
  }
}
```

Run lại → PASS (5 test).

- [ ] **Step 3: DTO**

```ts
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';

/** Trường không gửi thì giữ, gửi `null` thì xóa (spec §2). */
export class UpdatePlaceNotesDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000)
  note?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200)
  openingHours?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(100_000_000)
  priceMin?: number | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(100_000_000)
  priceMax?: number | null;
}
```

- [ ] **Step 4: e2e (đỏ)** — thêm vào `user-places.e2e-spec.ts` (tạo sẵn một dòng `web` `E2E up Quán web` trong `beforeAll`, lưu vào "Muốn đi" bằng `PUT /api/saved-places/:id`):

```ts
it('PATCH /places/:id/notes: sửa từng trường, null thì xóa, rỗng hết thì xóa dòng; GET thấy ghi chú của chính mình', async () => {
  await api().patch(`/api/places/${webPlaceId}/notes`).send({ note: 'Bún ngon', priceMin: 30000, priceMax: 50000 }).expect(200)
    .expect((r) => expect(r.body).toEqual({ note: 'Bún ngon', openingHours: null, priceMin: 30000, priceMax: 50000 }));
  await api().patch(`/api/places/${webPlaceId}/notes`).send({ openingHours: 'Mo-Su 06:00-10:00' }).expect(200);

  const saved = await api().get('/api/saved-places').expect(200);
  expect(saved.body.find((s: { placeId: string }) => s.placeId === webPlaceId).notes).toMatchObject({
    note: 'Bún ngon', openingHours: 'Mo-Su 06:00-10:00',
  });
  const detail = await api().get(`/api/places/${webPlaceId}`).expect(200);
  expect(detail.body.notes.note).toBe('Bún ngon');
  // Người khác không thấy ghi chú của mình.
  const other = await api(otherToken).get(`/api/places/${webPlaceId}`).expect(200);
  expect(other.body.notes).toBeNull();

  await api().patch(`/api/places/${webPlaceId}/notes`).send({ note: null, openingHours: null, priceMin: null, priceMax: null })
    .expect(200).expect((r) => expect(r.body).toBeNull());
  const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM place_notes WHERE place_id = $1`, [webPlaceId]);
  expect(n).toBe(0);
});

it('PATCH notes: giờ sai 400 INVALID_OPENING_HOURS, giá ngược 400 INVALID_PRICE, địa điểm không có 404', async () => {
  await api().patch(`/api/places/${webPlaceId}/notes`).send({ openingHours: 'cả ngày' }).expect(400)
    .expect((r) => expect(r.body.code).toBe('INVALID_OPENING_HOURS'));
  await api().patch(`/api/places/${webPlaceId}/notes`).send({ priceMin: 9, priceMax: 1 }).expect(400)
    .expect((r) => expect(r.body.code).toBe('INVALID_PRICE'));
  await api().patch('/api/places/00000000-0000-4000-8000-000000000000/notes').send({ note: 'x' }).expect(404);
});
```
(`api(token)` trả `request(app.getHttpServer())` có sẵn header `Authorization`; viết helper giống `saved-places.e2e-spec.ts`.)

Run: `npx vitest run --config vitest.config.e2e.ts test/user-places.e2e-spec.ts` → FAIL (404 route).

- [ ] **Step 5: Cài đặt `PlaceNotesService`**

```ts
@Injectable()
export class PlaceNotesService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async forUser(userId: string, placeIds: string[]): Promise<Map<string, PlaceNotes>> {
    if (placeIds.length === 0) return new Map();
    const rows = (await this.db.query(
      `SELECT place_id, note, opening_hours, price_min, price_max
         FROM place_notes WHERE user_id = $1 AND place_id = ANY($2::uuid[])`,
      [userId, placeIds],
    )) as NotesRow[];
    return new Map(rows.map((r) => [r.place_id, toNotes(r)]));
  }

  async update(userId: string, placeId: string, patch: NotesPatch): Promise<PlaceNotes | null> {
    const [exists] = (await this.db.query(`SELECT 1 FROM places WHERE id = $1`, [placeId])) as unknown[];
    if (!exists) throw placeNotFound();
    const current = (await this.forUser(userId, [placeId])).get(placeId) ?? null;
    const next = mergeNotes(current, patch);
    if (next === null) {
      await this.db.query(`DELETE FROM place_notes WHERE user_id = $1 AND place_id = $2`, [userId, placeId]);
      return null;
    }
    validateNotes(next);
    await this.db.query(
      `INSERT INTO place_notes (user_id, place_id, note, opening_hours, price_min, price_max)
       VALUES ($1, $2, $3, $4, $5::int, $6::int)
       ON CONFLICT (user_id, place_id) DO UPDATE
         SET note = EXCLUDED.note, opening_hours = EXCLUDED.opening_hours,
             price_min = EXCLUDED.price_min, price_max = EXCLUDED.price_max, updated_at = now()`,
      [userId, placeId, next.note, next.openingHours, next.priceMin, next.priceMax],
    );
    return next;
  }
}
```
`toNotes(row)` đổi cột snake sang `PlaceNotes`; `placeNotFound()` là `NotFoundException({ statusCode: 404, code: 'PLACE_NOT_FOUND', message: 'Không tìm thấy địa điểm này.' })` (cùng thông báo với `getDetail`). Đăng ký provider và `exports` trong `places.module.ts`.

Controller (`PlaceDetailController`, khai báo **trước** `@Get(':id')`):

```ts
@Patch(':id/notes')
updateNotes(
  @CurrentUser() user: AuthUser,
  @Param('id', new ParseUUIDPipe()) id: string,
  @Body() dto: UpdatePlaceNotesDto,
): Promise<PlaceNotes | null> {
  return this.notes.update(user.userId, id, dto);
}
```
Sửa `detail` thành `detail(@CurrentUser() user, @Param(...) id)` → `this.places.getDetail(id, user.userId)`.

`PlacesService.getDetail(id, viewerId)`: thêm `p.created_by` vào SELECT; `DetailRow.source` thêm `'user'`; `ATTRIBUTIONS.user = 'Vị trí do bạn ghim'`; trả thêm `notes: (await this.notes.forUser(viewerId, [id])).get(id) ?? null` và `createdByMe: row.created_by === viewerId`. Với `source = 'user'`: `sourceUrl = https://www.google.com/maps/search/?api=1&query=<lat>,<lng>` (chỉ đường bằng tọa độ ghim).

`SavedPlacesService.list`: thêm `LEFT JOIN place_notes n ON n.user_id = s.user_id AND n.place_id = s.place_id`, chọn `n.note, n.opening_hours, n.price_min, n.price_max`, map `notes` (mọi cột null → `null`).

- [ ] **Step 6: Chạy test**

Run: `pnpm build:deps && npx vitest run src/modules/places && npx vitest run --config vitest.config.e2e.ts test/user-places.e2e-spec.ts test/saved-places.e2e-spec.ts test/web-places.e2e-spec.ts`
Expected: tất cả PASS (trừ test "vùng là xã" của `web-places` nếu dữ liệu dev vẫn còn 20 địa điểm Phước Hải — lỗi có sẵn, không do task này; ghi vào báo cáo).

- [ ] **Step 7: Commit** — `feat(backend): personal place notes (PATCH /places/:id/notes, notes in saved places and place detail)`

---

### Task 3: Tạo và sửa điểm tự ghim

**Files:**
- Create: `apps/backend/src/modules/places/user-places.service.ts`, `apps/backend/src/modules/places/user-places.ts` (hàm thuần), `apps/backend/src/modules/places/user-places.spec.ts`, `apps/backend/src/modules/places/dto/create-user-place.dto.ts`, `apps/backend/src/modules/places/dto/update-user-place.dto.ts`, `apps/backend/src/modules/places/user-places.controller.ts`
- Modify: `places.module.ts` (đăng ký `UserPlacesController` **trước** `PlaceDetailController` trong `controllers`)
- Test: `apps/backend/test/user-places.e2e-spec.ts`

**Interfaces:**
- Consumes: `PlaceNotesService.update` (Task 2), `SavedPlacesService.save(userId, placeId, regionId, origin, runner)`, `RegionAreaService.ensure(regionId): Promise<Bbox>` (`[nam, tây, bắc, đông]`).
- Produces:
  ```ts
  export const PIN_PADDING_DEG = 0.02;
  export const PIN_DAILY_LIMIT = 30;
  export const PIN_TOTAL_LIMIT = 500;
  export function insideRegion(point: { lat: number; lng: number }, bbox: Bbox, pad?: number): boolean;
  class UserPlacesService {
    create(userId: string, dto: CreateUserPlaceDto): Promise<CreateUserPlaceResponse>;
    update(userId: string, id: string, dto: UpdateUserPlaceDto): Promise<void>;
  }
  ```

- [ ] **Step 1: Test hàm thuần (đỏ)** — `user-places.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { insideRegion } from './user-places.js';

const daLat: [number, number, number, number] = [11.85, 108.35, 12.05, 108.55];

describe('insideRegion', () => {
  it('trong khung', () => expect(insideRegion({ lat: 11.94, lng: 108.44 }, daLat)).toBe(true));
  it('lệch ra ngoài ~1 km vẫn nhận (nới 0.02 độ)', () => expect(insideRegion({ lat: 12.06, lng: 108.44 }, daLat)).toBe(true));
  it('xa hơn thì không', () => expect(insideRegion({ lat: 12.1, lng: 108.44 }, daLat)).toBe(false));
});
```

- [ ] **Step 2: Cài đặt `user-places.ts`**

```ts
import type { Bbox } from '../regions/bbox.js';

/** Nới khung bao vùng ~2 km, cùng mức với tọa độ AI (`web-places.service.ts`). */
export const PIN_PADDING_DEG = 0.02;
export const PIN_DAILY_LIMIT = 30;
export const PIN_TOTAL_LIMIT = 500;

export function insideRegion({ lat, lng }: { lat: number; lng: number }, bbox: Bbox, pad = PIN_PADDING_DEG): boolean {
  const [south, west, north, east] = bbox;
  return lat >= south - pad && lat <= north + pad && lng >= west - pad && lng <= east + pad;
}
```
Run spec → PASS.

- [ ] **Step 3: DTO**

```ts
export class CreateUserPlaceDto {
  @IsString() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @Length(1, 120)
  name!: string;
  @IsIn(PLACE_CATEGORIES) category!: PlaceCategory;
  @IsLatitude() lat!: number;
  @IsLongitude() lng!: number;
  @IsUUID() regionId!: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string | null;
  @IsOptional() @ValidateNested() @Type(() => UpdatePlaceNotesDto) notes?: UpdatePlaceNotesDto;
  @IsOptional() @IsUUID() shareImportId?: string;
}
export class UpdateUserPlaceDto {
  @IsOptional() @IsString() @Transform(trim) @Length(1, 120) name?: string;
  @IsOptional() @IsIn(PLACE_CATEGORIES) category?: PlaceCategory;
  @IsOptional() @IsLatitude() lat?: number;
  @IsOptional() @IsLongitude() lng?: number;
  @IsOptional() @IsString() @MaxLength(300) address?: string | null;
}
```
(`PLACE_CATEGORIES` lấy từ `@rong/shared-types`, đã dùng ở `web-places.service.ts`. `lat`/`lng` của `UpdateUserPlaceDto` phải đi cùng nhau: service kiểm tra, thiếu một → 400 `INVALID_LOCATION`.)

- [ ] **Step 4: e2e (đỏ)** — thêm vào `user-places.e2e-spec.ts` (dùng vùng seed `vn:destination:da-lat`; một lượt chia sẻ `done` của user tạo bằng SQL `INSERT INTO share_imports (user_id, status, platform) VALUES ($1, 'done', 'web') RETURNING id`):

```ts
it('POST /places/user: tạo điểm, lưu vào Muốn đi kèm ghi chú; từ share thì tính vào lượt chia sẻ', async () => {
  const res = await api().post('/api/places/user').send({
    name: '  E2E up Quán chè bà Tư ', category: 'food', lat: 11.94, lng: 108.44, regionId: daLat,
    address: '12 Trần Hưng Đạo', notes: { priceMin: 20000, priceMax: 40000 }, shareImportId,
  }).expect(201);
  pinnedId = res.body.placeId;
  const saved = (await api().get('/api/saved-places').expect(200)).body.find((s: { placeId: string }) => s.placeId === pinnedId);
  expect(saved).toMatchObject({ name: 'E2E up Quán chè bà Tư', source: 'share', locationSource: 'user', notes: { priceMin: 20000 } });
  const job = await api().get(`/api/share-imports/${shareImportId}`).expect(200);
  expect(job.body.savedCount).toBe(1);
  const detail = await api().get(`/api/places/${pinnedId}`).expect(200);
  expect(detail.body).toMatchObject({ locationSource: 'user', createdByMe: true, address: '12 Trần Hưng Đạo' });
});

it('POST /places/user: ngoài vùng 400 PIN_OUTSIDE_REGION; lượt chia sẻ của người khác 404', async () => {
  await api().post('/api/places/user').send({ name: 'E2E up Xa', category: 'food', lat: 10.77, lng: 106.7, regionId: daLat })
    .expect(400).expect((r) => expect(r.body.code).toBe('PIN_OUTSIDE_REGION'));
  await api(otherToken).post('/api/places/user').send({ name: 'E2E up Lấn', category: 'food', lat: 11.94, lng: 108.44, regionId: daLat, shareImportId })
    .expect(404);
});

it('POST /places/user: quá 30 điểm trong 24 giờ → 429 PIN_LIMIT', async () => {
  await db.query(
    `INSERT INTO places (source, name, category, location, location_source, created_by)
     SELECT 'user', 'E2E up Hàng loạt ' || g, 'food', ST_SetSRID(ST_MakePoint(108.44, 11.94), 4326), 'user', $1
       FROM generate_series(1, 30) g`,
    [otherId],
  );
  await api(otherToken).post('/api/places/user').send({ name: 'E2E up Thứ 31', category: 'food', lat: 11.94, lng: 108.44, regionId: daLat })
    .expect(429).expect((r) => expect(r.body.code).toBe('PIN_LIMIT'));
});

it('PATCH /places/user/:id: người tạo sửa được; người khác 404; vị trí mới ngoài vùng 400', async () => {
  await api().patch(`/api/places/user/${pinnedId}`).send({ name: 'E2E up Chè bà Tư', lat: 11.95, lng: 108.45 }).expect(204);
  await api(otherToken).patch(`/api/places/user/${pinnedId}`).send({ name: 'E2E up Đổi trộm' }).expect(404);
  await api().patch(`/api/places/user/${pinnedId}`).send({ lat: 10.77, lng: 106.7 }).expect(400);
  const detail = await api().get(`/api/places/${pinnedId}`).expect(200);
  expect(detail.body.name).toBe('E2E up Chè bà Tư');
});

it('cách ly: điểm tự ghim không có trong danh sách vùng, tìm theo tên, khớp danh mục', async () => {
  const list = await api(otherToken).get(`/api/regions/${daLat}/places`);
  expect(JSON.stringify(list.body)).not.toContain('Chè bà Tư');
  const search = await api(otherToken).get(`/api/regions/${daLat}/places/search?q=${encodeURIComponent('Chè bà Tư')}`).expect(200);
  expect(JSON.stringify(search.body)).not.toContain(pinnedId);
  const matches = await matchCatalog(db, ['E2E up Chè bà Tư'], null, 0.3);
  expect(matches.map((m) => m.id)).not.toContain(pinnedId);
});
```
(`GET /regions/:id/places` có thể trả 503/202 khi chưa có danh sách — test chỉ khẳng định không chứa tên. `matchCatalog` import từ `../src/modules/places/catalog-match.js`.)

Run → FAIL (route chưa có).

- [ ] **Step 5: Cài đặt `UserPlacesService` và controller**

```ts
@Injectable()
export class UserPlacesService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly areas: RegionAreaService,
    private readonly saved: SavedPlacesService,
    private readonly notes: PlaceNotesService,
  ) {}

  async create(userId: string, dto: CreateUserPlaceDto): Promise<CreateUserPlaceResponse> {
    await this.requireInside(dto.regionId, dto);
    if (dto.shareImportId) await this.requireOwnShare(userId, dto.shareImportId);
    const [{ day, total }] = (await this.db.query(
      `SELECT count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS day, count(*)::int AS total
         FROM places WHERE source = 'user' AND created_by = $1`,
      [userId],
    )) as Array<{ day: number; total: number }>;
    if (day >= PIN_DAILY_LIMIT || total >= PIN_TOTAL_LIMIT) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'PIN_LIMIT',
          message: day >= PIN_DAILY_LIMIT
            ? `Mỗi ngày ghim tối đa ${PIN_DAILY_LIMIT} địa điểm. Thử lại sau nhé.`
            : `Bạn đã ghim tối đa ${PIN_TOTAL_LIMIT} địa điểm.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const placeId = await this.db.transaction(async (m) => {
      const [row] = (await m.query(
        `INSERT INTO places (source, name, category, location, location_source, created_by, address)
         VALUES ('user', $1, $2, ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326), 'user', $5, $6)
         RETURNING id`,
        [dto.name, dto.category, dto.lat, dto.lng, userId, dto.address?.trim() || null],
      )) as Array<{ id: string }>;
      await this.saved.save(
        userId, row.id, dto.regionId,
        { source: dto.shareImportId ? 'share' : 'manual', shareImportId: dto.shareImportId ?? null },
        m,
      );
      return row.id;
    });
    if (dto.notes) await this.notes.update(userId, placeId, dto.notes);
    return { placeId };
  }
  // update(): SELECT created_by + region_id (từ saved_places của người tạo) → khác người tạo hoặc không có → 404
  // PLACE_NOT_FOUND; có lat/lng thì requireInside(region_id); UPDATE places SET name/category/location/address theo
  // trường được gửi.
}
```
- `requireInside(regionId, point)`: `bbox = await this.areas.ensure(regionId)` (vùng không có → `ensure` ném 404 `REGION_NOT_FOUND` sẵn có; kiểm tra lại bằng e2e); `!insideRegion(point, bbox)` → 400 `PIN_OUTSIDE_REGION`, message "Vị trí ghim nằm ngoài <vùng>.".
- `requireOwnShare`: `SELECT 1 FROM share_imports WHERE id = $1 AND user_id = $2` không có → 404 `SHARE_IMPORT_NOT_FOUND` ("Không tìm thấy lượt chia sẻ này.").
- Ghi chú lỗi validate trong `notes` được kiểm tra **trước** transaction: gọi `validateNotes(mergeNotes(null, dto.notes) ?? EMPTY)` ở đầu `create` để không tạo điểm rồi mới báo lỗi ghi chú.

Controller:
```ts
@Controller('places')
export class UserPlacesController {
  constructor(private readonly userPlaces: UserPlacesService, private readonly reverse: ReverseGeocodeService) {}

  @Post('user')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserPlaceDto) {
    return this.userPlaces.create(user.userId, dto);
  }

  @Patch('user/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  update(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateUserPlaceDto) {
    return this.userPlaces.update(user.userId, id, dto);
  }
}
```
(`reverse` được thêm ở Task 4; ở task này controller chỉ có hai route.)

- [ ] **Step 6: Chạy test** — `npx vitest run src/modules/places && npx vitest run --config vitest.config.e2e.ts test/user-places.e2e-spec.ts` → PASS.

- [ ] **Step 7: Commit** — `feat(backend): create and edit user-pinned places (POST /places/user, PATCH /places/user/:id)`

---

### Task 4: Reverse geocode

**Files:**
- Modify: `apps/backend/src/modules/open-data/open-data.service.ts` (`reverse`), `open-data.types.ts` (`NominatimReverse`)
- Create: `apps/backend/src/modules/places/reverse-geocode.ts` (hàm thuần `formatAddress`, `cacheKey`), `reverse-geocode.spec.ts`, `reverse-geocode.service.ts`
- Modify: `user-places.controller.ts` (`GET /places/reverse-geocode`), `places.module.ts`
- Test: `apps/backend/test/user-places.e2e-spec.ts`

**Interfaces:**
- Produces:
  ```ts
  OpenDataService.reverse(lat: number, lng: number): Promise<NominatimReverse | null>; // timeout 3000 ms
  export function formatAddress(address: Record<string, string> | undefined): string | null;
  class ReverseGeocodeService { lookup(userId: string, lat: number, lng: number): Promise<ReverseGeocodeResponse> }
  ```

- [ ] **Step 1: Test `formatAddress` (đỏ)**

```ts
describe('formatAddress', () => {
  it('số nhà + đường, phường, quận, tỉnh; bỏ trùng và quốc gia', () => {
    expect(formatAddress({
      house_number: '12', road: 'Đường Trần Hưng Đạo', quarter: 'Phường 10', suburb: 'Phường 10',
      city: 'Đà Lạt', state: 'Lâm Đồng', country: 'Việt Nam', postcode: '66000',
    })).toBe('12 Đường Trần Hưng Đạo, Phường 10, Đà Lạt, Lâm Đồng');
  });
  it('chỉ có xã và tỉnh', () => {
    expect(formatAddress({ village: 'Xã Tà Xùa', state: 'Sơn La', country: 'Việt Nam' })).toBe('Xã Tà Xùa, Sơn La');
  });
  it('không có gì dùng được → null', () => {
    expect(formatAddress({ country: 'Việt Nam' })).toBeNull();
    expect(formatAddress(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Cài đặt**

```ts
/** Thứ tự các phần của một dòng địa chỉ Việt Nam từ `address` của Nominatim. */
const PARTS: Array<string[]> = [
  ['road', 'pedestrian', 'footway', 'path'],
  ['quarter', 'suburb', 'neighbourhood', 'village', 'hamlet'],
  ['city_district', 'district', 'county', 'town'],
  ['city', 'municipality'],
  ['state', 'province'],
];

export function formatAddress(address: Record<string, string> | undefined): string | null {
  if (!address) return null;
  const out: string[] = [];
  for (const keys of PARTS) {
    const value = keys.map((k) => address[k]?.trim()).find(Boolean);
    if (value && !out.includes(value)) out.push(value);
  }
  if (out.length === 0) return null;
  if (address.house_number && address.road && out[0] === address.road.trim()) {
    out[0] = `${address.house_number.trim()} ${out[0]}`;
  }
  return out.join(', ');
}

/** Ô ~10 m: làm tròn 4 chữ số thập phân. */
export const cacheKey = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`;
```
`OpenDataService.reverse`:
```ts
/** Địa chỉ của một tọa độ (màn ghim vị trí). Cùng hàng đợi 1 request/giây với `searchPlaces`. */
reverse(lat: number, lng: number): Promise<NominatimReverse | null> {
  const url = new URL('/reverse', this.config.nominatimUrl);
  url.search = new URLSearchParams({
    lat: String(lat), lon: String(lng), format: 'jsonv2', zoom: '18', addressdetails: '1', 'accept-language': 'vi',
  }).toString();
  return this.http.getJson<NominatimReverse>(url.toString(), {}, 3000).catch(() => null);
}
```
`ReverseGeocodeService.lookup`: cache `Map<string, { address: string | null; at: number }>` 24 giờ (giữ tối đa 5 000 mục, quá thì xóa mục cũ nhất); nếu cache trúng → trả ngay (không tính lượt); `PlaceSearchLimiter(60, 60 * 60 * 1000)` theo user (dùng lại lớp có sẵn ở `places/place-search-limiter.ts`) → hết lượt trả `{ address: null }`; gọi `open.reverse` → `formatAddress(result?.address)`; chỉ cache khi Nominatim trả được kết quả (lỗi thì không cache).

Route (trong `UserPlacesController`, khai báo trước các route khác của controller này):
```ts
@Get('reverse-geocode')
reverseGeocode(@CurrentUser() user: AuthUser, @Query() q: ReverseGeocodeQueryDto): Promise<ReverseGeocodeResponse> {
  return this.reverse.lookup(user.userId, q.lat, q.lng);
}
```
`ReverseGeocodeQueryDto`: `@Type(() => Number) @IsLatitude() lat`, `@Type(() => Number) @IsLongitude() lng`.

- [ ] **Step 3: e2e** — override `OpenDataService` trong `beforeAll` của `user-places.e2e-spec.ts` bằng `{ searchPlaces: vi.fn(async () => []), reverse: vi.fn() }`:

```ts
it('GET /places/reverse-geocode: trả một dòng địa chỉ; Nominatim lỗi thì null', async () => {
  openData.reverse.mockResolvedValueOnce({ address: { road: 'Đường Hồ Tùng Mậu', city: 'Đà Lạt', state: 'Lâm Đồng' } });
  await api().get('/api/places/reverse-geocode?lat=11.9401&lng=108.4402').expect(200)
    .expect((r) => expect(r.body).toEqual({ address: 'Đường Hồ Tùng Mậu, Đà Lạt, Lâm Đồng' }));
  // Cùng ô 10 m: lấy từ cache, không gọi lại.
  await api().get('/api/places/reverse-geocode?lat=11.94012&lng=108.44018').expect(200);
  expect(openData.reverse).toHaveBeenCalledTimes(1);
  openData.reverse.mockResolvedValueOnce(null);
  await api().get('/api/places/reverse-geocode?lat=11.95&lng=108.45').expect(200)
    .expect((r) => expect(r.body).toEqual({ address: null }));
});
```
Run: unit + e2e → PASS.

- [ ] **Step 4: Commit** — `feat(backend): reverse geocode for the pin screen via Nominatim (GET /places/reverse-geocode)`

---

### Task 5: Gợi ý vùng cho ứng viên share

**Files:**
- Modify: `apps/backend/src/modules/share-import/place-resolver.ts` (`StoredCandidate.regionHintId`), `share-imports.service.ts` (`present` trả `regionHint`)
- Test: `apps/backend/src/modules/share-import/place-resolver.spec.ts`, `apps/backend/test/share-imports.e2e-spec.ts`

**Interfaces:**
- Produces: `StoredCandidate.regionHintId: string | null` (ứng viên cũ không có trường → coi là null); `ShareImportCandidate.regionHint`.

- [ ] **Step 1: Test resolver (đỏ)** — trong `place-resolver.spec.ts` thêm: ứng viên có `regionHint: 'Đà Lạt'`, `findRegion` trả `{ id: 'r-dalat', name: 'Đà Lạt', bbox }`, `matchCatalog` và Google trả rỗng → `candidates[0]` có `confidence: 'none'`, `options: []`, `regionHintId: 'r-dalat'`; ứng viên không có gợi ý → `regionHintId: null`.
- [ ] **Step 2: Cài đặt** — trong `resolvePlaces`, `base` thêm `regionHintId: region?.id ?? null`; kiểu `StoredCandidate` thêm `regionHintId?: string | null`. Trong `present`, gom thêm `c.regionHintId` vào danh sách id truyền cho `this.regions.names(...)`, trả `regionHint: c.regionHintId ? { id: c.regionHintId, name: regionNames.get(c.regionHintId) ?? '' } : null`.
- [ ] **Step 3: e2e** — trong test "caption + link TikTok" của `share-imports.e2e-spec.ts`, khẳng định ứng viên có gợi ý vùng trả `regionHint: { id: <Đà Lạt>, name: expect.stringContaining('Đà Lạt') }`.
- [ ] **Step 4: Chạy** `npx vitest run src/modules/share-import && npx vitest run --config vitest.config.e2e.ts test/share-imports.e2e-spec.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(backend): expose each share candidate's region hint`

---

### Task 6: Lịch trình đọc ghi chú của người tạo

**Files:**
- Modify: `apps/backend/src/modules/itineraries/itinerary-place-data.ts` (tham số `notesOwnerId`), `itineraries.service.ts` (`respond`, `update`, `retimePlan`), `share-links.service.ts` (`getPublic` lấy `owner_id`), `itinerary-planner.ts` (`loadPlaces`, `poolInArea`, `PlanTripOptions.notesOwnerId`), `apps/backend/src/modules/recommendations/recommendations.service.ts` (truyền người lưu cho `retimePlan`)
- Test: `apps/backend/test/user-places.e2e-spec.ts` (hoặc `test/itineraries.e2e-spec.ts` nếu dựng nhóm dễ hơn ở đó)

**Interfaces:**
- Produces:
  ```ts
  withItineraryPlaceData(db, days, notesOwnerId?: string | null): Promise<ItineraryDay[]>; // điền item.place.notes
  ItineraryPlanner.loadPlaces(ids, mandatory, notesOwnerId?: string | null): Promise<Candidate[]>;
  type PlanTripOptions = { ...; notesOwnerId?: string | null };
  ItinerariesService.retimePlan(input, days, warnings, notesOwnerId?: string | null);
  ```

- [ ] **Step 1: e2e (đỏ)**

```ts
it('lịch trình: thành viên nhóm và link công khai thấy ghi chú của người tạo; giờ ghi chú sinh cảnh báo đóng cửa', async () => {
  // Người tạo ghi chú: quán chỉ mở 06:00–09:00.
  await api().patch(`/api/places/${webPlaceId}/notes`).send({ note: 'Đi sớm', openingHours: 'Mo-Su 06:00-09:00' }).expect(200);
  // Thành viên (otherToken) có ghi chú riêng khác — không được hiện trong lịch trình của người tạo.
  await api(otherToken).patch(`/api/places/${webPlaceId}/notes`).send({ note: 'Của thành viên' }).expect(200);
  const created = await api().post('/api/itineraries').send({
    regionId: daLat, planningMode: 'manual', startsAt: '2026-11-01T01:00:00.000Z', endsAt: '2026-11-01T14:00:00.000Z',
    travelParty: 'couple', adults: 2, children: 0, selectedPlaceIds: [webPlaceId], groupId,
  }).expect(201);
  const it = created.body;
  // Xếp tay vào 14:00 (ngoài giờ mở): PUT tính lại giờ và cảnh báo.
  const day = it.days[0];
  await api().put(`/api/itineraries/${it.id}`).send({
    days: [{ id: day.id, items: [{ placeId: webPlaceId, kind: 'visit', fixedStart: true, startsAt: '2026-11-01T07:00:00.000Z', durationMinutes: 60 }] }],
    unscheduledPlaceIds: [],
  }).expect(200).expect((r) => expect(r.body.warnings.map((w: { type: string }) => w.type)).toContain('place_closed'));

  const asMember = await api(otherToken).get(`/api/itineraries/${it.id}`).expect(200);
  const stop = asMember.body.days[0].items.find((i: { placeId: string }) => i.placeId === webPlaceId);
  expect(stop.place.notes).toMatchObject({ note: 'Đi sớm', openingHours: 'Mo-Su 06:00-09:00' });

  const link = await api().put(`/api/itineraries/${it.id}/share-link`).expect(200);
  const pub = await request(app.getHttpServer()).get(`/api/public/itineraries/${link.body.token}`).expect(200);
  expect(pub.body.days[0].items.find((i: { placeId: string }) => i.placeId === webPlaceId).place.notes.note).toBe('Đi sớm');

  // Người tạo sửa ghi chú → lần đọc sau thấy ngay (không chép).
  await api().patch(`/api/places/${webPlaceId}/notes`).send({ note: 'Đi trước 8h' }).expect(200);
  const again = await api(otherToken).get(`/api/itineraries/${it.id}`).expect(200);
  expect(again.body.days[0].items.find((i: { placeId: string }) => i.placeId === webPlaceId).place.notes.note).toBe('Đi trước 8h');
});
```
Dựng `groupId` trong `beforeAll`: `POST /api/groups` bằng người tạo, rồi thêm thành viên bằng SQL `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'editor')` (theo `test/groups.e2e-spec.ts`). **Trước khi viết test, đọc `UpdateItineraryDto` và một test `PUT` có sẵn trong `test/itineraries.e2e-spec.ts`; dùng đúng hình dạng body ở đó thay cho body minh họa ở trên** (ledger một Ruling nếu khác). Đường dẫn share link và token lấy theo `share-links.e2e-spec.ts`.

Run → FAIL (`notes` chưa có, chưa có cảnh báo).

- [ ] **Step 2: Giờ của người tạo khi nạp địa điểm** — trong `itinerary-planner.ts`, thay hằng `PLACE_SELECT` bằng hàm:

```ts
/** `$ownerParam`: người tạo lịch trình; giờ trong ghi chú của họ ưu tiên hơn giờ của địa điểm (spec §4). */
function placeSelect(ownerParam: string): string {
  return `
  SELECT p.id, p.name, p.category, p.source, p.location_source, ST_Y(p.location) AS lat, ST_X(p.location) AS lng,
         p.address, p.description, COALESCE(n.opening_hours, p.tags->>'opening_hours') AS opening_hours
    FROM places p
    LEFT JOIN place_notes n ON n.place_id = p.id AND n.user_id = ${ownerParam}::uuid`;
}
```
- `loadPlaces(ids, mandatory, notesOwnerId = null)`: `${placeSelect('$2')} WHERE p.id = ANY($1::uuid[])`, params `[ids, notesOwnerId]`.
- `poolInArea(..., notesOwnerId)`: dùng `placeSelect('$5')`, thêm `notesOwnerId` làm tham số thứ 5.
- `planTrip(input, options)`: truyền `options.notesOwnerId ?? null` cho mọi lời gọi `loadPlaces`/`poolInArea`.
- `ItinerariesService.create`: `this.planner.planTrip(input, { notesOwnerId: ownerId })`.
- `update`: `loadPlaces(placeIds, true, itinerary.ownerId)` và lời gọi nạp chỗ ở.
- `retimePlan(input, days, warnings, notesOwnerId = null)`: truyền vào `loadPlaces`; `recommendations.service.ts:256` truyền id người đang lưu gợi ý.
- `toCandidate` không đổi (`openingHours: row.opening_hours`). `poolInArea` vẫn chỉ đọc `region_places` nên điểm `user` không lọt vào.

- [ ] **Step 3: Đọc ghi chú khi trả lịch trình** — `itinerary-place-data.ts`:

```ts
export async function withItineraryPlaceData(
  db: DataSource,
  days: ItineraryDay[],
  notesOwnerId: string | null = null,
): Promise<ItineraryDay[]> {
  // ... giữ phần đọc `places` hiện có; thêm (khi có notesOwnerId):
  const notes = notesOwnerId
    ? new Map(
        ((await db.query(
          `SELECT place_id, note, opening_hours, price_min, price_max
             FROM place_notes WHERE user_id = $1 AND place_id = ANY($2::uuid[])`,
          [notesOwnerId, ids],
        )) as NotesRow[]).map((r) => [r.place_id, toNotes(r)]),
      )
    : new Map<string, PlaceNotes>();
  // trong map từng item: place: { ...item.place, ..., notes: notes.get(item.placeId) ?? null }
}
```
Dời `NotesRow`/`toNotes` ra `places/place-notes.ts` (export) để dùng chung với `PlaceNotesService`. **Lưu ý:** hàm hiện `return days` sớm khi `rows.length === 0`; giữ, vì không có dòng `places` thì cũng không có ghi chú.
- `ItinerariesService.respond`: `withItineraryPlaceData(this.db, it.days, it.ownerId)`.
- `ShareLinksService.getPublic`: thêm `i.owner_id` vào SELECT, truyền vào; sửa comment đầu hàm thành "Chỉ dữ liệu riêng của app và ghi chú địa điểm của người tạo; không id người dùng, ghi chú chuyến đi, nhóm hay nội dung Google." (ghi chú địa điểm hiện trên link công khai theo spec).
- `recommendations.service.ts:270` giữ không truyền (bản nháp dùng chung, không có người tạo).
- **Không** lưu `notes` vào JSONB: trong `update`, trước khi ghi `itinerary.days`, bỏ `notes` khỏi `item.place` nếu client gửi lên (`toRequest` ở app không gửi `place`, nhưng phòng hờ: `delete (item.place as Partial<ItineraryPlaceSnapshot>).notes`).

- [ ] **Step 4: Chạy** `pnpm build:deps && npx vitest run && npx vitest run --config vitest.config.e2e.ts test/user-places.e2e-spec.ts test/itineraries.e2e-spec.ts test/share-links.e2e-spec.ts test/groups.e2e-spec.ts test/recommendations*.e2e-spec.ts` → PASS (ghi rõ các test e2e cũ đã biết đỏ trước đó, nếu có, kèm tên).

- [ ] **Step 5: Commit** — `feat(backend): itineraries read the creator's place notes and plan with their opening hours`

---

### Task 7: Mobile — giờ mở cửa, giá, form ghi chú

**Files:**
- Create: `apps/mobile/src/lib/place-notes.ts`, `apps/mobile/src/lib/place-notes.test.ts`, `apps/mobile/src/components/place-notes-form.tsx`, `apps/mobile/src/__tests__/place-notes-form.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type WeeklyForm = { open: string; close: string; days: boolean[] }; // days[0] = thứ Hai
  export function buildOpeningHours(form: WeeklyForm): string | null;       // null khi không chọn ngày nào
  export function parseSimpleHours(raw: string): WeeklyForm | null;         // null khi form không biểu diễn được
  export const PRICE_CHIPS: Array<{ label: string; min: number | null; max: number | null }>;
  export function formatPrice(min: number | null, max: number | null): string | null; // "50–150k", "Miễn phí", "< 50k", "> 300k"
  export function notesSummary(notes: PlaceNotes | null): string | null;    // "07:00–22:00 · 50–150k"
  export function PlaceNotesForm(props: {
    initial: PlaceNotes | null;
    header?: ReactNode;           // tên + loại ở màn ghim
    submitLabel: string;          // "Lưu vào Muốn đi" | "Lưu"
    busy?: boolean;
    error?: string | null;
    onSubmit: (patch: Partial<PlaceNotes>) => void; // chỉ gửi trường đã đổi
  }): JSX.Element;
  ```

- [ ] **Step 1: Test lib (đỏ)**

```ts
import { buildOpeningHours, formatPrice, notesSummary, parseSimpleHours } from '@/lib/place-notes';

const all = Array(7).fill(true);

describe('buildOpeningHours', () => {
  it('cả tuần', () => expect(buildOpeningHours({ open: '07:00', close: '22:00', days: all })).toBe('Mo-Su 07:00-22:00'));
  it('gộp ngày liền nhau', () =>
    expect(buildOpeningHours({ open: '08:00', close: '17:00', days: [true, false, true, true, true, false, false] }))
      .toBe('Mo,We-Fr 08:00-17:00'));
  it('qua đêm giữ nguyên giờ đóng nhỏ hơn giờ mở', () =>
    expect(buildOpeningHours({ open: '18:00', close: '02:00', days: all })).toBe('Mo-Su 18:00-02:00'));
  it('không chọn ngày nào → null', () => expect(buildOpeningHours({ open: '07:00', close: '22:00', days: Array(7).fill(false) })).toBeNull());
});

describe('parseSimpleHours', () => {
  it('đọc lại chuỗi do form sinh', () =>
    expect(parseSimpleHours('Mo,We-Fr 08:00-17:00')).toEqual({ open: '08:00', close: '17:00', days: [true, false, true, true, true, false, false] }));
  it('"07:00-22:00" không có ngày = cả tuần', () => expect(parseSimpleHours('07:00-22:00')).toEqual({ open: '07:00', close: '22:00', days: all }));
  it('nhiều khung giờ → null (form không biểu diễn được)', () => expect(parseSimpleHours('Mo-Fr 08:00-12:00,13:30-17:00')).toBeNull());
});

describe('formatPrice / notesSummary', () => {
  it.each([
    [0, 0, 'Miễn phí'], [null, 50000, '< 50k'], [50000, 150000, '50–150k'], [300000, null, '> 300k'], [null, null, null],
  ])('%s–%s → %s', (min, max, out) => expect(formatPrice(min, max)).toBe(out));
  it('tóm tắt giờ và giá', () =>
    expect(notesSummary({ note: 'x', openingHours: 'Mo-Su 07:00-22:00', priceMin: 50000, priceMax: 150000 })).toBe('07:00–22:00 · 50–150k'));
  it('chuỗi giờ phức tạp thì tóm tắt "Có giờ mở cửa"', () =>
    expect(notesSummary({ note: null, openingHours: 'Mo-Fr 08:00-12:00,13:30-17:00', priceMin: null, priceMax: null })).toBe('Có giờ mở cửa'));
});
```

- [ ] **Step 2: Cài đặt `lib/place-notes.ts`**

```ts
import type { PlaceNotes } from '@rong/shared-types';

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export type WeeklyForm = { open: string; close: string; days: boolean[] };

export function buildOpeningHours({ open, close, days }: WeeklyForm): string | null {
  const runs: string[] = [];
  for (let i = 0; i < 7; i++) {
    if (!days[i]) continue;
    let j = i;
    while (j + 1 < 7 && days[j + 1]) j++;
    runs.push(j === i ? DAYS[i] : j === i + 1 ? `${DAYS[i]},${DAYS[j]}` : `${DAYS[i]}-${DAYS[j]}`);
    i = j;
  }
  return runs.length ? `${runs.join(',')} ${open}-${close}` : null;
}

export function parseSimpleHours(raw: string): WeeklyForm | null {
  const m = /^(?:([A-Za-z,\-]+)\s+)?(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(raw.trim());
  if (!m || !HHMM.test(m[2]) || !HHMM.test(m[3])) return null;
  const days = Array(7).fill(m[1] ? false : true);
  for (const part of m[1]?.split(',') ?? []) {
    const [a, b = a] = part.split('-');
    const from = DAYS.indexOf(a as (typeof DAYS)[number]);
    const to = DAYS.indexOf(b as (typeof DAYS)[number]);
    if (from < 0 || to < 0 || to < from) return null;
    for (let d = from; d <= to; d++) days[d] = true;
  }
  return { open: m[2], close: m[3], days };
}

export const PRICE_CHIPS = [
  { label: 'Miễn phí', min: 0, max: 0 },
  { label: '< 50k', min: null, max: 50_000 },
  { label: '50–150k', min: 50_000, max: 150_000 },
  { label: '150–300k', min: 150_000, max: 300_000 },
  { label: '> 300k', min: 300_000, max: null },
] as const;

const k = (v: number) => (v % 1000 === 0 ? `${v / 1000}k` : `${v.toLocaleString('vi-VN')}đ`);

export function formatPrice(min: number | null, max: number | null): string | null {
  if (min === 0 && max === 0) return 'Miễn phí';
  if (min === null && max === null) return null;
  if (min === null) return `< ${k(max!)}`;
  if (max === null) return `> ${k(min)}`;
  return min === max ? k(min) : `${min / 1000}–${k(max)}`;
}

export function notesSummary(notes: PlaceNotes | null): string | null {
  if (!notes) return null;
  const hours = notes.openingHours
    ? (() => {
        const f = parseSimpleHours(notes.openingHours);
        return f && f.days.every(Boolean) ? `${f.open}–${f.close}` : 'Có giờ mở cửa';
      })()
    : null;
  const parts = [hours, formatPrice(notes.priceMin, notes.priceMax)].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
```
(Kiểm tra lại `formatPrice(50000,150000)` ra đúng `'50–150k'`: `min/1000 = 50`, `k(150000) = '150k'` → `'50–150k'`. Nếu `min` không chia hết 1000 thì dùng `k(min)` cho cả hai đầu — viết nhánh đó, không để `'50.5–…'`.)

Run → PASS.

- [ ] **Step 3: Test form (đỏ)** — `place-notes-form.test.tsx` (bọc `SafeAreaProvider` như `place-detail-trip-actions.test.tsx`):
  - bật "Giờ mở cửa", để mặc định 07:00–22:00 cả tuần, bấm nút submit → `onSubmit` nhận `{ openingHours: 'Mo-Su 07:00-22:00' }` và **không** có các trường không đổi;
  - bấm chip "50–150k" → `onSubmit` nhận `{ priceMin: 50000, priceMax: 150000 }`;
  - `initial.openingHours = 'Mo-Fr 08:00-12:00,13:30-17:00'` → hiện chuỗi gốc kèm nút "Xóa giờ"; chỉ sửa ghi chú rồi submit → `onSubmit` không chứa `openingHours`;
  - xóa hết ô ghi chú đã có → gửi `note: null`.
  Giờ dùng `DateTimeField`-kiểu riêng chỉ giờ: dùng `DateTimePicker` của `@expo/ui/community/datetime-picker` với `mode="time"` giống nhánh Android của `components/ui/date-time-field.tsx`; trong test bỏ qua việc chọn giờ (dùng giờ mặc định).

- [ ] **Step 4: Cài đặt `PlaceNotesForm`** — `ScrollView` (gesture-handler) `keyboardShouldPersistTaps="handled"`; các phần:
  1. `header` (nếu có).
  2. `TextField` "Ghi chú" `multiline`, `maxLength={1000}`.
  3. Hàng "Giờ mở cửa" + công tắc (mặc định tắt khi `initial` không có giờ). Bật: hai ô giờ "Mở" / "Đóng" (một dòng chữ nhỏ "Qua đêm" khi đóng ≤ mở), bảy chip T2…CN. `initial` có chuỗi mà `parseSimpleHours` trả null: hiện chuỗi trong một `Notice` cùng nút "Xóa giờ" (gửi `openingHours: null`) và "Nhập lại" (chuyển sang form với mặc định).
  4. "Giá mỗi người": hàng `Chip` từ `PRICE_CHIPS` (chip đang khớp thì `selected`), hai `TextField` số "Từ" / "Đến" (`keyboardType="number-pad"`, hiển thị `toLocaleString('vi-VN')`, lưu số nguyên).
  5. `Button` `submitLabel` (`loading={busy}`), `error` hiện bằng `Notice tone="danger"` phía trên.
  - Tính `patch` bằng cách so từng trường với `initial` (chuẩn hóa chuỗi rỗng → null); chỉ đưa trường khác vào.
  Run test → PASS; `npx tsc --noEmit`, `npx expo lint` sạch.

- [ ] **Step 5: Commit** — `feat(mobile): place notes form, opening-hours builder and price helpers`

---

### Task 8: Mobile — màn ghim vị trí

**Files:**
- Create: `apps/mobile/src/app/(app)/place/pin.tsx`, `apps/mobile/src/hooks/use-pin-address.ts`, `apps/mobile/src/__tests__/use-pin-address.test.ts`, `apps/mobile/src/lib/pinned-candidates.ts`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx` (`<Stack.Screen name="place/pin" />`), `apps/mobile/src/components/region-map.tsx` hoặc tạo `components/pin-map.tsx` + `pin-map.web.tsx` (bản đồ có ghim cố định; web vẽ thông báo "Chưa hỗ trợ trên web")

**Interfaces:**
- Consumes: `GET /places/reverse-geocode`, `POST /places/user`, `PATCH /places/user/:id`, `PATCH /places/:id/notes`, `useRegionSearch`, `PlaceNotesForm`.
- Produces:
  ```ts
  export function usePinAddress(center: { lat: number; lng: number } | null, settledMs = 1000):
    { status: 'moving' | 'loading' | 'done'; address: string | null };
  // pinned-candidates.ts (useSyncExternalStore, như trip-draft.ts)
  export const pinnedCandidates: { mark(shareImportId: string, candidateKey: string): void };
  export function usePinnedCandidates(shareImportId: string): ReadonlySet<string>;
  ```

- [ ] **Step 1: Test `usePinAddress` (đỏ)** — jest fake timers, mock `useAuth` trả `authFetch` giả:

```ts
it('chỉ gọi sau 1 giây đứng yên; kéo tiếp thì đếm lại', async () => {
  const { result, rerender } = await renderHook(({ c }) => usePinAddress(c), { initialProps: { c: A } });
  expect(result.current.status).toBe('moving');
  await act(() => jest.advanceTimersByTime(900));
  await rerender({ c: B });
  await act(() => jest.advanceTimersByTime(900));
  expect(mockAuthFetch).not.toHaveBeenCalled();
  await act(() => jest.advanceTimersByTime(100));
  expect(mockAuthFetch).toHaveBeenCalledWith(`/places/reverse-geocode?lat=${B.lat}&lng=${B.lng}`);
});

it('phản hồi cũ về muộn thì bỏ', async () => {
  let resolveA!: (v: { address: string | null }) => void;
  mockAuthFetch
    .mockImplementationOnce(() => new Promise((r) => { resolveA = r; }))
    .mockResolvedValueOnce({ address: 'Địa chỉ B' });
  const { result, rerender } = await renderHook(({ c }) => usePinAddress(c), { initialProps: { c: A } });
  await act(() => jest.advanceTimersByTime(1000)); // gửi A (chưa về)
  await rerender({ c: B });
  await act(() => jest.advanceTimersByTime(1000)); // gửi B, về ngay
  await act(async () => resolveA({ address: 'Địa chỉ A' })); // A về muộn
  expect(result.current).toEqual({ status: 'done', address: 'Địa chỉ B' });
});

it('lỗi mạng → done, address null (chỉ hiện tọa độ)', async () => {
  mockAuthFetch.mockRejectedValueOnce(new Error('mạng'));
  const { result } = await renderHook(() => usePinAddress(A));
  await act(() => jest.advanceTimersByTime(1000));
  expect(result.current).toEqual({ status: 'done', address: null });
});
```
Đầu file: `const A = { lat: 11.94, lng: 108.44 }; const B = { lat: 11.95, lng: 108.45 };`, `const mockAuthFetch = jest.fn();`, `jest.mock('@/auth/auth-context', () => ({ useAuth: () => ({ authFetch: mockAuthFetch }) }));`, `beforeEach(() => { jest.useFakeTimers(); mockAuthFetch.mockReset(); })`, `afterEach(() => jest.useRealTimers())`. Test đầu cho `mockAuthFetch.mockResolvedValue({ address: null })`.

- [ ] **Step 2: Cài đặt hook**

```ts
export function usePinAddress(center: { lat: number; lng: number } | null, settledMs = 1000) {
  const { authFetch } = useAuth();
  const [state, setState] = useState<{ status: 'moving' | 'loading' | 'done'; address: string | null }>({ status: 'moving', address: null });
  const latest = useRef(0);
  useEffect(() => {
    if (!center) return;
    const id = ++latest.current;
    setState({ status: 'moving', address: null }); // eslint-disable-line react-hooks/set-state-in-effect
    const timer = setTimeout(() => {
      setState({ status: 'loading', address: null });
      authFetch<ReverseGeocodeResponse>(`/places/reverse-geocode?lat=${center.lat}&lng=${center.lng}`)
        .then((r) => id === latest.current && setState({ status: 'done', address: r.address }))
        .catch(() => id === latest.current && setState({ status: 'done', address: null }));
    }, settledMs);
    return () => clearTimeout(timer);
  }, [center?.lat, center?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
```

- [ ] **Step 3: `PinMap`** — `MapView` toàn màn hình (cùng `provider` như `region-map.tsx`; nếu branch sửa iOS đã vào thì theo quy tắc đó), `initialRegion` theo bbox hoặc vị trí cũ, `onRegionChange` → báo "đang kéo", `onRegionChangeComplete(region)` → báo tâm mới. Ghim là một `View` `pointerEvents="none"` đặt giữa (đầu nhọn trùng tâm: dịch lên bằng nửa chiều cao icon). `showsUserLocation` khi có quyền; nút "Vị trí của tôi" là `Glass` nổi gọi `animateToRegion` tới vị trí hiện tại (`expo-location getCurrentPositionAsync`).

- [ ] **Step 4: Màn `place/pin.tsx`** — state `step: 'region' | 'pin' | 'info'`, `region: { id, name, bbox } | null`, `center`, `address`.
  - Bước `region`: `SearchField` + danh sách `useRegionSearch(q).results` (dùng `RegionResult`); `hintRegionId` có thì hiện dòng đầu "Gợi ý từ bài: <tên>". Chọn → lấy bbox: kết quả tìm vùng đã có `bbox`; gợi ý từ bài chưa có thì gọi `GET /regions/:id` nếu có route đó — **không có thì** truyền `bbox = null` và để `PinMap` mở theo vị trí trung tâm vùng từ kết quả tìm (`center`), ledger Ruling.
  - Bước `pin`: `PinMap` + thẻ đáy (`Glass`, chừa `insets.bottom`): `moving` → "Đang di chuyển…"; `loading` → `ActivityIndicator` + tọa độ; `done` → `address ?? 'Chưa rõ địa chỉ'` + tọa độ `toFixed(5)`. Ngoài bbox nới 0.02 → "Ngoài <vùng>" và nút tắt. Nút "Ghim ở đây" → bước `info`.
  - Bước `info`: `BottomSheet` chứa `PlaceNotesForm` với `header` = `TextField` "Tên" + hàng `Chip` loại (`CATEGORIES`). Submit:
    - tạo mới: `POST /places/user` `{ name, category, lat, lng, regionId, address, notes: patch, shareImportId }` → `saved.reload()`; có `shareImportId` thì `pinnedCandidates.mark(shareImportId, candidateKey)`; `router.back()` (về màn chia sẻ / màn Vùng).
    - sửa (`editPlaceId`): `PATCH /places/user/:id` `{ name, category, lat, lng, address }` → `router.back()`.
    - Lỗi `PIN_OUTSIDE_REGION` → quay lại bước `pin` kèm Notice; `PIN_LIMIT` → Notice; khác → Notice với `ApiError.message`.
  - Màn tràn mép: không dùng `<Screen>`; nút quay lại `Glass` ở `insets.top`; bước `region` và `info` bọc `KeyboardAvoider`.

- [ ] **Step 5: Đăng ký route** trong `(app)/_layout.tsx`: `<Stack.Screen name="place/pin" />` (đặt trước `place/[id]`).
- [ ] **Step 6: Chạy** `npx jest src/__tests__/use-pin-address.test.ts && npx tsc --noEmit && npx expo lint` → PASS/sạch.
- [ ] **Step 7: Commit** — `feat(mobile): pin screen (pick region, pin with live address, name and notes)`

---

### Task 9: Mobile — lối vào, chi tiết địa điểm, "Muốn đi", lịch trình

**Files:**
- Modify: `apps/mobile/src/app/(app)/share-import/[id].tsx`, `apps/mobile/src/components/place-search-results.tsx`, `apps/mobile/src/app/(app)/place/[id].tsx`, `apps/mobile/src/app/(app)/saved.tsx`, `apps/mobile/src/components/itinerary-view/itinerary-view.tsx`, `apps/mobile/src/app/(app)/itinerary/[id].tsx`, `apps/mobile/src/components/ui/map-marker.tsx` (không đổi nếu marker chỉ nét đứt khi `approximate`)
- Create: `apps/mobile/src/components/place-notes-card.tsx`, `apps/mobile/src/components/place-notes-sheet.tsx`
- Test: `apps/mobile/src/__tests__/share-import-pin.test.tsx`, `apps/mobile/src/__tests__/place-notes-card.test.tsx`

- [ ] **Step 1: Test (đỏ)**
  - `share-import-pin.test.tsx`: render `CandidateCard` (export nó, hoặc render cả màn với `useShareImport` mock) cho ứng viên `confidence: 'none'` có `regionHint` → có nút "Ghim vị trí"; bấm → `router.push({ pathname: '/place/pin', params: { name, category, shareImportId, candidateKey, hintRegionId, hintRegionName } })`; ứng viên `high` không có nút; khi `usePinnedCandidates` chứa `candidateKey` → hiện "Đã ghim ✓", không có nút.
  - `place-notes-card.test.tsx`: `notes = null` → nút "Thêm ghi chú"; có ghi chú → hiện mô tả và tóm tắt "07:00–22:00 · 50–150k", nút "Sửa"; `readOnly` → không có nút.
- [ ] **Step 2: Màn chia sẻ** — trong nhánh "Chưa tìm được địa điểm khớp": thêm `Button label="Ghim vị trí" size="sm"` cạnh "Tự tìm" (hàng ngang, nhãn ngắn); `const pinned = usePinnedCandidates(id)`; `pinned.has(candidate.key)` → thay cả khối bằng `Text` "Đã ghim ✓ · Đã lưu vào Muốn đi".
- [ ] **Step 3: Màn Vùng** (`place-search-results.tsx`) — khi `noResults`, dưới dòng "Không tìm thấy…" thêm `Button label="Thêm địa điểm của riêng bạn" variant="primary"` → `router.push({ pathname: '/place/pin', params: { regionId, regionName, name: q } })`.
- [ ] **Step 4: `PlaceNotesCard` + `PlaceNotesSheet`** — thẻ "Ghi chú của bạn" (hoặc "Ghi chú của người tạo lịch trình" khi `readOnly`): mô tả, `notesSummary`, nút "Sửa"/"Thêm ghi chú". Sheet = `BottomSheet` + `PlaceNotesForm` (`submitLabel="Lưu"`), lưu bằng `PATCH /places/:id/notes`, gọi `onSaved(notes)`. Nếu `patch.openingHours !== undefined` và người dùng có lịch trình chứa điểm (`useItineraries()` có sẵn — lọc theo `days[].items[].placeId` nếu summary có; không có dữ liệu đó thì luôn hiện) → `Alert` "Giờ mới áp dụng cho lịch trình khi bạn chỉnh lịch lần tới".
- [ ] **Step 5: Chi tiết địa điểm** (`place/[id].tsx`):
  - Params thêm `ownerNotes?: string` (JSON `PlaceNotes`) — có thì `PlaceNotesCard readOnly notes={JSON.parse(ownerNotes)}`; không có thì `PlaceNotesCard notes={place.notes}` có sửa, `onSaved` → `detail.reload()` và `saved.reload()`.
  - `place.locationSource === 'user'`: nhãn "Vị trí bạn ghim" (thay `ApproximateLocation`); `place.createdByMe` → `Button label="Sửa tên, loại, vị trí" variant="plain"` → `/place/pin` với `editPlaceId`, `name`, `category`, `regionId` (bước bắt đầu `pin`, center = `place.coordinates`).
- [ ] **Step 6: "Muốn đi"** (`saved.tsx`) — `SavedRow` thêm dòng `notesSummary(item.notes)` (một dòng, `numberOfLines={1}`).
- [ ] **Step 7: Lịch trình** — `TimelineItemCard` hiện `item.place.notes.note` (2 dòng) và `notesSummary` dưới địa chỉ. `ItineraryViewBody` thêm prop `canEditNotes: boolean` (`myRole === 'creator'`) và `onNotesSaved: () => void`; card có `Pressable` "Sửa ghi chú" khi `canEditNotes` → mở `PlaceNotesSheet` (state ở body) → `onNotesSaved` = `itinerary.reload()`. Khi không phải người tạo, mở chi tiết địa điểm kèm `ownerNotes: JSON.stringify(item.place.notes)` nếu có.
- [ ] **Step 8: Chạy** `npx jest --silent && npx tsc --noEmit && npx expo lint` → tất cả PASS, lint không có lỗi mới.
- [ ] **Step 9: Commit** (có thể chia 2–3 commit theo màn) — `feat(mobile): pin entry points, notes card on place detail, notes in saved list and itineraries`

---

### Task 10: Trang công khai `/t/:token` hiện ghi chú

**Files:**
- Modify: `apps/web/src/lib/format.ts` (thêm `notesLine(notes)`), `apps/web/src/lib/format.test.ts`, `apps/web/src/app/t/[token]/page.tsx`

- [ ] **Step 1: Test (đỏ)** — `notesLine({ note: 'Đi sớm', openingHours: 'Mo-Su 06:00-09:00', priceMin: 20000, priceMax: 40000 })` → `'Đi sớm · Giờ: Mo-Su 06:00-09:00 · Giá: 20.000–40.000 đ'`; `notesLine(null)` → `null`.
- [ ] **Step 2: Cài đặt** và hiện trong `page.tsx` dưới `describeItem(item)`: `{line ? <p className="text-sm opacity-70">{line}</p> : null}` với `const line = notesLine(item.place?.notes ?? null)`. Đọc `apps/web/AGENTS.md` trước khi sửa.
- [ ] **Step 3: Chạy** `cd apps/web && pnpm test && pnpm lint && npx tsc --noEmit` → PASS.
- [ ] **Step 4: Commit** — `feat(web): show the creator's place notes on shared itineraries`

---

### Task 11: Tài liệu

**Files:** `CLAUDE.md`, `apps/backend/src/modules/README.md`, `apps/backend/.env.example` (không có biến mới — chỉ kiểm tra)

- [ ] **Step 1:** `CLAUDE.md` — mục Places: thêm đoạn "**Điểm tự ghim** (`places.source = 'user'`, `created_by`) …" và `place_notes`; bảng gateway: `OpenDataService` thêm "Nominatim reverse (màn ghim)". Mục Itineraries: lịch trình đọc `place_notes` của người tạo, giờ ghi chú ưu tiên.
- [ ] **Step 2:** `modules/README.md` — mục "`places.source` và dòng Google": thêm dòng `user`; mục mới "Địa điểm tự ghim và ghi chú" liệt kê route, giới hạn, cách ly.
- [ ] **Step 3: Commit** — `docs: user-pinned places and place notes`

---

## Kiểm tra cuối

- `cd apps/backend && pnpm build:deps && npx vitest run && pnpm lint && pnpm typecheck`
- e2e: `npx vitest run --config vitest.config.e2e.ts test/user-places.e2e-spec.ts test/saved-places.e2e-spec.ts test/share-imports.e2e-spec.ts test/itineraries.e2e-spec.ts test/share-links.e2e-spec.ts test/groups.e2e-spec.ts test/web-places.e2e-spec.ts`
- `cd apps/mobile && npx jest && npx tsc --noEmit && npx expo lint`
- `cd apps/web && pnpm test && pnpm lint`
- Báo cáo kèm tên các test đã đỏ từ trước (không do branch này), nếu còn.
