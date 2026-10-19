# Gợi ý lịch trình trang chủ — Giai đoạn 1: Nền — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuẩn bị mọi thứ bộ gợi ý cần mà chưa đụng tới hàng đợi: schema mới, hàm lập lịch không lưu `planTrip()`, sở thích trên server, và "nơi đã đi" (suy ra + xác nhận lại).

**Architecture:** Một migration SQL viết tay thêm cột/bảng mới (bảng mới đọc ghi bằng raw SQL như `region_places`, không tạo entity). Phần lập lịch trong `ItinerariesService.create()` được tách sang `ItineraryPlanner.planTrip()` (không lưu), `create()` gọi lại nó. `UsersModule` nhận `interests`. Module mới `modules/visits` suy ra nơi đã đi từ lịch trình đã kết thúc và nhận xác nhận của người dùng.

**Tech Stack:** NestJS 12, TypeORM (raw SQL qua `DataSource.query`), Postgres + PostGIS, vitest + supertest.

**Spec:** `docs/superpowers/specs/2026-10-19-home-recommendations-design.md`

Giai đoạn tiếp theo: `2026-10-19-home-recommendations-2-engine.md` (BullMQ, chấm điểm, API `/recommendations`), `2026-10-19-home-recommendations-3-mobile.md`.

## Global Constraints

- Nhánh `feat/home-recommendations`.
- Backend ESM: import tương đối kết thúc `.js`. Comment, log, message lỗi tiếng Việt. Lỗi ném Nest exception với body `{ statusCode, code, message }`.
- Schema chỉ đổi qua migration trong `apps/backend/src/database/migrations/` (`synchronize` luôn tắt).
- Kiểu danh mục là enum Postgres `place_category`. **node-pg trả cột `place_category[]` dưới dạng chuỗi `{a,b}`**: mọi raw `SELECT` cột này phải ép `::text[]`; khi ghi, truyền mảng JS và ép `$n::place_category[]`.
- Tham số raw SQL không rõ kiểu phải ép tường minh (`$3::uuid[]`, `$2::int`).
- Sau khi sửa `packages/shared-types`, chạy `pnpm --filter @rong/backend build:deps` trước khi gọi thẳng `vitest`/`tsc`.
- e2e chạy trên DB dev Neon (`apps/backend/.env`). **Hỏi người dùng trước khi chạy `pnpm migration:run`.** e2e chỉ chạy được sau khi migration đã chạy.
- Hành vi và mã lỗi của `POST /itineraries` không đổi: `INVALID_DATES`, `TRIP_TOO_LONG`, `TRIP_TOO_SHORT`, `UNKNOWN_REGION`, `UNKNOWN_PLACES`, `INVALID_ACCOMMODATION`, `NOT_ENOUGH_PLACES`.
- "Đã đi" khi chấm điểm = `visited_places.status IN ('inferred','confirmed')`.

## Review Focus

1. Lịch trình nhóm đã kết thúc: thành viên nhóm (không phải người tạo) cũng có dòng `inferred` cho các địa điểm, và cũng thấy lịch trình trong `GET /visits/pending`. Test: Task 4 `thành viên nhóm cũng được suy ra`.
2. `POST /visits/review` với `visitedPlaceIds` rỗng → mọi địa điểm của lịch trình thành `rejected`, lần suy ra sau không thêm lại. Test: Task 4 `review rỗng`.
3. Người không xem được lịch trình gọi `POST /visits/review` → 404 `ITINERARY_NOT_FOUND`, không lộ lịch trình tồn tại. Test: Task 4.
4. `PATCH /users/me` chỉ gửi `interests` không làm mất `displayName`, gửi body rỗng → 400 `EMPTY_UPDATE`, danh mục lạ → 400. Test: Task 3.
5. `excludePlaceIds` loại cả quán ăn (`foodPool`), không chỉ điểm tham quan. Test: Task 2 `excludePlaceIds loại cả quán ăn`.

---

### Task 1: Migration cho bảng và cột mới

**Files:**
- Create: `apps/backend/src/database/migrations/1792300000000-AddHomeRecommendations.ts`
- Modify: `apps/backend/src/modules/users/entities/user.entity.ts`
- Modify: `apps/backend/src/modules/itineraries/entities/itinerary.entity.ts`

**Interfaces:**
- Produces: các bảng `visited_places`, `user_themes`, `itinerary_drafts`, `user_recommendations`, `region_images`; cột `users.interests`, `itineraries.visit_reviewed_at`; `User.interests: PlaceCategory[]`; `Itinerary.visitReviewedAt: Date | null`.

- [ ] **Step 1: Viết migration**

```ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gợi ý lịch trình ở trang chủ (spec 2026-10-19-home-recommendations): sở thích
 * trên server, nơi đã đi, chủ đề riêng, kho bản nháp dùng chung, gợi ý của từng
 * người và ảnh vùng.
 */
export class AddHomeRecommendations1792300000000 implements MigrationInterface {
  name = 'AddHomeRecommendations1792300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "interests" place_category[] NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "itineraries" ADD COLUMN "visit_reviewed_at" timestamptz`,
    );

    await queryRunner.query(`
      CREATE TABLE "visited_places" (
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "place_id" uuid NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
        "region_id" uuid NOT NULL REFERENCES "regions"("id") ON DELETE CASCADE,
        "status" text NOT NULL CHECK ("status" IN ('inferred', 'confirmed', 'rejected')),
        "itinerary_id" uuid REFERENCES "itineraries"("id") ON DELETE SET NULL,
        "visited_at" timestamptz NOT NULL,
        PRIMARY KEY ("user_id", "place_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_visited_places_user_status" ON "visited_places" ("user_id", "status")`,
    );

    await queryRunner.query(`
      CREATE TABLE "user_themes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "label" text NOT NULL,
        "icon" text NOT NULL,
        "categories" place_category[] NOT NULL,
        "region_ids" uuid[] NOT NULL CHECK (cardinality("region_ids") >= 1),
        "generated_at" timestamptz NOT NULL DEFAULT now(),
        "expires_at" timestamptz NOT NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_user_themes_user" ON "user_themes" ("user_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "itinerary_drafts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "region_id" uuid NOT NULL REFERENCES "regions"("id") ON DELETE CASCADE,
        "pool_key" text NOT NULL,
        "list_version" timestamptz NOT NULL,
        "categories" place_category[] NOT NULL,
        "days_count" smallint NOT NULL,
        "travel_party" text NOT NULL,
        "pace" text NOT NULL,
        "budget_tier" text NOT NULL,
        "input" jsonb NOT NULL,
        "days" jsonb NOT NULL,
        "unscheduled" jsonb NOT NULL DEFAULT '[]',
        "warnings" jsonb NOT NULL DEFAULT '[]',
        "tips" jsonb NOT NULL DEFAULT '[]',
        "cost" jsonb NOT NULL DEFAULT '{}',
        "place_ids" uuid[] NOT NULL,
        "exclude_place_ids" uuid[] NOT NULL DEFAULT '{}',
        "planner" text NOT NULL CHECK ("planner" IN ('heuristic', 'ai')),
        "view_count" integer NOT NULL DEFAULT 0,
        "save_count" integer NOT NULL DEFAULT 0,
        "upgraded_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_itinerary_drafts_pool_key" ON "itinerary_drafts" ("pool_key")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_itinerary_drafts_place_ids" ON "itinerary_drafts" USING GIN ("place_ids")`,
    );

    await queryRunner.query(`
      CREATE TABLE "user_recommendations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "window_start" timestamptz NOT NULL,
        "theme_key" text NOT NULL,
        "slot" smallint NOT NULL CHECK ("slot" BETWEEN 0 AND 2),
        "draft_id" uuid NOT NULL REFERENCES "itinerary_drafts"("id") ON DELETE CASCADE,
        "region_id" uuid NOT NULL REFERENCES "regions"("id") ON DELETE CASCADE,
        "starts_at" timestamptz NOT NULL,
        "params" jsonb NOT NULL,
        "reason" jsonb NOT NULL,
        "score" real NOT NULL,
        "viewed_at" timestamptz,
        "saved_itinerary_id" uuid REFERENCES "itineraries"("id") ON DELETE SET NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_user_recommendation_slot" UNIQUE ("user_id", "window_start", "theme_key", "slot")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_user_recommendations_user_created" ON "user_recommendations" ("user_id", "created_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "region_images" (
        "region_id" uuid PRIMARY KEY REFERENCES "regions"("id") ON DELETE CASCADE,
        "status" text NOT NULL CHECK ("status" IN ('found', 'none')),
        "url" text,
        "width" integer,
        "height" integer,
        "source" text CHECK ("source" IN ('unsplash', 'web')),
        "author" text,
        "author_url" text,
        "source_url" text,
        "license" text,
        "blocked" boolean NOT NULL DEFAULT false,
        "fetched_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "region_images"`);
    await queryRunner.query(`DROP TABLE "user_recommendations"`);
    await queryRunner.query(`DROP TABLE "itinerary_drafts"`);
    await queryRunner.query(`DROP TABLE "user_themes"`);
    await queryRunner.query(`DROP TABLE "visited_places"`);
    await queryRunner.query(
      `ALTER TABLE "itineraries" DROP COLUMN "visit_reviewed_at"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "interests"`);
  }
}
```

Ghi chú: hai cột không có trong bảng của spec. `user_recommendations.params` giữ thông số chuyến đi của gợi ý (`TripParams`: đối tượng, số người, nhịp độ, ngân sách, số ngày), vì số người lớn/trẻ em không nằm trong `pool_key` nên phải lưu ở lớp riêng từng người. Cột `exclude_place_ids` giữ tập địa điểm đã loại khi tạo biến thể, để `upgrade-draft` (giai đoạn 2) xếp lại bằng Gemini mà vẫn loại đúng các địa điểm đó.

- [ ] **Step 2: Thêm cột vào entity**

Trong `user.entity.ts`, thêm import và cột sau `lastSeenAt`:

```ts
import type { PlaceCategory } from '@rong/shared-types';
import { PLACE_CATEGORIES } from '../../places/entities/place.entity.js';
```

```ts
  /** Sở thích chọn ở onboarding / Tài khoản (spec 2026-10-19-home-recommendations). */
  @Column({
    name: 'interests',
    type: 'enum',
    enum: PLACE_CATEGORIES,
    enumName: 'place_category',
    array: true,
    default: '{}',
  })
  interests!: PlaceCategory[];
```

Trong `itinerary.entity.ts`, thêm sau `aiEditsRemaining`:

```ts
  /** Lúc người dùng xác nhận "đã đến những nơi nào" sau chuyến đi; null = chưa hỏi. */
  @Column({ name: 'visit_reviewed_at', type: 'timestamptz', nullable: true })
  visitReviewedAt!: Date | null;
```

Nếu import `place.entity.js` từ `user.entity.ts` tạo vòng import (kiểm tra bằng typecheck ở bước 3), thay `enum: PLACE_CATEGORIES` bằng mảng literal cùng thứ tự: `['check_in', 'food', 'cafe', 'nature', 'kids', 'culture', 'nightlife', 'stay']`.

- [ ] **Step 3: Typecheck và lint**

Run: `pnpm --filter @rong/backend typecheck && pnpm --filter @rong/backend lint`
Expected: không lỗi.

- [ ] **Step 4: Hỏi người dùng rồi chạy migration**

Hỏi người dùng: "Chạy `pnpm --filter @rong/backend migration:run` trên DB dev (Neon) để thêm các bảng gợi ý chứ?" Chỉ chạy khi được đồng ý.

Run: `pnpm --filter @rong/backend migration:run`
Expected: log `Migration AddHomeRecommendations1792300000000 has been executed successfully.`

- [ ] **Step 5: Chạy lại e2e có sẵn để chắc entity đọc được cột mới**

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/account.e2e-spec.ts test/itinerary.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/database/migrations/1792300000000-AddHomeRecommendations.ts apps/backend/src/modules/users/entities/user.entity.ts apps/backend/src/modules/itineraries/entities/itinerary.entity.ts
git commit -m "feat(backend): add schema for home recommendations"
```

---

### Task 2: Tách `ItineraryPlanner.planTrip()` khỏi `ItinerariesService.create()`

**Files:**
- Create: `apps/backend/src/modules/itineraries/errors.ts`
- Create: `apps/backend/src/modules/itineraries/itinerary-planner.ts`
- Modify: `apps/backend/src/modules/itineraries/itineraries.service.ts` (`create()` dòng 99–336, `update()` dùng `loadPlaces`, xóa `poolInArea`/`loadPlaces`/`regionName`/`PLACE_SELECT`/`toCandidate`/`PlaceRow`/`bad` khỏi file)
- Modify: `apps/backend/src/modules/itineraries/itineraries.module.ts`
- Test: `apps/backend/test/itinerary-planner.e2e-spec.ts`

**Interfaces:**
- Produces:
  ```ts
  // errors.ts
  export function bad(code: string, message: string, extra?: object): BadRequestException;
  // itinerary-planner.ts
  export interface PlanTripOptions { excludePlaceIds?: string[]; forceHeuristic?: boolean }
  export interface PlanTripResult {
    regionName: string;
    planner: PlannerKind;
    days: ItineraryDay[];
    unscheduled: UnscheduledPlace[];
    warnings: ItineraryWarning[];
    tips: string[];
  }
  @Injectable() export class ItineraryPlanner {
    planTrip(input: ItineraryInput, options?: PlanTripOptions): Promise<PlanTripResult>;
    loadPlaces(ids: string[], mandatory: boolean): Promise<Candidate[]>;
    regionName(regionId: string): Promise<string>;
  }
  ```
  `ItinerariesModule` export `ItineraryPlanner` và `ItinerariesService`.

- [ ] **Step 1: Viết test hỏng**

Tạo `apps/backend/test/itinerary-planner.e2e-spec.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ItineraryInput } from '@rong/shared-types';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { LangchainService } from '../src/langchain/langchain.service.js';
import { ItineraryPlanner } from '../src/modules/itineraries/itinerary-planner.js';

/** planTrip(): lập lịch không lưu, dùng cho bản nháp gợi ý (spec 2026-10-19-home-recommendations). */
describe('ItineraryPlanner.planTrip (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let planner: ItineraryPlanner;
  let regionId: string;
  const planItinerary = vi.fn();
  const ids: Record<string, string> = {};

  const places: Array<[string, string, number, number]> = [
    ['ho', 'nature', 11.9404, 108.4383],
    ['ga', 'culture', 11.9422, 108.4556],
    ['thung_lung', 'nature', 11.9775, 108.4474],
    ['datanla', 'nature', 11.9007, 108.4494],
    ['dinh3', 'culture', 11.9311, 108.4297],
    ['vuon', 'kids', 11.9496, 108.4533],
    ['view', 'check_in', 11.925, 108.46],
    ['cafe', 'cafe', 11.943, 108.441],
    ['com1', 'food', 11.941, 108.439],
    ['com2', 'food', 11.945, 108.45],
    ['com3', 'food', 11.935, 108.444],
  ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LangchainService)
      .useValue({ planItinerary })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DataSource);
    planner = app.get(ItineraryPlanner);

    [{ id: regionId }] = (await db.query(
      `SELECT id FROM regions WHERE source_key = 'vn:destination:da-lat'`,
    )) as Array<{ id: string }>;
    await db.query(
      `INSERT INTO region_place_lists (region_id, status, fetched_at, expires_at)
       VALUES ($1, 'ready', now(), now() + interval '30 days')
       ON CONFLICT (region_id) DO NOTHING`,
      [regionId],
    );
    for (const [rank, [key, category, lat, lng]] of places.entries()) {
      const [row] = (await db.query(
        `INSERT INTO places (source, name, category, location, location_source)
         VALUES ('web', $1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), 'ai')
         RETURNING id`,
        [`E2E planner ${key}`, category, lng, lat],
      )) as Array<{ id: string }>;
      ids[key] = row.id;
      // Đứng đầu danh sách vùng để chắc chắn được chọn trước dữ liệu khác.
      await db.query(
        `INSERT INTO region_places (region_id, place_id, rank) VALUES ($1, $2, $3)`,
        [regionId, row.id, -100 + rank],
      );
    }
  });

  afterAll(async () => {
    await db?.query(
      `DELETE FROM region_places rp USING places p
        WHERE rp.place_id = p.id AND p.name LIKE 'E2E planner %'`,
    );
    await db?.query(`DELETE FROM places WHERE name LIKE 'E2E planner %'`);
    await app?.close();
  });

  const input = (): ItineraryInput => ({
    regionId,
    planningMode: 'ai',
    startsAt: '2026-01-03T08:00:00+07:00',
    endsAt: '2026-01-04T18:00:00+07:00',
    travelParty: 'couple',
    adults: 2,
    children: 0,
    selectedPlaceIds: [],
    accommodationPlaceId: null,
    allowAiSuggestions: true,
    budgetTier: 'moderate',
    pace: 'moderate',
    transport: null,
    preferredCategories: [],
    notes: null,
  });

  const placeIdsOf = (days: Awaited<ReturnType<ItineraryPlanner['planTrip']>>['days']) =>
    days.flatMap((d) => d.items.flatMap((i) => (i.placeId ? [i.placeId] : [])));

  it('forceHeuristic không gọi Gemini và trả planner heuristic', async () => {
    planItinerary.mockClear();
    const result = await planner.planTrip(input(), { forceHeuristic: true });
    expect(planItinerary).not.toHaveBeenCalled();
    expect(result.planner).toBe('heuristic');
    expect(result.days).toHaveLength(2);
    expect(placeIdsOf(result.days).length).toBeGreaterThan(0);
  });

  it('excludePlaceIds không bao giờ xuất hiện trong kết quả', async () => {
    const excluded = [ids.ho, ids.ga, ids.thung_lung];
    const result = await planner.planTrip(input(), {
      forceHeuristic: true,
      excludePlaceIds: excluded,
    });
    const used = placeIdsOf(result.days);
    for (const id of excluded) expect(used).not.toContain(id);
  });

  it('excludePlaceIds loại cả quán ăn', async () => {
    const excluded = [ids.com1, ids.com2];
    const result = await planner.planTrip(input(), {
      forceHeuristic: true,
      excludePlaceIds: excluded,
    });
    const used = placeIdsOf(result.days);
    expect(used).not.toContain(ids.com1);
    expect(used).not.toContain(ids.com2);
  });

  it('không lưu gì vào itineraries', async () => {
    const [{ count: before }] = (await db.query(
      `SELECT count(*)::int AS count FROM itineraries`,
    )) as Array<{ count: number }>;
    await planner.planTrip(input(), { forceHeuristic: true });
    const [{ count: after }] = (await db.query(
      `SELECT count(*)::int AS count FROM itineraries`,
    )) as Array<{ count: number }>;
    expect(after).toBe(before);
  });

  it('Gemini lỗi thì vẫn ra lịch heuristic', async () => {
    planItinerary.mockRejectedValueOnce(new Error('hết quota'));
    const result = await planner.planTrip(input());
    expect(planItinerary).toHaveBeenCalled();
    expect(result.planner).toBe('heuristic');
  });
});
```

- [ ] **Step 2: Chạy test để thấy hỏng**

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/itinerary-planner.e2e-spec.ts`
Expected: FAIL, không resolve được `../src/modules/itineraries/itinerary-planner.js`.

- [ ] **Step 3: Tạo `errors.ts`**

```ts
import { BadRequestException } from '@nestjs/common';

export function bad(
  code: string,
  message: string,
  extra: object = {},
): BadRequestException {
  return new BadRequestException({ statusCode: 400, code, message, ...extra });
}
```

- [ ] **Step 4: Tạo `itinerary-planner.ts`**

Chuyển nguyên phần lập lịch của `create()` sang đây. Code dưới đây giữ đúng thứ tự và thông điệp của `create()` hiện tại; chỗ khác duy nhất là `exclude` gộp `excludePlaceIds`, `poolInArea` nhận `exclude`, và nhánh `forceHeuristic`.

```ts
import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  ItineraryDay,
  ItineraryInput,
  ItineraryWarning,
  PlaceCategory,
  PlannerKind,
  UnscheduledPlace,
} from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { LangchainService } from '../../langchain/langchain.service.js';
import { PlaceLocationService } from '../places/place-location.service.js';
import {
  buildPlannerRequest,
  defaultStop,
  PLANNER_SYSTEM_PROMPT,
  validatePlan,
} from './ai-planner.js';
import { bad } from './errors.js';
import {
  assignToDays,
  dayCapacity,
  orderNearestFirst,
  pickExtras,
} from './planning/clustering.js';
import { buildDays, vietnamIso, type DayWindow } from './planning/days.js';
import type { Candidate, PlannedStop } from './planning/planning.types.js';
import {
  MAX_TRIP_DAYS,
  PARTY_RULES,
  targetStopsPerDay,
} from './planning/rules.js';
import { scheduleDay } from './planning/scheduler.js';

/** Số điểm dự bị gửi thêm cho AI để nó có thể đổi điểm bổ sung. */
const AI_SPARE_CANDIDATES = 10;

export interface PlanTripOptions {
  /** Địa điểm không được xuất hiện trong kết quả (nơi người dùng đã đi). Không áp cho điểm người dùng tự chọn. */
  excludePlaceIds?: string[];
  /** Không gọi Gemini: bản nháp gợi ý cần nhanh và không tốn lượt (spec 2026-10-19-home-recommendations). */
  forceHeuristic?: boolean;
}

export interface PlanTripResult {
  regionName: string;
  planner: PlannerKind;
  days: ItineraryDay[];
  unscheduled: UnscheduledPlace[];
  warnings: ItineraryWarning[];
  tips: string[];
}

interface PlaceRow {
  id: string;
  name: string;
  category: PlaceCategory;
  source: 'google' | 'web';
  location_source: 'google' | 'ai';
  lat: number;
  lng: number;
  address: string | null;
  description: string | null;
  opening_hours: string | null;
}

/**
 * Lập lịch F6 mà không lưu: chọn ứng viên, gom cụm, AI (hoặc thuật toán) sắp
 * thứ tự, rồi code xếp giờ. `ItinerariesService.create()` lưu kết quả; bản
 * nháp gợi ý ở trang chủ lưu vào kho `itinerary_drafts`.
 */
@Injectable()
export class ItineraryPlanner {
  private readonly logger = new Logger(ItineraryPlanner.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly langchain: LangchainService,
    private readonly locations: PlaceLocationService,
  ) {}

  async planTrip(
    input: ItineraryInput,
    options: PlanTripOptions = {},
  ): Promise<PlanTripResult> {
    const rules = PARTY_RULES[input.travelParty];
    const transport = input.transport ?? rules.defaultTransport;

    const start = Date.parse(input.startsAt);
    const end = Date.parse(input.endsAt);
    if (!(end > start)) {
      throw bad(
        'INVALID_DATES',
        'Thời gian kết thúc phải sau thời gian bắt đầu.',
      );
    }
    if (end - start > MAX_TRIP_DAYS * 24 * 60 * 60 * 1000) {
      throw bad('TRIP_TOO_LONG', `Chuyến đi tối đa ${MAX_TRIP_DAYS} ngày.`);
    }
    const days = buildDays(input.startsAt, input.endsAt, rules);
    if (days.length === 0) {
      throw bad('TRIP_TOO_SHORT', 'Khoảng thời gian quá ngắn để xếp lịch.');
    }

    const regionName = await this.regionName(input.regionId);

    // FR-6.3: mọi địa điểm phải có trong cơ sở dữ liệu.
    // Địa điểm Google người dùng tự chọn: lấy lại tọa độ nếu đã quá 30 ngày; không được thì bỏ và cảnh báo.
    const unlocated = new Set(
      await this.locations.ensure([
        ...input.selectedPlaceIds,
        ...(input.accommodationPlaceId ? [input.accommodationPlaceId] : []),
      ]),
    );
    const selectedIds = input.selectedPlaceIds.filter(
      (pid) => !unlocated.has(pid),
    );
    const selected = await this.loadPlaces(selectedIds, true);
    const missing = selectedIds.filter(
      (id) => !selected.some((c) => c.id === id),
    );
    if (missing.length > 0) {
      throw bad('UNKNOWN_PLACES', 'Có địa điểm không tồn tại trong danh mục.', {
        placeIds: missing,
      });
    }
    let accommodation: Candidate | null = null;
    if (input.accommodationPlaceId) {
      [accommodation] = unlocated.has(input.accommodationPlaceId)
        ? []
        : await this.loadPlaces([input.accommodationPlaceId], false);
      if (!accommodation || accommodation.category !== 'stay') {
        throw bad(
          'INVALID_ACCOMMODATION',
          'Nơi ở phải là một địa điểm lưu trú trong danh mục.',
        );
      }
    }

    const selectedVisits = selected.filter(
      (c) => c.category !== 'food' && c.category !== 'stay',
    );
    const selectedFood = selected.filter((c) => c.category === 'food');
    const unscheduled: UnscheduledPlace[] = selected
      .filter((c) => c.category === 'stay')
      .map((c) => ({
        placeId: c.id,
        name: c.name,
        reason: 'Điểm lưu trú — chọn làm nơi ở thay vì xếp như điểm tham quan',
      }));

    const exclude = new Set(
      [
        ...selected.map((c) => c.id),
        accommodation?.id,
        ...(options.excludePlaceIds ?? []),
      ].filter(Boolean) as string[],
    );
    const foodPool = [
      ...selectedFood,
      ...(await this.poolInArea(input.regionId, ['food'], 200, exclude)),
    ];

    let planner: PlannerKind;
    let plannedDays: PlannedStop[][];
    let tips: string[] = [];

    if (input.planningMode === 'manual') {
      planner = 'manual';
      plannedDays = days.map(() => []);
      unscheduled.push(
        ...selectedVisits.map((c) => ({
          placeId: c.id,
          name: c.name,
          reason: 'Chờ bạn xếp vào lịch',
        })),
      );
    } else {
      const target = targetStopsPerDay(rules, input.pace);
      const capacities = days.map((d) => dayCapacity(d, rules, target));
      const pool = input.allowAiSuggestions
        ? await this.poolInArea(input.regionId, null, 300, exclude)
        : [];
      const extras = pickExtras({
        pool,
        slots: capacities.reduce((a, b) => a + b, 0) - selectedVisits.length,
        rules,
        preferred: input.preferredCategories ?? [],
        accommodation,
        transport,
      });
      if (selectedVisits.length + extras.length === 0) {
        // FR-6.4
        throw new UnprocessableEntityException({
          statusCode: 422,
          code: 'NOT_ENOUGH_PLACES',
          message:
            'Không tìm được địa điểm phù hợp. Hãy chọn thêm địa điểm, bật "AI gợi ý thêm" hoặc bỏ bớt sở thích.',
        });
      }

      const assignment = assignToDays(
        [...selectedVisits, ...extras],
        days,
        capacities,
      );
      const heuristic = () =>
        assignment.map((list, i) =>
          orderNearestFirst(
            list,
            accommodation && !days[i].isFirst ? accommodation : null,
          ).map(defaultStop),
        );

      if (options.forceHeuristic) {
        plannedDays = heuristic();
        planner = 'heuristic';
      } else {
        const spare = input.allowAiSuggestions
          ? pickExtras({
              pool: pool.filter((c) => !extras.includes(c)),
              slots: AI_SPARE_CANDIDATES,
              rules,
              preferred: input.preferredCategories ?? [],
              accommodation,
              transport,
            })
          : [];
        try {
          const plan = await this.langchain.planItinerary(
            PLANNER_SYSTEM_PROMPT,
            buildPlannerRequest({
              input,
              regionName,
              rules,
              days,
              assignment,
              extraPool: spare,
              targetPerDay: target,
            }),
          );
          ({ stops: plannedDays, tips } = validatePlan(
            plan,
            days,
            assignment,
            spare,
          ));
          planner = 'ai';
        } catch (error) {
          // AI lỗi thì vẫn có lịch: gom cụm + đi điểm gần nhất trước.
          this.logger.warn(
            `Gemini không xếp được lịch, dùng thuật toán: ${(error as Error).message}`,
          );
          plannedDays = heuristic();
          planner = 'heuristic';
        }
      }
    }

    const usedFood = new Set<string>();
    const warnings: ItineraryWarning[] = [];
    if (unlocated.size > 0) {
      warnings.push({
        type: 'place_location_unavailable',
        message: `${unlocated.size} địa điểm tạm thời không lấy được vị trí nên chưa được xếp vào lịch.`,
      });
    }
    const outDays: ItineraryDay[] = days.map((day, i) => {
      // Tự sắp xếp: ngày để trống cho người dùng kéo điểm vào, không chèn bữa hay giờ nghỉ.
      const result =
        planner === 'manual'
          ? { items: [], unscheduled: [], warnings: [] }
          : scheduleDay(plannedDays[i], {
              day,
              rules,
              transport,
              accommodation,
              foodPool,
              usedFood,
            });
      warnings.push(
        ...(planner === 'manual' ? manualMealWarnings(day) : result.warnings),
      );
      // "Chưa xếp được" chỉ dành cho điểm người dùng chọn (FR-6.7); điểm AI thêm thì bỏ qua.
      unscheduled.push(
        ...result.unscheduled.filter((u) =>
          selected.some((c) => c.id === u.placeId),
        ),
      );
      return {
        id: `day-${i + 1}`,
        date: day.date,
        startsAt: vietnamIso(day.date, day.start),
        endsAt: vietnamIso(day.date, day.end),
        items: result.items,
      };
    });

    return {
      regionName,
      planner,
      days: outDays,
      unscheduled: dedupeUnscheduled(unscheduled),
      warnings,
      tips,
    };
  }

  async regionName(regionId: string): Promise<string> {
    const [row] = (await this.db.query(
      `SELECT r.name, p.name AS parent FROM regions r LEFT JOIN regions p ON p.id = r.parent_id WHERE r.id = $1`,
      [regionId],
    )) as Array<{ name: string; parent: string | null }>;
    if (!row) throw bad('UNKNOWN_REGION', 'Không tìm thấy vùng này.');
    return row.parent ? `${row.name}, ${row.parent}` : row.name;
  }

  async loadPlaces(ids: string[], mandatory: boolean): Promise<Candidate[]> {
    if (ids.length === 0) return [];
    const rows = (await this.db.query(
      `${PLACE_SELECT} WHERE p.id = ANY($1::uuid[])`,
      [ids],
    )) as PlaceRow[];
    // Địa điểm người dùng chọn không có thứ hạng trong danh sách vùng: điểm 0.
    return rows.map((r) => toCandidate(r, mandatory, 0));
  }

  /**
   * Địa điểm bổ sung / quán ăn: danh sách đã tổng hợp của vùng (spec
   * 2026-10-14-web-places), theo thứ hạng. Điểm suy từ thứ hạng để pickExtras
   * và kMeans vẫn so được: hạng 0 → 100, mỗi hạng sau trừ 2, không âm.
   */
  private async poolInArea(
    regionId: string,
    categories: PlaceCategory[] | null,
    limit: number,
    exclude: Set<string>,
  ): Promise<Candidate[]> {
    const rows = (await this.db.query(
      `${PLACE_SELECT}
         JOIN region_places rp ON rp.place_id = p.id AND rp.region_id = $1
        WHERE ($2::place_category[] IS NULL OR p.category = ANY($2::place_category[]))
          AND p.location IS NOT NULL
          AND NOT (p.id = ANY($4::uuid[]))
        ORDER BY rp.rank
        LIMIT $3`,
      [regionId, categories, limit, [...exclude]],
    )) as PlaceRow[];
    return rows.map((r, i) => toCandidate(r, false, Math.max(0, 100 - i * 2)));
  }
}

const PLACE_SELECT = `
  SELECT p.id, p.name, p.category, p.source, p.location_source, ST_Y(p.location) AS lat, ST_X(p.location) AS lng,
         p.address, p.description, p.tags->>'opening_hours' AS opening_hours
    FROM places p`;
```

Sau `PLACE_SELECT`, **chuyển nguyên** từ `itineraries.service.ts` các hàm `toCandidate`, `manualMealWarnings`, `dedupeUnscheduled` (cắt khỏi file cũ, dán vào đây, không sửa thân hàm).

Lưu ý: trước đây pool được lọc `exclude` **sau** `LIMIT 300` bằng `.filter`; giờ lọc trong SQL nên pool có thể có thêm vài điểm ở cuối danh sách. Điểm suy từ thứ hạng (`100 - i * 2`) tính theo vị trí trong kết quả, giống cách cũ.

- [ ] **Step 5: Sửa `ItinerariesService`**

Trong `itineraries.service.ts`:

1. Constructor: bỏ `LangchainService` và `PlaceLocationService`? **Không** — `update()` vẫn dùng `this.locations.ensure`. Chỉ bỏ `LangchainService`, thêm `private readonly planner: ItineraryPlanner`.
2. Thay thân `create()` bằng:

```ts
  async create(
    ownerId: string,
    dto: CreateItineraryDto,
  ): Promise<ItineraryResponse> {
    const input = normalize(dto);

    // FR-6.8: lịch trình tạo trong nhóm thuộc nhóm đó; viewer không tạo được.
    const groupId = dto.groupId ?? null;
    if (groupId) await this.access.requireGroupRole(ownerId, groupId, 'editor');

    const plan = await this.planner.planTrip(input);

    const saved = await this.db.transaction(async (m) => {
      const it = await m.save(
        this.itineraries.create({
          ownerId,
          regionId: input.regionId,
          groupId,
          planner: plan.planner,
          startsAt: new Date(Date.parse(input.startsAt)),
          endsAt: new Date(Date.parse(input.endsAt)),
          input,
          days: plan.days,
          unscheduled: plan.unscheduled,
          warnings: plan.warnings,
          tips: plan.tips,
        }),
      );
      await this.logToGroup(m, it, ownerId, 'itinerary_added', plan.regionName);
      return it;
    });
    return this.respond(saved, { isCreator: true, groupRole: null });
  }
```

Thứ tự kiểm tra đổi một chút: quyền nhóm được kiểm tra trước ngày giờ. Mã lỗi giữ nguyên. Nếu `itinerary.e2e-spec.ts` có ca gửi đồng thời ngày sai và nhóm không có quyền mà mong đợi `INVALID_DATES`, giữ thứ tự cũ bằng cách gọi `planTrip` trước rồi mới `requireGroupRole`.

3. Trong `update()`: thay `this.loadPlaces(` bằng `this.planner.loadPlaces(` (2 chỗ) và `this.regionName(` bằng `this.planner.regionName(`. Tìm mọi chỗ còn lại: `grep -n "this.regionName\|this.loadPlaces\|this.poolInArea" itineraries.service.ts` phải không còn kết quả.
4. Xóa khỏi file: `AI_SPARE_CANDIDATES`, `PlaceRow`, `poolInArea`, `loadPlaces`, `regionName`, `PLACE_SELECT`, `toCandidate`, `manualMealWarnings`, `dedupeUnscheduled`, `bad`; thêm `import { bad } from './errors.js';` và `import { ItineraryPlanner } from './itinerary-planner.js';`. Bỏ import không còn dùng (`LangchainService`, `ai-planner.js`, `clustering.js`, `scheduleDay`, `buildDays`, `vietnamIso`, `targetStopsPerDay`, `MAX_TRIP_DAYS`, `UnprocessableEntityException`, `Candidate`, `PlannedStop`, `PlannerKind`, `UnscheduledPlace`) — để `pnpm lint` chỉ ra chỗ thừa.

- [ ] **Step 6: Sửa `itineraries.module.ts`**

```ts
import { ItineraryPlanner } from './itinerary-planner.js';
```

```ts
  providers: [ItinerariesService, ShareLinksService, ItineraryPlanner],
  exports: [ItinerariesService, ItineraryPlanner],
```

- [ ] **Step 7: Chạy test mới và test cũ**

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/itinerary-planner.e2e-spec.ts test/itinerary.e2e-spec.ts && npx vitest run src/modules/itineraries`
Expected: PASS tất cả.

- [ ] **Step 8: Typecheck, lint**

Run: `pnpm --filter @rong/backend typecheck && pnpm --filter @rong/backend lint`
Expected: không lỗi.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/itineraries apps/backend/test/itinerary-planner.e2e-spec.ts
git commit -m "refactor(backend): extract planTrip from itinerary creation"
```

---

### Task 3: Sở thích trên server (`PATCH /users/me` nhận `interests`)

**Files:**
- Modify: `packages/shared-types/src/auth.ts` (`UserProfile`)
- Modify: `apps/backend/src/modules/users/dto/update-profile.dto.ts`
- Modify: `apps/backend/src/modules/users/users.service.ts`
- Modify: `apps/backend/src/modules/users/users.controller.ts`
- Test: `apps/backend/test/account.e2e-spec.ts`

**Interfaces:**
- Consumes: `User.interests` (Task 1).
- Produces: `UserProfile.interests: PlaceCategory[]`; `UsersService.updateProfile(userId, patch: { displayName?: string; interests?: PlaceCategory[] }): Promise<{ profile: UserProfile; interestsChanged: boolean }>`. Giai đoạn 2 dùng `interestsChanged` để đẩy job sinh chủ đề.

- [ ] **Step 1: Viết test hỏng**

Thêm vào `account.e2e-spec.ts`, sau ca `'đổi tên hiển thị, bỏ khoảng trắng hai đầu'`:

```ts
  it('lưu sở thích mà không đổi tên, bỏ trùng', async () => {
    const { token } = await newUser();
    const res = await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ interests: ['cafe', 'nature', 'cafe'] })
      .expect(200);
    expect(res.body.displayName).toBe('e2e-account');
    expect(res.body.interests).toEqual(['cafe', 'nature']);

    const me = await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.interests).toEqual(['cafe', 'nature']);
  });

  it('body rỗng → EMPTY_UPDATE; danh mục lạ → 400', async () => {
    const { token } = await newUser();
    const empty = await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
    expect(empty.body.code).toBe('EMPTY_UPDATE');

    await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ interests: ['beach'] })
      .expect(400);
  });

  it('người dùng mới có interests rỗng', async () => {
    const { token } = await newUser();
    const me = await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.interests).toEqual([]);
  });
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/account.e2e-spec.ts`
Expected: FAIL (`interests` undefined, `{}` trả 400 với `VALIDATION`-style message thay vì `EMPTY_UPDATE` hoặc 200).

- [ ] **Step 3: Shared types**

Trong `packages/shared-types/src/auth.ts`, thêm import (nếu file chưa có) `import type { PlaceCategory } from './place';` và trường:

```ts
export interface UserProfile {
  id: string;
  displayName: string | null;
  email: string | null;
  emailVerified: boolean;
  createdAt: string;
  /** Sở thích chọn ở onboarding / Tài khoản; dùng cho gợi ý ở trang chủ. */
  interests: PlaceCategory[];
}
```


Run: `pnpm --filter @rong/backend build:deps`

- [ ] **Step 4: DTO**

```ts
import type { PlaceCategory } from '@rong/shared-types';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

import { PLACE_CATEGORIES } from '../../places/entities/place.entity.js';

export class UpdateProfileDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 50, { message: 'Tên hiển thị từ 1 đến 50 ký tự.' })
  displayName?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PLACE_CATEGORIES.length)
  @IsIn(PLACE_CATEGORIES, { each: true })
  interests?: PlaceCategory[];
}
```

`ArrayMaxSize` chạy trước khi bỏ trùng; `['cafe','nature','cafe']` có 3 phần tử nên vẫn qua.

- [ ] **Step 5: Service**

Trong `users.service.ts`, `toProfile` thêm `interests: user.interests ?? [],`. Thay `updateProfile`:

```ts
  /**
   * Đổi tên hiển thị và/hoặc sở thích. `interestsChanged` để nơi gọi đẩy job
   * sinh lại chủ đề gợi ý (spec 2026-10-19-home-recommendations).
   */
  async updateProfile(
    userId: string,
    patch: { displayName?: string; interests?: PlaceCategory[] },
  ): Promise<{ profile: UserProfile; interestsChanged: boolean }> {
    if (patch.displayName === undefined && patch.interests === undefined) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'EMPTY_UPDATE',
        message: 'Không có gì để cập nhật.',
      });
    }
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new UnauthorizedException();

    const interests =
      patch.interests === undefined ? undefined : [...new Set(patch.interests)];
    const interestsChanged =
      interests !== undefined &&
      (interests.length !== user.interests.length ||
        interests.some((c) => !user.interests.includes(c)));

    await this.users.update(userId, {
      ...(patch.displayName !== undefined && {
        displayName: patch.displayName,
      }),
      ...(interests !== undefined && { interests }),
    });
    return { profile: await this.getProfile(userId), interestsChanged };
  }
```

Thêm `BadRequestException` vào import `@nestjs/common` và `import type { PlaceCategory, UserProfile } from '@rong/shared-types';`.

- [ ] **Step 6: Controller**

```ts
  @Patch('me')
  async update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfile> {
    const { profile } = await this.users.updateProfile(user.userId, dto);
    return profile;
  }
```

Kiểm tra nơi khác gọi `updateProfile`: `grep -rn "updateProfile" apps/backend/src` — chỉ controller.

- [ ] **Step 7: Chạy test**

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/account.e2e-spec.ts test/auth-refresh.e2e-spec.ts`
Expected: PASS (ca đổi tên cũ vẫn qua).

- [ ] **Step 8: Typecheck mobile vẫn qua**

`UserProfile` có thêm trường bắt buộc; mobile chỉ đọc nên không vỡ, nhưng kiểm tra:

Run: `pnpm --filter @rong/mobile typecheck`
Expected: không lỗi. Nếu có chỗ mobile tự dựng `UserProfile` (`grep -rn "UserProfile = {\|: UserProfile = " apps/mobile/src`), thêm `interests: []`.

- [ ] **Step 9: Commit**

```bash
git add packages/shared-types/src/auth.ts apps/backend/src/modules/users apps/backend/test/account.e2e-spec.ts
git commit -m "feat(backend): store user interests on the server"
```

---

### Task 4: Nơi đã đi — suy ra, `GET /visits/pending`, `POST /visits/review`

**Files:**
- Create: `packages/shared-types/src/recommendation.ts`
- Modify: `packages/shared-types/src/index.ts`
- Create: `apps/backend/src/modules/visits/visits.service.ts`
- Create: `apps/backend/src/modules/visits/visits.controller.ts`
- Create: `apps/backend/src/modules/visits/dto/review-visits.dto.ts`
- Create: `apps/backend/src/modules/visits/visits.module.ts`
- Modify: `apps/backend/src/app.module.ts`
- Test: `apps/backend/test/visits.e2e-spec.ts`

**Interfaces:**
- Consumes: bảng `visited_places`, cột `itineraries.visit_reviewed_at` (Task 1); `AccessService.itineraryAccess`, `decide`, `itineraryNotFound` (`modules/groups`).
- Produces:
  ```ts
  // shared-types/recommendation.ts
  export interface PendingVisitPlace { placeId: string; name: string; category: PlaceCategory }
  export interface PendingVisitReview { itineraryId: string; regionName: string; endsAt: string; places: PendingVisitPlace[] }
  export interface ReviewVisitsRequest { itineraryId: string; visitedPlaceIds: string[] }
  // VisitsService (exported từ VisitsModule)
  inferVisits(userId: string): Promise<void>;
  visitedPlaceIds(userId: string): Promise<string[]>;      // inferred + confirmed
  pending(userId: string): Promise<PendingVisitReview[]>;
  review(userId: string, itineraryId: string, visitedPlaceIds: string[]): Promise<void>;
  ```

- [ ] **Step 1: Shared types**

`packages/shared-types/src/recommendation.ts`:

```ts
import type { PlaceCategory } from './place';

/** Một địa điểm trong lịch trình đã kết thúc, chờ người dùng xác nhận đã đến chưa. */
export interface PendingVisitPlace {
  placeId: string;
  name: string;
  category: PlaceCategory;
}

/** Lịch trình đã kết thúc mà chưa hỏi "Bạn đã đến những nơi nào?". */
export interface PendingVisitReview {
  itineraryId: string;
  regionName: string;
  endsAt: string;
  places: PendingVisitPlace[];
}

export interface ReviewVisitsRequest {
  itineraryId: string;
  /** Địa điểm đã đến; các địa điểm còn lại của lịch trình coi như không đến. */
  visitedPlaceIds: string[];
}
```

Trong `index.ts` thêm `export * from './recommendation';` (các file trong `shared-types/src` import không có đuôi).

Run: `pnpm --filter @rong/backend build:deps`

- [ ] **Step 2: Viết test hỏng**

`apps/backend/test/visits.e2e-spec.ts`:

```ts
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
```


- [ ] **Step 3: Chạy để thấy hỏng**

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/visits.e2e-spec.ts`
Expected: FAIL, không resolve được `visits.service.js`.

- [ ] **Step 4: DTO**

`dto/review-visits.dto.ts`:

```ts
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

export class ReviewVisitsDto {
  @IsUUID()
  itineraryId!: string;

  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  visitedPlaceIds!: string[];
}
```

- [ ] **Step 5: Service**

`visits.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  ItineraryDay,
  PendingVisitPlace,
  PendingVisitReview,
  PlaceCategory,
} from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { decide } from '../groups/access.js';
import { AccessService } from '../groups/access.service.js';
import { itineraryNotFound } from '../groups/errors.js';

/** Chỉ hỏi lại các chuyến kết thúc trong chừng này ngày. */
const PENDING_WINDOW_DAYS = 60;
const PENDING_LIMIT = 5;

/** Lịch trình tôi tạo hoặc thuộc nhóm tôi tham gia; `$1` là user id. */
const MY_ITINERARY = `(i.owner_id = $1 OR EXISTS (
  SELECT 1 FROM group_members m WHERE m.group_id = i.group_id AND m.user_id = $1))`;

/**
 * Nơi người dùng đã đi (spec 2026-10-19-home-recommendations): suy ra từ lịch
 * trình đã kết thúc, người dùng sửa lại sau chuyến đi. Bộ gợi ý bỏ những nơi này.
 */
@Injectable()
export class VisitsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly access: AccessService,
  ) {}

  /** Thêm `inferred` cho mọi địa điểm của lịch trình đã kết thúc; dòng đã có (kể cả `rejected`) giữ nguyên. */
  async inferVisits(userId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO visited_places (user_id, place_id, region_id, status, itinerary_id, visited_at)
       SELECT DISTINCT ON (x.place_id) $1::uuid, x.place_id, i.region_id, 'inferred', i.id, i.ends_at
         FROM itineraries i
         CROSS JOIN LATERAL (
           SELECT (item->>'placeId')::uuid AS place_id
             FROM jsonb_array_elements(i.days) d,
                  jsonb_array_elements(d->'items') item
            WHERE item->>'placeId' IS NOT NULL
         ) x
         JOIN places p ON p.id = x.place_id
        WHERE i.ends_at < now() AND ${MY_ITINERARY}
        ORDER BY x.place_id, i.ends_at DESC
       ON CONFLICT (user_id, place_id) DO NOTHING`,
      [userId],
    );
  }

  async visitedPlaceIds(userId: string): Promise<string[]> {
    const rows = (await this.db.query(
      `SELECT place_id FROM visited_places
        WHERE user_id = $1 AND status IN ('inferred', 'confirmed')`,
      [userId],
    )) as Array<{ place_id: string }>;
    return rows.map((r) => r.place_id);
  }

  async pending(userId: string): Promise<PendingVisitReview[]> {
    const rows = (await this.db.query(
      `SELECT i.id, i.ends_at, r.name AS region_name, i.days
         FROM itineraries i
         JOIN regions r ON r.id = i.region_id
        WHERE i.ends_at < now()
          AND i.ends_at > now() - $2::int * interval '1 day'
          AND i.visit_reviewed_at IS NULL
          AND ${MY_ITINERARY}
        ORDER BY i.ends_at DESC
        LIMIT $3`,
      [userId, PENDING_WINDOW_DAYS, PENDING_LIMIT],
    )) as Array<{
      id: string;
      ends_at: Date;
      region_name: string;
      days: ItineraryDay[];
    }>;
    return rows
      .map((r) => ({
        itineraryId: r.id,
        regionName: r.region_name,
        endsAt: r.ends_at.toISOString(),
        places: placesOf(r.days),
      }))
      .filter((r) => r.places.length > 0);
  }

  async review(
    userId: string,
    itineraryId: string,
    visitedPlaceIds: string[],
  ): Promise<void> {
    const access = await this.access.itineraryAccess(userId, itineraryId);
    if (!access || decide(access, 'view') !== 'allow') {
      throw itineraryNotFound();
    }
    const [row] = (await this.db.query(
      `SELECT region_id, days FROM itineraries WHERE id = $1`,
      [itineraryId],
    )) as Array<{ region_id: string; days: ItineraryDay[] }>;
    if (!row) throw itineraryNotFound();

    const all = placesOf(row.days).map((p) => p.placeId);
    const visited = new Set(visitedPlaceIds);
    if ([...visited].some((id) => !all.includes(id))) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_PLACES',
        message: 'Có địa điểm không thuộc lịch trình này.',
      });
    }

    await this.db.transaction(async (m) => {
      if (all.length > 0) {
        await m.query(
          `INSERT INTO visited_places (user_id, place_id, region_id, status, itinerary_id, visited_at)
           SELECT $1::uuid, p.id, $2::uuid,
                  CASE WHEN p.id = ANY($4::uuid[]) THEN 'confirmed' ELSE 'rejected' END,
                  $5::uuid, now()
             FROM places p
            WHERE p.id = ANY($3::uuid[])
           ON CONFLICT (user_id, place_id) DO UPDATE
             SET status = EXCLUDED.status,
                 itinerary_id = EXCLUDED.itinerary_id,
                 visited_at = EXCLUDED.visited_at`,
          [userId, row.region_id, all, [...visited], itineraryId],
        );
      }
      await m.query(
        `UPDATE itineraries SET visit_reviewed_at = now() WHERE id = $1`,
        [itineraryId],
      );
    });
  }
}

/** Địa điểm (tham quan, bữa ăn) trong lịch trình, không trùng, theo thứ tự xuất hiện. */
function placesOf(days: ItineraryDay[]): PendingVisitPlace[] {
  const seen = new Map<string, PendingVisitPlace>();
  for (const item of days.flatMap((d) => d.items)) {
    if (!item.placeId || !item.place || seen.has(item.placeId)) continue;
    seen.set(item.placeId, {
      placeId: item.placeId,
      name: item.place.name,
      category: item.place.category as PlaceCategory,
    });
  }
  return [...seen.values()];
}
```

Kiểm tra `decide(access, 'view')` trả đúng kiểu `AccessDecision` (`'allow' | 'forbidden' | 'not_found'`) bằng cách đọc `groups/access.ts:27`.

- [ ] **Step 6: Controller và module**

`visits.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { PendingVisitReview } from '@rong/shared-types';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ReviewVisitsDto } from './dto/review-visits.dto.js';
import { VisitsService } from './visits.service.js';

@Controller('visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Get('pending')
  pending(@CurrentUser() user: AuthUser): Promise<PendingVisitReview[]> {
    return this.visits.pending(user.userId);
  }

  @Post('review')
  @HttpCode(HttpStatus.NO_CONTENT)
  review(
    @CurrentUser() user: AuthUser,
    @Body() dto: ReviewVisitsDto,
  ): Promise<void> {
    return this.visits.review(user.userId, dto.itineraryId, dto.visitedPlaceIds);
  }
}
```

`visits.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { GroupsModule } from '../groups/groups.module.js';
import { VisitsController } from './visits.controller.js';
import { VisitsService } from './visits.service.js';

@Module({
  imports: [GroupsModule],
  controllers: [VisitsController],
  providers: [VisitsService],
  exports: [VisitsService],
})
export class VisitsModule {}
```

Trong `app.module.ts`, import `VisitsModule` và thêm vào `imports` sau `GroupsModule`.

- [ ] **Step 7: Chạy test**

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/visits.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck, lint**

Run: `pnpm --filter @rong/backend typecheck && pnpm --filter @rong/backend lint`
Expected: không lỗi.

- [ ] **Step 9: Cập nhật module map và commit**

Trong `apps/backend/src/modules/README.md`, thêm một mục ngắn cho `visits/`: "Nơi người dùng đã đi: suy ra từ lịch trình đã kết thúc (`inferred`), người dùng xác nhận lại sau chuyến đi (`confirmed`/`rejected`). Bộ gợi ý trang chủ bỏ các nơi `inferred` + `confirmed`." Theo đúng định dạng các mục khác trong file.

```bash
git add packages/shared-types/src apps/backend/src/modules/visits apps/backend/src/app.module.ts apps/backend/src/modules/README.md apps/backend/test/visits.e2e-spec.ts
git commit -m "feat(backend): infer and review visited places"
```
