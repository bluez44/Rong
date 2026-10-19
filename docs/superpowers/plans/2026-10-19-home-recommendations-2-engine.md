# Gợi ý lịch trình trang chủ — Giai đoạn 2: Bộ gợi ý backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend tạo, cache và phục vụ 3 bản nháp lịch trình cá nhân hóa cho mỗi (người dùng, khung giờ 6:00/15:00, chủ đề), qua hàng đợi BullMQ, cùng các job nền sinh chủ đề riêng, tìm ảnh vùng, nâng cấp bản nháp bằng Gemini và dọn dẹp.

**Architecture:** Module `modules/recommendations`. Logic chọn vùng, khóa kho, khung giờ, ngày tháng là hàm thuần có unit test. `DraftPool` tìm hoặc tạo bản nháp trong `itinerary_drafts` bằng `ItineraryPlanner.planTrip()` (giai đoạn 1). `RecommendationBuilder` ghi 3 dòng `user_recommendations`. `RecommendationsQueue` (module global) đẩy job vào BullMQ (`@nestjs/bullmq`) khi bật, hoặc chạy job ngay trong process khi tắt (e2e, máy không có Redis). Hai queue: `recommendations` (job thường, `concurrency: 4`) và `recommendations-ai` (job gọi Gemini, limiter 10/phút).

**Tech Stack:** NestJS 12, `@nestjs/bullmq` + `bullmq` (Redis 7 local qua `pnpm infra:up`), `@nestjs/config` `ConditionalModule`, LangChain + Gemini (`chat-models/`), zod, vitest + supertest.

**Spec:** `docs/superpowers/specs/2026-10-19-home-recommendations-design.md`

Yêu cầu giai đoạn 1 đã xong: `docs/superpowers/plans/2026-10-19-home-recommendations-1-foundation.md` (migration có `user_recommendations.params` và `itinerary_drafts.exclude_place_ids`, `ItineraryPlanner`, `VisitsService`, `UsersService.updateProfile` trả `interestsChanged`).

## Global Constraints

- Nhánh `feat/home-recommendations`. Backend ESM: import tương đối kết thúc `.js`. Comment, log, message lỗi tiếng Việt; lỗi `{ statusCode, code, message }`.
- `shared-types/src` import nội bộ **không có đuôi** (`from './place'`). Sau khi sửa shared-types: `pnpm --filter @rong/backend build:deps`.
- Raw `SELECT` cột `place_category[]` phải ép `::text[]`; khi ghi, ép `$n::place_category[]`. Tham số không rõ kiểu phải ép (`$2::uuid[]`, `$3::int`).
- Múi giờ cố định `Asia/Ho_Chi_Minh` (UTC+7, không có giờ mùa hè). Mốc làm mới: **6:00 và 15:00**.
- Hệ số chấm điểm: vùng có nơi đã đi **× 0,3**; vùng có trong 9 gợi ý gần nhất (trước khung giờ hiện tại) **× 0,5**; mỗi địa điểm "Muốn đi" chưa đi **+3**; loại vùng có `newPlaces < targetStopsPerDay × daysCount`.
- Thông số mặc định người mới: `couple`, 2 người lớn, 0 trẻ em, `moderate`, `moderate`, 2 ngày (8:00 thứ Bảy → 18:00 Chủ nhật).
- Ngày gốc của mọi bản nháp: thứ Bảy `2026-01-03`.
- Bản nháp không trừ lượt AI (`users.ai_generations_used` không đổi); lịch trình lưu từ bản nháp có `ai_edits_remaining = 3`.
- Chỉ job `warm-featured-regions` được gọi `WebPlacesService.listForRegion()`. Bộ gợi ý chỉ dùng vùng có `region_place_lists.status = 'ready'`.
- Ngưỡng nâng cấp Gemini: `view_count ≥ 5` hoặc `save_count ≥ 2`, chỉ bản `planner = 'heuristic'` chưa `upgraded_at`.
- Hàng đợi: bật khi `NODE_ENV !== 'test'` **và** `RECOMMENDATIONS_ENABLED !== 'false'`. Tắt thì job chạy ngay trong process, không có lịch cron. e2e luôn ở chế độ tắt (vitest đặt `NODE_ENV=test`), không cần Redis.
- e2e chạy trên DB dev Neon. Không chạy migration mới trong giai đoạn này.
- Chủ đề riêng: tối đa 3 mỗi người, `label` ≤ 40 ký tự, hết hạn sau 7 ngày, `regionIds` chỉ gồm vùng đã gửi cho Gemini.

## Review Focus

1. Hai request `GET /recommendations` cùng lúc khi chưa có bộ → chỉ một job `build-user-set` (job id cố định), cả hai nhận `building`. Test: Task 3 `enqueue trùng jobId chỉ chạy một lần`.
2. Job `build-user-set` chạy xong mà không đủ vùng nào → feed trả `ready` với `items: []`, không kẹt `building` mãi. Test: Task 5 `không đủ vùng → ready rỗng`.
3. Người dùng xóa lịch trình đã lưu từ gợi ý → thẻ không còn "Đã lưu", `save` lần sau tạo lịch trình mới thay vì trả 200 với id đã mất. Test: Task 5 `lịch trình đã lưu bị xóa`.
4. Gemini trả chủ đề có `regionIds` bịa, danh mục `beach`, nhãn 200 ký tự → chỉ giữ phần hợp lệ, không ghi chủ đề rỗng. Test: Task 2 `sanitizeThemes`, Task 6 e2e.
5. Xem trước với 8 ngày, ngày kết thúc trước ngày bắt đầu, hoặc ngày đã qua → 400 `TRIP_TOO_LONG` / `VALIDATION_ERROR`, không tạo bản nháp. Test: Task 5 `preview sai thông số`.

---

### Task 1: Kiểu dùng chung và hàm thuần về thời gian, khóa kho, thông số chuyến đi

**Files:**
- Modify: `packages/shared-types/src/recommendation.ts`
- Create: `apps/backend/src/modules/recommendations/window.ts`
- Create: `apps/backend/src/modules/recommendations/draft-dates.ts`
- Create: `apps/backend/src/modules/recommendations/pool-key.ts`
- Create: `apps/backend/src/modules/recommendations/trip-params.ts`
- Test: `apps/backend/src/modules/recommendations/time-and-params.spec.ts`

**Interfaces:**
- Produces (shared-types):
  ```ts
  export interface TripParams { travelParty: TravelParty; adults: number; children: number; pace: Pace; budgetTier: BudgetTier; daysCount: number }
  export type RecommendationThemeKind = 'default' | 'fixed' | 'personal';
  export interface RecommendationTheme { key: string; label: string; icon: string; regionHint: string | null; kind: RecommendationThemeKind }
  export interface RegionImage { url: string; source: 'unsplash' | 'web'; author: string | null; authorUrl: string | null; sourceUrl: string | null }
  export interface RecommendationCard { id; regionId; regionName; title; dayCount; nightCount; startsAt; endsAt; placeCount; highlights: string[]; reason: string; revisit: boolean; image: RegionImage | null; estimatedCost: null; weather: null; savedItineraryId: string | null }
  export interface RecommendationFeed { status: 'ready' | 'building'; windowStart: string; nextRefreshAt: string; theme: string; themes: RecommendationTheme[]; items: RecommendationCard[] }
  export interface ItineraryDraft { recommendationId; draftId; regionId; regionName; params: TripParams; input: ItineraryInput; days: ItineraryDay[]; unscheduled: UnscheduledPlace[]; warnings: ItineraryWarning[]; tips: string[]; planner: 'heuristic' | 'ai'; savedItineraryId: string | null }
  export interface PreviewDraftRequest extends TripParams { startDate: string }
  export interface SaveDraftRequest { draftId: string; groupId?: string | null }
  ```
- Produces (backend):
  ```ts
  // window.ts
  export function windowFor(now: Date): { windowStart: Date; nextRefreshAt: Date };
  // draft-dates.ts
  export const DRAFT_ANCHOR_DATE = '2026-01-03';
  export function addDays(date: string, n: number): string;
  export function daysBetween(from: string, to: string): number;
  export function nextSaturday(now: Date): string;
  export function tripBounds(date: string, daysCount: number): { startsAt: string; endsAt: string };
  export function shiftPlan<T extends { input: ItineraryInput; days: ItineraryDay[] }>(plan: T, toDate: string): T;
  export function vietnamDate(at: Date): string; // "YYYY-MM-DD" giờ Việt Nam
  // pool-key.ts
  export function poolKey(k: { regionId: string; categories: PlaceCategory[]; trip: TripParams; listVersion: Date }): string;
  // trip-params.ts
  export const DEFAULT_TRIP_PARAMS: TripParams;
  export function learnTripParams(inputs: ItineraryInput[]): TripParams; // inputs mới nhất trước
  export function draftInput(regionId: string, categories: PlaceCategory[], trip: TripParams): ItineraryInput;
  ```

Ghi chú lệch spec (có chủ ý): `PreviewDraftRequest` dùng `startDate` (ngày) + `daysCount` thay cho `startsAt`/`endsAt` (ngày giờ), vì bản nháp luôn xếp 8:00 → 18:00; chọn giờ sẽ không có tác dụng. `SaveDraftRequest` không có `startsAt`: ngày đi lấy từ `user_recommendations.starts_at` (đã cập nhật khi xem trước). `ItineraryDraft` có thêm `params`.

- [ ] **Step 1: Thêm kiểu vào `packages/shared-types/src/recommendation.ts`**

Nối vào cuối file (giữ phần `PendingVisit*` của giai đoạn 1), thêm import ở đầu file:

```ts
import type {
  BudgetTier,
  ItineraryDay,
  ItineraryInput,
  ItineraryWarning,
  Pace,
  TravelParty,
  UnscheduledPlace,
} from './itinerary';
```

```ts
/** Thông số chuyến đi của một gợi ý: học từ lịch trình cũ, người dùng sửa được khi xem trước. */
export interface TripParams {
  travelParty: TravelParty;
  adults: number;
  children: number;
  pace: Pace;
  budgetTier: BudgetTier;
  /** 1–7 ngày. */
  daysCount: number;
}

export type RecommendationThemeKind = 'default' | 'fixed' | 'personal';

/** Một chip chủ đề trên trang chủ. */
export interface RecommendationTheme {
  /** `default` · `fixed:<key>` · `user:<uuid>` */
  key: string;
  label: string;
  /** Tên icon của app mobile (`IconName`). */
  icon: string;
  /** Tên các vùng của chủ đề riêng, ví dụ "Bến Tre, Vĩnh Long". */
  regionHint: string | null;
  kind: RecommendationThemeKind;
}

/** Ảnh vùng, luôn hiện kèm ghi công. */
export interface RegionImage {
  url: string;
  source: 'unsplash' | 'web';
  author: string | null;
  authorUrl: string | null;
  /** Bài viết chứa ảnh (nguồn `web`). */
  sourceUrl: string | null;
}

export interface RecommendationCard {
  id: string;
  regionId: string;
  regionName: string;
  title: string;
  dayCount: number;
  nightCount: number;
  startsAt: string;
  endsAt: string;
  placeCount: number;
  highlights: string[];
  reason: string;
  /** Vùng người dùng đã từng đến. */
  revisit: boolean;
  image: RegionImage | null;
  /** Chưa có (F7): luôn null, app hiện "Đang cập nhật". */
  estimatedCost: null;
  /** Chưa có nguồn: luôn null. */
  weather: null;
  savedItineraryId: string | null;
}

export interface RecommendationFeed {
  /** `building`: đang tạo bộ gợi ý, hỏi lại sau vài giây. */
  status: 'ready' | 'building';
  windowStart: string;
  nextRefreshAt: string;
  theme: string;
  themes: RecommendationTheme[];
  items: RecommendationCard[];
}

/** Bản nháp lịch trình của một gợi ý, ngày đã dời sang ngày đi đề xuất. */
export interface ItineraryDraft {
  recommendationId: string;
  draftId: string;
  regionId: string;
  regionName: string;
  params: TripParams;
  input: ItineraryInput;
  days: ItineraryDay[];
  unscheduled: UnscheduledPlace[];
  warnings: ItineraryWarning[];
  tips: string[];
  planner: 'heuristic' | 'ai';
  savedItineraryId: string | null;
}

export interface PreviewDraftRequest extends TripParams {
  /** Ngày đi "YYYY-MM-DD" theo giờ Việt Nam. */
  startDate: string;
}

export interface SaveDraftRequest {
  draftId: string;
  groupId?: string | null;
}
```

Run: `pnpm --filter @rong/backend build:deps`
Expected: build thành công.

- [ ] **Step 2: Viết test hỏng**

`apps/backend/src/modules/recommendations/time-and-params.spec.ts`:

```ts
import type { ItineraryDay, ItineraryInput } from '@rong/shared-types';
import { describe, expect, it } from 'vitest';

import {
  addDays,
  DRAFT_ANCHOR_DATE,
  nextSaturday,
  shiftPlan,
  tripBounds,
  vietnamDate,
} from './draft-dates.js';
import { poolKey } from './pool-key.js';
import { DEFAULT_TRIP_PARAMS, draftInput, learnTripParams } from './trip-params.js';
import { windowFor } from './window.js';

/** Giờ Việt Nam → Date. */
const vn = (local: string) => new Date(`${local}+07:00`);

describe('windowFor', () => {
  it.each([
    ['2026-10-19T05:59:59', '2026-10-18T15:00:00', '2026-10-19T06:00:00'],
    ['2026-10-19T06:00:00', '2026-10-19T06:00:00', '2026-10-19T15:00:00'],
    ['2026-10-19T14:59:59', '2026-10-19T06:00:00', '2026-10-19T15:00:00'],
    ['2026-10-19T15:00:00', '2026-10-19T15:00:00', '2026-10-20T06:00:00'],
    ['2026-10-19T23:59:59', '2026-10-19T15:00:00', '2026-10-20T06:00:00'],
    ['2026-10-20T00:00:00', '2026-10-19T15:00:00', '2026-10-20T06:00:00'],
    ['2026-12-31T16:00:00', '2026-12-31T15:00:00', '2027-01-01T06:00:00'],
  ])('%s → %s, làm mới %s', (now, start, next) => {
    const w = windowFor(vn(now));
    expect(w.windowStart.toISOString()).toBe(vn(start).toISOString());
    expect(w.nextRefreshAt.toISOString()).toBe(vn(next).toISOString());
  });
});

describe('ngày của bản nháp', () => {
  it('ngày gốc là thứ Bảy', () => {
    expect(new Date(`${DRAFT_ANCHOR_DATE}T00:00:00Z`).getUTCDay()).toBe(6);
  });

  it.each([
    ['2026-10-19T10:00:00', '2026-10-24'], // thứ Hai
    ['2026-10-23T23:30:00', '2026-10-24'], // thứ Sáu
    ['2026-10-24T09:00:00', '2026-10-31'], // thứ Bảy → tuần sau
    ['2026-10-25T09:00:00', '2026-10-31'], // Chủ nhật → tuần sau
    ['2026-10-24T00:30:00', '2026-10-31'], // 0:30 thứ Bảy giờ VN (UTC vẫn là thứ Sáu)
  ])('nextSaturday(%s) = %s', (now, expected) => {
    expect(nextSaturday(vn(now))).toBe(expected);
  });

  it('vietnamDate: 0:30 giờ Việt Nam vẫn là ngày hôm đó', () => {
    expect(vietnamDate(new Date('2026-10-23T17:30:00Z'))).toBe('2026-10-24');
  });

  it('tripBounds: 8:00 ngày đầu → 18:00 ngày cuối', () => {
    expect(tripBounds('2026-01-03', 2)).toEqual({
      startsAt: '2026-01-03T08:00:00+07:00',
      endsAt: '2026-01-04T18:00:00+07:00',
    });
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('shiftPlan dời mọi ngày và giờ, giữ nguyên giờ trong ngày', () => {
    const day: ItineraryDay = {
      id: 'day-1',
      date: '2026-01-03',
      startsAt: '2026-01-03T08:00:00+07:00',
      endsAt: '2026-01-03T18:00:00+07:00',
      items: [
        {
          id: 'a',
          kind: 'visit',
          placeId: 'p',
          place: null,
          dayPart: 'morning',
          order: 0,
          startsAt: '2026-01-03T08:30:00+07:00',
          endsAt: '2026-01-03T09:45:00+07:00',
          isAiSuggested: false,
        },
      ],
    };
    const input = draftInput('r', [], DEFAULT_TRIP_PARAMS);
    const shifted = shiftPlan({ input, days: [day] }, '2026-10-24');
    expect(shifted.input.startsAt).toBe('2026-10-24T08:00:00+07:00');
    expect(shifted.input.endsAt).toBe('2026-10-25T18:00:00+07:00');
    expect(shifted.days[0].date).toBe('2026-10-24');
    expect(shifted.days[0].items[0].startsAt).toBe('2026-10-24T08:30:00+07:00');
    expect(shifted.days[0].items[0].endsAt).toBe('2026-10-24T09:45:00+07:00');
    // Không sửa bản gốc.
    expect(day.date).toBe('2026-01-03');
  });
});

describe('poolKey', () => {
  const base = {
    regionId: 'r1',
    categories: ['cafe', 'nature'] as const,
    trip: DEFAULT_TRIP_PARAMS,
    listVersion: new Date('2026-10-01T00:00:00Z'),
  };

  it('không phụ thuộc thứ tự và trùng lặp danh mục', () => {
    expect(poolKey({ ...base, categories: ['cafe', 'nature'] })).toBe(
      poolKey({ ...base, categories: ['nature', 'cafe', 'cafe'] }),
    );
  });

  it('đổi list_version, số ngày hoặc đối tượng → khóa khác', () => {
    const k = poolKey({ ...base, categories: [...base.categories] });
    expect(
      poolKey({ ...base, categories: [...base.categories], listVersion: new Date('2026-10-02T00:00:00Z') }),
    ).not.toBe(k);
    expect(
      poolKey({ ...base, categories: [...base.categories], trip: { ...base.trip, daysCount: 3 } }),
    ).not.toBe(k);
    expect(
      poolKey({ ...base, categories: [...base.categories], trip: { ...base.trip, travelParty: 'friends' } }),
    ).not.toBe(k);
  });

  it('số người lớn, trẻ em không nằm trong khóa', () => {
    const k = poolKey({ ...base, categories: [...base.categories] });
    expect(
      poolKey({ ...base, categories: [...base.categories], trip: { ...base.trip, adults: 5, children: 2 } }),
    ).toBe(k);
  });
});

describe('learnTripParams', () => {
  const input = (over: Partial<ItineraryInput>): ItineraryInput => ({
    ...draftInput('r', [], DEFAULT_TRIP_PARAMS),
    ...over,
  });

  it('người mới → mặc định', () => {
    expect(learnTripParams([])).toEqual({
      travelParty: 'couple',
      adults: 2,
      children: 0,
      pace: 'moderate',
      budgetTier: 'moderate',
      daysCount: 2,
    });
  });

  it('lấy giá trị hay gặp nhất, hòa thì lấy lịch trình mới hơn; số ngày lấy trung vị', () => {
    const learned = learnTripParams([
      input({ travelParty: 'friends', adults: 4, startsAt: '2026-09-01T08:00:00+07:00', endsAt: '2026-09-03T18:00:00+07:00' }),
      input({ travelParty: 'family_with_kids', adults: 2, children: 2, pace: 'relaxed', startsAt: '2026-08-01T08:00:00+07:00', endsAt: '2026-08-01T18:00:00+07:00' }),
      input({ travelParty: 'friends', adults: 4, startsAt: '2026-07-01T08:00:00+07:00', endsAt: '2026-07-04T18:00:00+07:00' }),
    ]);
    expect(learned.travelParty).toBe('friends');
    expect(learned.adults).toBe(4);
    expect(learned.children).toBe(0);
    expect(learned.daysCount).toBe(3); // 3, 1, 4 → trung vị 3
  });

  it('số ngày giới hạn 1–7', () => {
    expect(
      learnTripParams([input({ startsAt: '2026-09-01T08:00:00+07:00', endsAt: '2026-09-20T18:00:00+07:00' })]).daysCount,
    ).toBe(7);
  });
});

describe('draftInput', () => {
  it('xếp từ ngày gốc, không có điểm chọn sẵn, ưu tiên danh mục', () => {
    const input = draftInput('r1', ['cafe'], { ...DEFAULT_TRIP_PARAMS, daysCount: 3 });
    expect(input).toMatchObject({
      regionId: 'r1',
      planningMode: 'ai',
      startsAt: '2026-01-03T08:00:00+07:00',
      endsAt: '2026-01-05T18:00:00+07:00',
      selectedPlaceIds: [],
      allowAiSuggestions: true,
      preferredCategories: ['cafe'],
    });
  });
});
```

- [ ] **Step 3: Chạy để thấy hỏng**

Run: `cd apps/backend && npx vitest run src/modules/recommendations/time-and-params.spec.ts`
Expected: FAIL, không resolve được các module.

- [ ] **Step 4: Viết `window.ts`**

```ts
/** Việt Nam cố định UTC+7, không có giờ mùa hè. */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Khung giờ của bộ gợi ý: làm mới lúc 6:00 và 15:00 giờ Việt Nam
 * (spec 2026-10-19-home-recommendations).
 */
export function windowFor(now: Date): {
  windowStart: Date;
  nextRefreshAt: Date;
} {
  // Các trường UTC của `local` là giờ Việt Nam.
  const local = new Date(now.getTime() + VN_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  const hour = local.getUTCHours();
  const at = (dayOffset: number, h: number) =>
    new Date(Date.UTC(y, m, d + dayOffset, h) - VN_OFFSET_MS);

  if (hour < 6) return { windowStart: at(-1, 15), nextRefreshAt: at(0, 6) };
  if (hour < 15) return { windowStart: at(0, 6), nextRefreshAt: at(0, 15) };
  return { windowStart: at(0, 15), nextRefreshAt: at(1, 6) };
}
```

- [ ] **Step 5: Viết `draft-dates.ts`**

```ts
import type { ItineraryDay, ItineraryInput } from '@rong/shared-types';

import { toVietnamLocal, vietnamIso } from '../itineraries/planning/days.js';

/**
 * Mọi bản nháp trong kho xếp từ ngày này rồi dời sang ngày đi thật. Thứ Bảy,
 * để giờ mở cửa theo thứ trong tuần vẫn đúng khi dời sang một thứ Bảy khác.
 */
export const DRAFT_ANCHOR_DATE = '2026-01-03';

const DAY_MS = 24 * 60 * 60 * 1000;
const START_MINUTE = 8 * 60;
const END_MINUTE = 18 * 60;

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );
}

/** Ngày "YYYY-MM-DD" theo giờ Việt Nam của một mốc thời gian. */
export function vietnamDate(at: Date): string {
  return toVietnamLocal(at.toISOString()).date;
}

/** Thứ Bảy kế tiếp theo giờ Việt Nam; hôm nay là thứ Bảy hoặc Chủ nhật thì lấy thứ Bảy tuần sau. */
export function nextSaturday(now: Date): string {
  const today = vietnamDate(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Chủ nhật … 6 = thứ Bảy
  const ahead = weekday === 6 ? 7 : weekday === 0 ? 6 : 6 - weekday;
  return addDays(today, ahead);
}

/** Chuyến `daysCount` ngày bắt đầu `date`: 8:00 ngày đầu → 18:00 ngày cuối. */
export function tripBounds(
  date: string,
  daysCount: number,
): { startsAt: string; endsAt: string } {
  return {
    startsAt: vietnamIso(date, START_MINUTE),
    endsAt: vietnamIso(addDays(date, daysCount - 1), END_MINUTE),
  };
}

function shiftIso(iso: string, days: number): string {
  const { date, minute } = toVietnamLocal(iso);
  return vietnamIso(addDays(date, days), minute);
}

/** Dời toàn bộ ngày giờ của một bản nháp sang ngày đi `toDate`, giữ giờ trong ngày. Không sửa bản gốc. */
export function shiftPlan<
  T extends { input: ItineraryInput; days: ItineraryDay[] },
>(plan: T, toDate: string): T {
  const n = daysBetween(toVietnamLocal(plan.input.startsAt).date, toDate);
  if (n === 0) return plan;
  return {
    ...plan,
    input: {
      ...plan.input,
      startsAt: shiftIso(plan.input.startsAt, n),
      endsAt: shiftIso(plan.input.endsAt, n),
    },
    days: plan.days.map((day) => ({
      ...day,
      date: addDays(day.date, n),
      startsAt: shiftIso(day.startsAt, n),
      endsAt: shiftIso(day.endsAt, n),
      items: day.items.map((item) => ({
        ...item,
        startsAt: shiftIso(item.startsAt, n),
        endsAt: shiftIso(item.endsAt, n),
      })),
    })),
  };
}
```

- [ ] **Step 6: Viết `pool-key.ts`**

```ts
import { createHash } from 'node:crypto';

import type { PlaceCategory, TripParams } from '@rong/shared-types';

/**
 * Khóa tra kho bản nháp dùng chung. Không có số người: bản nháp giống nhau cho
 * 2 hay 5 người lớn; số người nằm ở `user_recommendations.params`.
 */
export function poolKey(k: {
  regionId: string;
  categories: PlaceCategory[];
  trip: TripParams;
  listVersion: Date;
}): string {
  const parts = [
    k.regionId,
    [...new Set(k.categories)].sort().join(','),
    k.trip.daysCount,
    k.trip.travelParty,
    k.trip.pace,
    k.trip.budgetTier,
    k.listVersion.toISOString(),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}
```

- [ ] **Step 7: Viết `trip-params.ts`**

```ts
import type {
  ItineraryInput,
  PlaceCategory,
  TripParams,
} from '@rong/shared-types';

import { toVietnamLocal } from '../itineraries/planning/days.js';
import { MAX_TRIP_DAYS } from '../itineraries/planning/rules.js';
import { daysBetween, DRAFT_ANCHOR_DATE, tripBounds } from './draft-dates.js';

export const DEFAULT_TRIP_PARAMS: TripParams = {
  travelParty: 'couple',
  adults: 2,
  children: 0,
  pace: 'moderate',
  budgetTier: 'moderate',
  daysCount: 2,
};

/** Giá trị gặp nhiều nhất; hòa thì lấy giá trị xuất hiện trước (lịch trình mới hơn). */
function mode<T>(values: T[]): T {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0];
  for (const v of values) if (counts.get(v)! > counts.get(best)!) best = v;
  return best;
}

function tripDays(input: ItineraryInput): number {
  return (
    daysBetween(
      toVietnamLocal(input.startsAt).date,
      toVietnamLocal(input.endsAt).date,
    ) + 1
  );
}

/** Thông số hay dùng của người dùng, từ các lịch trình đã tạo (mới nhất trước). */
export function learnTripParams(inputs: ItineraryInput[]): TripParams {
  if (inputs.length === 0) return { ...DEFAULT_TRIP_PARAMS };
  const days = inputs.map(tripDays).sort((a, b) => a - b);
  const median = days[Math.floor((days.length - 1) / 2)];
  return {
    travelParty: mode(inputs.map((i) => i.travelParty)),
    adults: mode(inputs.map((i) => i.adults)),
    children: mode(inputs.map((i) => i.children)),
    pace: mode(inputs.map((i) => i.pace)),
    budgetTier: mode(inputs.map((i) => i.budgetTier)),
    daysCount: Math.min(MAX_TRIP_DAYS, Math.max(1, median)),
  };
}

/** Input lập lịch của một bản nháp: xếp từ ngày gốc, AI/thuật toán tự chọn điểm theo danh mục ưu tiên. */
export function draftInput(
  regionId: string,
  categories: PlaceCategory[],
  trip: TripParams,
): ItineraryInput {
  const { startsAt, endsAt } = tripBounds(DRAFT_ANCHOR_DATE, trip.daysCount);
  return {
    regionId,
    planningMode: 'ai',
    startsAt,
    endsAt,
    travelParty: trip.travelParty,
    adults: trip.adults,
    children: trip.children,
    selectedPlaceIds: [],
    accommodationPlaceId: null,
    allowAiSuggestions: true,
    budgetTier: trip.budgetTier,
    pace: trip.pace,
    transport: null,
    preferredCategories: [...new Set(categories)],
    notes: null,
  };
}
```

Kiểm tra `ItineraryInput` có trường `notes` không (`packages/shared-types/src/itinerary.ts:35`); nếu không, bỏ dòng `notes: null` ở đây và ở test Task 2 của giai đoạn 1.

- [ ] **Step 8: Chạy test**

Run: `cd apps/backend && npx vitest run src/modules/recommendations/time-and-params.spec.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/shared-types/src/recommendation.ts apps/backend/src/modules/recommendations
git commit -m "feat(backend): add recommendation time window, draft dates and pool key"
```

---

### Task 2: Chấm điểm vùng, danh mục chủ đề, câu lý do, làm sạch chủ đề AI

**Files:**
- Create: `apps/backend/src/modules/recommendations/scoring.ts`
- Create: `apps/backend/src/modules/recommendations/themes.ts`
- Create: `apps/backend/src/modules/recommendations/copy.ts`
- Test: `apps/backend/src/modules/recommendations/scoring.spec.ts`
- Test: `apps/backend/src/modules/recommendations/themes.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  // scoring.ts
  export const REVISIT_FACTOR = 0.3; export const RECENT_FACTOR = 0.5; export const SAVED_WEIGHT = 3;
  export interface RegionStats { regionId: string; regionName: string; newPlaces: number; savedNew: number; visitedAny: boolean; recentlyShown: boolean; listVersion: Date }
  export function scoreRegion(s: RegionStats, minNewPlaces: number): number | null;
  export function pickRegions(stats: RegionStats[], minNewPlaces: number, count?: number): Array<RegionStats & { score: number }>;
  export function minNewPlaces(trip: TripParams): number;
  // themes.ts
  export const THEME_ICONS: readonly string[]; export const DEFAULT_THEME_ICON = 'sparkles';
  export interface FixedTheme { key: string; label: string; icon: string; categories: PlaceCategory[]; regionSourceKeys?: string[] }
  export const FIXED_THEMES: FixedTheme[];
  export const FEATURED_REGION_SOURCE_KEYS: string[];
  export const CATEGORY_LABELS: Record<PlaceCategory, string>;
  export const MAX_USER_THEMES = 3; export const USER_THEME_LABEL_MAX = 40;
  export interface RawTheme { label: string; icon: string; categories: string[]; regionIds: string[] }
  export interface CleanTheme { label: string; icon: string; categories: PlaceCategory[]; regionIds: string[] }
  export function sanitizeThemes(raw: RawTheme[], allowedRegionIds: Set<string>): CleanTheme[];
  // copy.ts
  export interface RecommendationReason { matchedInterests: PlaceCategory[]; newPlaceCount: number; revisit: boolean; savedCount: number }
  export function reasonText(r: RecommendationReason): string;
  export function cardTitle(regionName: string, themeLabel: string | null, draftCategories: PlaceCategory[]): string;
  ```

- [ ] **Step 1: Viết test hỏng — `scoring.spec.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { DEFAULT_TRIP_PARAMS } from './trip-params.js';
import { minNewPlaces, pickRegions, scoreRegion, type RegionStats } from './scoring.js';

const stats = (over: Partial<RegionStats>): RegionStats => ({
  regionId: over.regionName ?? 'r',
  regionName: 'r',
  newPlaces: 20,
  savedNew: 0,
  visitedAny: false,
  recentlyShown: false,
  listVersion: new Date(0),
  ...over,
});

describe('scoreRegion', () => {
  it('điểm gốc = số nơi mới + 3 × "Muốn đi" chưa đi', () => {
    expect(scoreRegion(stats({ newPlaces: 12, savedNew: 2 }), 10)).toBe(18);
  });
  it('vùng đã đi × 0,3', () => {
    expect(scoreRegion(stats({ newPlaces: 20, visitedAny: true }), 10)).toBeCloseTo(6);
  });
  it('vùng mới gợi ý gần đây × 0,5', () => {
    expect(scoreRegion(stats({ newPlaces: 20, recentlyShown: true }), 10)).toBe(10);
  });
  it('cả hai hệ số nhân dồn', () => {
    expect(
      scoreRegion(stats({ newPlaces: 20, visitedAny: true, recentlyShown: true }), 10),
    ).toBeCloseTo(3);
  });
  it('thiếu nơi mới → loại', () => {
    expect(scoreRegion(stats({ newPlaces: 9, savedNew: 10 }), 10)).toBeNull();
  });
});

describe('pickRegions', () => {
  it('3 vùng điểm cao nhất, khác nhau, hòa điểm theo tên', () => {
    const picked = pickRegions(
      [
        stats({ regionName: 'A', newPlaces: 10 }),
        stats({ regionName: 'B', newPlaces: 30 }),
        stats({ regionName: 'C', newPlaces: 20 }),
        stats({ regionName: 'D', newPlaces: 20 }),
        stats({ regionName: 'E', newPlaces: 5 }),
      ],
      10,
    );
    expect(picked.map((p) => p.regionName)).toEqual(['B', 'C', 'D']);
    expect(new Set(picked.map((p) => p.regionId)).size).toBe(3);
  });
  it('không đủ vùng thì trả ít hơn', () => {
    expect(pickRegions([stats({ newPlaces: 3 })], 10)).toEqual([]);
  });
  it('vùng đã đi nhiều nơi mới vẫn có thể đứng sau vùng chưa đi ít nơi hơn', () => {
    const picked = pickRegions(
      [
        stats({ regionName: 'cu', newPlaces: 40, visitedAny: true }), // 12
        stats({ regionName: 'moi', newPlaces: 15 }), // 15
      ],
      10,
    );
    expect(picked.map((p) => p.regionName)).toEqual(['moi', 'cu']);
  });
});

describe('minNewPlaces', () => {
  it('cặp đôi, nhịp vừa, 2 ngày', () => {
    // couple stopsPerDay [4, 5], moderate → round(4.5) = 5 mỗi ngày.
    expect(minNewPlaces(DEFAULT_TRIP_PARAMS)).toBe(10);
  });
});
```

Trước khi chạy, mở `planning/rules.ts`, xem `PARTY_RULES.couple.stopsPerDay`. Nếu khác `[4, 5]`, sửa số mong đợi và comment trong ca `minNewPlaces` cho khớp (`Math.round((min + max) / 2) × 2`).

- [ ] **Step 2: Viết test hỏng — `themes.spec.ts`**

```ts
import { describe, expect, it } from 'vitest';

import {
  DESTINATIONS,
  NEW_PROVINCES,
  OLD_PROVINCES,
} from '../regions/seed/vietnam-admin.js';
import { cardTitle, reasonText } from './copy.js';
import {
  CATEGORY_LABELS,
  FEATURED_REGION_SOURCE_KEYS,
  FIXED_THEMES,
  sanitizeThemes,
  THEME_ICONS,
} from './themes.js';

/** Khóa như `region-seeder.ts`. */
const seededKeys = new Set([
  ...OLD_PROVINCES.map((p) => `vn:province:${p.key}:pre_merger`),
  ...NEW_PROVINCES.map((p) => `vn:province:${p.key}:current`),
  ...DESTINATIONS.map((d) => `vn:destination:${d.key}`),
]);

describe('danh mục chủ đề', () => {
  it('mọi source_key của vùng nổi bật và chủ đề cố định có trong seed', () => {
    const keys = [
      ...FEATURED_REGION_SOURCE_KEYS,
      ...FIXED_THEMES.flatMap((t) => t.regionSourceKeys ?? []),
    ];
    expect(keys.filter((k) => !seededKeys.has(k))).toEqual([]);
  });
  it('khóa chủ đề không trùng, icon hợp lệ, không dùng danh mục Lưu trú', () => {
    expect(new Set(FIXED_THEMES.map((t) => t.key)).size).toBe(FIXED_THEMES.length);
    for (const t of FIXED_THEMES) {
      expect(THEME_ICONS).toContain(t.icon);
      expect(t.categories).not.toContain('stay');
      expect(t.categories.length).toBeGreaterThan(0);
    }
  });
});

describe('sanitizeThemes', () => {
  const allowed = new Set(['r1', 'r2']);
  it('bỏ vùng bịa, danh mục lạ, icon lạ, cắt nhãn, bỏ chủ đề rỗng, tối đa 3', () => {
    const clean = sanitizeThemes(
      [
        { label: '  Xứ sở dừa  ', icon: 'kayak', categories: ['nature', 'beach', 'stay'], regionIds: ['r1', 'bia', 'r1'] },
        { label: 'x'.repeat(200), icon: 'rocket', categories: ['cafe'], regionIds: ['r2'] },
        { label: 'Không vùng', icon: 'sun', categories: ['nature'], regionIds: ['bia'] },
        { label: 'Không danh mục', icon: 'sun', categories: ['beach'], regionIds: ['r1'] },
        { label: '', icon: 'sun', categories: ['cafe'], regionIds: ['r1'] },
        { label: 'Thứ tư', icon: 'sun', categories: ['cafe'], regionIds: ['r1'] },
        { label: 'Thứ năm', icon: 'sun', categories: ['cafe'], regionIds: ['r1'] },
      ],
      allowed,
    );
    expect(clean).toEqual([
      { label: 'Xứ sở dừa', icon: 'kayak', categories: ['nature'], regionIds: ['r1'] },
      { label: 'x'.repeat(40), icon: 'sparkles', categories: ['cafe'], regionIds: ['r2'] },
      { label: 'Thứ tư', icon: 'sun', categories: ['cafe'], regionIds: ['r1'] },
    ]);
  });
});

describe('câu chữ trên thẻ', () => {
  it('lý do: sở thích, số nơi mới, "Muốn đi"', () => {
    expect(
      reasonText({ matchedInterests: ['cafe', 'nature', 'kids'], newPlaceCount: 8, revisit: false, savedCount: 2 }),
    ).toBe('Vì bạn thích Cà phê và Thiên nhiên · 8 nơi bạn chưa đến · 2 nơi trong "Muốn đi"');
  });
  it('lý do khi quay lại vùng đã đi, không có sở thích', () => {
    expect(
      reasonText({ matchedInterests: [], newPlaceCount: 5, revisit: true, savedCount: 0 }),
    ).toBe('Quay lại, lần này với 5 nơi mới');
  });
  it('tiêu đề: tên chủ đề, hoặc 2 danh mục của bản nháp, hoặc "Khám phá"', () => {
    expect(cardTitle('Đà Lạt', 'Trốn phố về rừng', [])).toBe('Đà Lạt · Trốn phố về rừng');
    expect(cardTitle('Đà Lạt', null, ['cafe', 'nature', 'kids'])).toBe('Đà Lạt · Cà phê và thiên nhiên');
    expect(cardTitle('Đà Lạt', null, [])).toBe('Đà Lạt · Khám phá');
  });
  it('nhãn danh mục khớp app mobile', () => {
    expect(CATEGORY_LABELS.culture).toBe('Văn hóa – lịch sử');
  });
});
```

- [ ] **Step 3: Chạy để thấy hỏng**

Run: `cd apps/backend && npx vitest run src/modules/recommendations/scoring.spec.ts src/modules/recommendations/themes.spec.ts`
Expected: FAIL, module chưa có.

- [ ] **Step 4: Viết `scoring.ts`**

```ts
import type { TripParams } from '@rong/shared-types';

import { PARTY_RULES, targetStopsPerDay } from '../itineraries/planning/rules.js';

/** Vùng người dùng đã đến vẫn được gợi ý nhưng xếp thấp hẳn. */
export const REVISIT_FACTOR = 0.3;
/** Vùng vừa gợi ý ở các khung giờ trước: hạ xuống để đỡ lặp. */
export const RECENT_FACTOR = 0.5;
/** Mỗi địa điểm "Muốn đi" chưa đến trong vùng. */
export const SAVED_WEIGHT = 3;

export interface RegionStats {
  regionId: string;
  regionName: string;
  /** Địa điểm chưa đi trong 60 hạng đầu, thuộc danh mục của chủ đề. */
  newPlaces: number;
  /** Địa điểm "Muốn đi" chưa đi trong vùng. */
  savedNew: number;
  visitedAny: boolean;
  recentlyShown: boolean;
  /** `region_place_lists.fetched_at`. */
  listVersion: Date;
}

/** null = loại vì không đủ nơi mới cho cả chuyến. */
export function scoreRegion(s: RegionStats, minNew: number): number | null {
  if (s.newPlaces < minNew) return null;
  let score = s.newPlaces + SAVED_WEIGHT * s.savedNew;
  if (s.visitedAny) score *= REVISIT_FACTOR;
  if (s.recentlyShown) score *= RECENT_FACTOR;
  return score;
}

export function pickRegions(
  stats: RegionStats[],
  minNew: number,
  count = 3,
): Array<RegionStats & { score: number }> {
  return stats
    .map((s) => ({ ...s, score: scoreRegion(s, minNew) }))
    .filter((s): s is RegionStats & { score: number } => s.score !== null)
    .sort(
      (a, b) =>
        b.score - a.score || a.regionName.localeCompare(b.regionName, 'vi'),
    )
    .slice(0, count);
}

/** Số điểm tham quan cả chuyến cần, theo đối tượng và nhịp độ (rules.ts). */
export function minNewPlaces(trip: TripParams): number {
  return (
    targetStopsPerDay(PARTY_RULES[trip.travelParty], trip.pace) *
    trip.daysCount
  );
}
```

- [ ] **Step 5: Viết `themes.ts`**

```ts
import type { PlaceCategory } from '@rong/shared-types';

import { PLACE_CATEGORIES } from '../places/entities/place.entity.js';

/** Tên icon có trong `apps/mobile/src/components/ui/icon.tsx`. */
export const THEME_ICONS = [
  'sparkles',
  'forest',
  'sun',
  'cafe',
  'food',
  'culture',
  'nature',
  'kids',
  'nightlife',
  'kayak',
  'motorcycle',
  'explore',
] as const;
export const DEFAULT_THEME_ICON = 'sparkles';

export const MAX_USER_THEMES = 3;
export const USER_THEME_LABEL_MAX = 40;

export interface FixedTheme {
  key: string;
  label: string;
  icon: (typeof THEME_ICONS)[number];
  categories: PlaceCategory[];
  /** Giới hạn vùng (`regions.source_key`); không có = mọi vùng. */
  regionSourceKeys?: string[];
}

/** Chủ đề cố định, theo hàng chip mẫu cũ của trang chủ. */
export const FIXED_THEMES: FixedTheme[] = [
  {
    key: 'tron-pho-ve-rung',
    label: 'Trốn phố về rừng',
    icon: 'forest',
    categories: ['nature', 'check_in'],
    regionSourceKeys: [
      'vn:destination:da-lat',
      'vn:destination:bao-loc',
      'vn:destination:sa-pa',
      'vn:destination:moc-chau',
      'vn:destination:tam-dao',
      'vn:destination:mang-den',
      'vn:destination:phong-nha',
      'vn:destination:ba-vi',
      'vn:destination:mu-cang-chai',
    ],
  },
  {
    key: 'am-thuc-mien-tay',
    label: 'Ẩm thực miền Tây',
    icon: 'food',
    categories: ['food', 'culture', 'nature'],
    regionSourceKeys: [
      'vn:province:can-tho:current',
      'vn:province:vinh-long:current',
      'vn:province:an-giang:current',
      'vn:destination:chau-doc',
      'vn:destination:ha-tien',
    ],
  },
  {
    key: 'bien-vang-hoang-hon',
    label: 'Biển vắng hoàng hôn',
    icon: 'sun',
    categories: ['nature', 'check_in'],
    regionSourceKeys: [
      'vn:destination:vung-tau',
      'vn:destination:phu-quoc',
      'vn:destination:con-dao',
      'vn:destination:nha-trang',
      'vn:destination:quy-nhon',
      'vn:destination:mui-ne-phan-thiet',
      'vn:destination:ly-son',
      'vn:destination:co-to',
      'vn:destination:cat-ba',
    ],
  },
  {
    key: 'ca-phe-hoai-niem',
    label: 'Cà phê hoài niệm',
    icon: 'cafe',
    categories: ['cafe', 'check_in'],
  },
  {
    key: 'lang-nghe-thu-cong',
    label: 'Làng nghề thủ công',
    icon: 'culture',
    categories: ['culture'],
  },
];

/** Vùng nổi bật: danh sách địa điểm được job nền tạo sẵn (PRD §4.1 và vài vùng phổ biến). */
export const FEATURED_REGION_SOURCE_KEYS = [
  'vn:destination:da-lat',
  'vn:destination:vung-tau',
  'vn:destination:phu-quoc',
  'vn:destination:hoi-an',
  'vn:province:da-nang:current',
  'vn:province:ho-chi-minh:current',
  'vn:destination:nha-trang',
  'vn:destination:sa-pa',
  'vn:destination:ha-long',
  'vn:destination:quy-nhon',
];

/** Giống `apps/mobile/src/constants/places.ts`. */
export const CATEGORY_LABELS: Record<PlaceCategory, string> = {
  check_in: 'Check-in',
  food: 'Ăn uống',
  cafe: 'Cà phê',
  nature: 'Thiên nhiên',
  kids: 'Vui chơi cho bé',
  culture: 'Văn hóa – lịch sử',
  nightlife: 'Về đêm',
  stay: 'Lưu trú',
};

/** Chủ đề Gemini trả về, chưa kiểm tra. */
export interface RawTheme {
  label: string;
  icon: string;
  categories: string[];
  regionIds: string[];
}

export interface CleanTheme {
  label: string;
  icon: string;
  categories: PlaceCategory[];
  regionIds: string[];
}

const ALLOWED_CATEGORIES = PLACE_CATEGORIES.filter((c) => c !== 'stay');

/**
 * Chỉ giữ phần dùng được: vùng nằm trong danh sách đã gửi cho Gemini, danh mục
 * có thật (trừ Lưu trú), icon có trong app, nhãn ≤ 40 ký tự. Chủ đề nào mất
 * hết vùng hoặc danh mục thì bỏ.
 */
export function sanitizeThemes(
  raw: RawTheme[],
  allowedRegionIds: Set<string>,
): CleanTheme[] {
  return raw
    .map((t) => ({
      label: t.label.trim().slice(0, USER_THEME_LABEL_MAX).trim(),
      icon: (THEME_ICONS as readonly string[]).includes(t.icon)
        ? t.icon
        : DEFAULT_THEME_ICON,
      categories: [
        ...new Set(
          t.categories.filter((c): c is PlaceCategory =>
            ALLOWED_CATEGORIES.includes(c as PlaceCategory),
          ),
        ),
      ],
      regionIds: [...new Set(t.regionIds.filter((id) => allowedRegionIds.has(id)))],
    }))
    .filter((t) => t.label && t.categories.length > 0 && t.regionIds.length > 0)
    .slice(0, MAX_USER_THEMES);
}
```

Nếu test "mọi source_key … có trong seed" báo khóa không tồn tại (ví dụ `vn:province:an-giang:current`), **xóa khóa đó khỏi danh sách** thay vì sửa test.

- [ ] **Step 6: Viết `copy.ts`**

```ts
import type { PlaceCategory } from '@rong/shared-types';

import { CATEGORY_LABELS } from './themes.js';

export interface RecommendationReason {
  /** Sở thích của người dùng có trong bản nháp. */
  matchedInterests: PlaceCategory[];
  newPlaceCount: number;
  revisit: boolean;
  savedCount: number;
}

/** "Vì bạn thích Cà phê và Thiên nhiên · 8 nơi bạn chưa đến". */
export function reasonText(r: RecommendationReason): string {
  const parts: string[] = [];
  if (r.matchedInterests.length > 0) {
    parts.push(
      `Vì bạn thích ${r.matchedInterests
        .slice(0, 2)
        .map((c) => CATEGORY_LABELS[c])
        .join(' và ')}`,
    );
  }
  parts.push(
    r.revisit
      ? `Quay lại, lần này với ${r.newPlaceCount} nơi mới`
      : `${r.newPlaceCount} nơi bạn chưa đến`,
  );
  if (r.savedCount > 0) parts.push(`${r.savedCount} nơi trong "Muốn đi"`);
  return parts.join(' · ');
}

/** "Đà Lạt · Trốn phố về rừng", hoặc theo 2 danh mục nhiều nhất của bản nháp. */
export function cardTitle(
  regionName: string,
  themeLabel: string | null,
  draftCategories: PlaceCategory[],
): string {
  if (themeLabel) return `${regionName} · ${themeLabel}`;
  const top = draftCategories.slice(0, 2).map((c) => CATEGORY_LABELS[c]);
  if (top.length === 0) return `${regionName} · Khám phá`;
  const text = top.join(' và ');
  return `${regionName} · ${text.charAt(0)}${text.slice(1).toLowerCase()}`;
}
```

Lưu ý `cardTitle` hạ chữ hoa của phần sau chữ cái đầu ("Cà phê và thiên nhiên"); nhãn có chữ "Check-in" sẽ thành "check-in", chấp nhận được.

- [ ] **Step 7: Chạy test**

Run: `cd apps/backend && npx vitest run src/modules/recommendations`
Expected: PASS cả ba file spec.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/modules/recommendations
git commit -m "feat(backend): add region scoring, fixed themes and card copy"
```

---

### Task 3: Hàng đợi — BullMQ khi bật, chạy ngay trong process khi tắt

**Files:**
- Modify: `apps/backend/package.json` (thêm `@nestjs/bullmq`, `bullmq`)
- Modify: `apps/backend/src/config/configuration.ts`, `apps/backend/.env.example`
- Create: `apps/backend/src/modules/recommendations/queue/jobs.ts`
- Create: `apps/backend/src/modules/recommendations/queue/recommendations-queue.ts`
- Create: `apps/backend/src/modules/recommendations/queue/bull-queues.module.ts`
- Create: `apps/backend/src/modules/recommendations/queue/recommendations-queue.module.ts`
- Create: `apps/backend/src/modules/recommendations/queue/recommendation-scheduler.ts`
- Create: `apps/backend/src/modules/recommendations/queue/recommendations.processor.ts`
- Create: `apps/backend/src/modules/recommendations/recommendation-jobs.ts`
- Create: `apps/backend/src/modules/recommendations/recommendations.module.ts`
- Modify: `apps/backend/src/app.module.ts`
- Test: `apps/backend/src/modules/recommendations/queue/recommendations-queue.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  // queue/jobs.ts
  export const RECOMMENDATIONS_QUEUE = 'recommendations';
  export const RECOMMENDATIONS_AI_QUEUE = 'recommendations-ai';
  export type RecommendationJob =
    | { name: 'build-user-set'; data: { userId: string; windowStart: string; themeKey: string } }
    | { name: 'generate-user-themes'; data: { userId: string } }
    | { name: 'upgrade-draft'; data: { draftId: string } }
    | { name: 'fetch-region-image'; data: { regionId: string } }
    | { name: 'refresh-window'; data: Record<string, never> }
    | { name: 'refresh-themes'; data: Record<string, never> }
    | { name: 'warm-featured-regions'; data: Record<string, never> }
    | { name: 'cleanup'; data: Record<string, never> };
  export type JobState = 'missing' | 'waiting' | 'active' | 'completed' | 'failed';
  export function jobIdOf(job: RecommendationJob, now?: Date): string | undefined;
  export function queueOf(job: RecommendationJob): typeof RECOMMENDATIONS_QUEUE | typeof RECOMMENDATIONS_AI_QUEUE;
  export interface JobRunner { run(job: RecommendationJob): Promise<unknown> }
  export const JOB_RUNNER = 'RECOMMENDATION_JOB_RUNNER'; // RecommendationsModule: { provide: JOB_RUNNER, useExisting: RecommendationJobs }
  // queue/recommendations-queue.ts
  @Injectable() export class RecommendationsQueue {
    enqueue(job: RecommendationJob, opts?: { priority?: number }): Promise<void>;
    enqueueMany(jobs: RecommendationJob[], opts?: { priority?: number }): Promise<void>;
    state(jobId: string): Promise<JobState>;
    remove(jobId: string): Promise<void>;
    /** Chỉ chế độ chạy trong process: chờ mọi job đang chạy (kể cả job do job khác đẩy). */
    idle(): Promise<void>;
    readonly usesRedis: boolean;
  }
  // recommendation-jobs.ts
  @Injectable() export class RecommendationJobs implements JobRunner { run(job: RecommendationJob): Promise<unknown> }
  ```
- `RecommendationsQueueModule` là `@Global()`, export `RecommendationsQueue`: module khác (Users, Visits) inject được mà không import.

- [ ] **Step 1: Cài package**

Run: `pnpm --filter @rong/backend add @nestjs/bullmq bullmq`
Expected: `package.json` có hai dependency mới. Kiểm tra `@nestjs/bullmq` tương thích Nest 12 (`pnpm --filter @rong/backend ls @nestjs/bullmq @nestjs/core`); nếu pnpm cảnh báo peer dependency, báo lại người dùng trước khi tiếp tục.

- [ ] **Step 2: Cấu hình**

Trong `configuration.ts`, thêm interface và trường:

```ts
/** Gợi ý lịch trình trang chủ (spec 2026-10-19-home-recommendations). */
export interface RecommendationsConfig {
  /** Dùng BullMQ + Redis. Tắt (hoặc NODE_ENV=test) thì job chạy ngay trong process, không có lịch cron. */
  queueEnabled: boolean;
  /** Unsplash Search API; trống thì chỉ dùng ảnh từ bài viết. */
  unsplashAccessKey: string | null;
}
```

Thêm `recommendations: RecommendationsConfig;` vào `AppConfig`, và trong object trả về của `loadConfig`:

```ts
    recommendations: {
      queueEnabled: recommendationsQueueEnabled(process.env),
      unsplashAccessKey: process.env.UNSPLASH_ACCESS_KEY || null,
    },
```

Và hàm export (dùng chung cho `ConditionalModule`):

```ts
/** e2e (vitest đặt NODE_ENV=test) luôn chạy job trong process, không cần Redis. */
export function recommendationsQueueEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV !== 'test' && env.RECOMMENDATIONS_ENABLED !== 'false';
}
```

Trong `.env.example`, sau khối Redis:

```bash
# Gợi ý lịch trình trang chủ: hàng đợi BullMQ trên Redis ở trên. false = chạy job ngay trong
# process, không có lịch làm mới 6:00/15:00 (dùng khi máy không chạy Redis). e2e luôn tắt.
RECOMMENDATIONS_ENABLED=true
# Ảnh vùng từ Unsplash (https://unsplash.com/developers). Trống thì dùng ảnh từ bài viết, ghi nguồn.
UNSPLASH_ACCESS_KEY=
```

- [ ] **Step 3: Viết test hỏng**

`queue/recommendations-queue.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { jobIdOf, queueOf, type RecommendationJob } from './jobs.js';
import { RecommendationsQueue } from './recommendations-queue.js';

/** Hàng đợi chạy trong process (không có Redis), runner giả. */
function inlineQueue(run: (job: RecommendationJob) => Promise<unknown>) {
  const moduleRef = { get: () => ({ run }) };
  return new RecommendationsQueue(undefined, undefined, moduleRef as never);
}

const build = (themeKey = 'default'): RecommendationJob => ({
  name: 'build-user-set',
  data: { userId: 'u1', windowStart: '2026-10-19T08:00:00.000Z', themeKey },
});

describe('jobIdOf / queueOf', () => {
  it('job id cố định theo người dùng, khung giờ, chủ đề', () => {
    expect(jobIdOf(build('fixed:a'))).toBe('user_u1_2026-10-19T08-00-00-000Z_fixed-a');
  });
  it('job theo lịch không có id; job gọi Gemini vào queue AI', () => {
    expect(jobIdOf({ name: 'cleanup', data: {} })).toBeUndefined();
    expect(queueOf({ name: 'upgrade-draft', data: { draftId: 'd' } })).toBe('recommendations-ai');
    expect(queueOf({ name: 'generate-user-themes', data: { userId: 'u' } })).toBe('recommendations-ai');
    expect(queueOf(build())).toBe('recommendations');
  });
});

describe('RecommendationsQueue (chạy trong process)', () => {
  it('enqueue trùng jobId chỉ chạy một lần', async () => {
    const run = vi.fn(async () => undefined);
    const queue = inlineQueue(run);
    await Promise.all([queue.enqueue(build()), queue.enqueue(build())]);
    await queue.idle();
    expect(run).toHaveBeenCalledTimes(1);
    expect(await queue.state(jobIdOf(build())!)).toBe('completed');
  });

  it('job lỗi → failed; remove rồi enqueue lại thì chạy lại', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('hỏng')).mockResolvedValue(undefined);
    const queue = inlineQueue(run);
    await queue.enqueue(build());
    await queue.idle();
    expect(await queue.state(jobIdOf(build())!)).toBe('failed');
    await queue.remove(jobIdOf(build())!);
    expect(await queue.state(jobIdOf(build())!)).toBe('missing');
    await queue.enqueue(build());
    await queue.idle();
    expect(run).toHaveBeenCalledTimes(2);
    expect(await queue.state(jobIdOf(build())!)).toBe('completed');
  });

  it('idle chờ cả job do job khác đẩy vào', async () => {
    const seen: string[] = [];
    let queue!: RecommendationsQueue;
    queue = inlineQueue(async (job) => {
      seen.push(job.name);
      if (job.name === 'build-user-set') {
        await queue.enqueue({ name: 'fetch-region-image', data: { regionId: 'r' } });
      }
    });
    await queue.enqueue(build());
    await queue.idle();
    expect(seen).toEqual(['build-user-set', 'fetch-region-image']);
  });

  it('enqueue không bao giờ ném lỗi của job ra nơi gọi', async () => {
    const queue = inlineQueue(async () => {
      throw new Error('hỏng');
    });
    await expect(queue.enqueue(build())).resolves.toBeUndefined();
    await queue.idle();
  });
});
```

- [ ] **Step 4: Chạy để thấy hỏng**

Run: `cd apps/backend && npx vitest run src/modules/recommendations/queue`
Expected: FAIL, module chưa có.

- [ ] **Step 5: Viết `queue/jobs.ts`**

```ts
export const RECOMMENDATIONS_QUEUE = 'recommendations';
/** Job gọi Gemini: queue riêng để limiter không chặn job thường. */
export const RECOMMENDATIONS_AI_QUEUE = 'recommendations-ai';

type Empty = Record<string, never>;

export type RecommendationJob =
  | {
      name: 'build-user-set';
      data: { userId: string; windowStart: string; themeKey: string };
    }
  | { name: 'generate-user-themes'; data: { userId: string } }
  | { name: 'upgrade-draft'; data: { draftId: string } }
  | { name: 'fetch-region-image'; data: { regionId: string } }
  | { name: 'refresh-window'; data: Empty }
  | { name: 'refresh-themes'; data: Empty }
  | { name: 'warm-featured-regions'; data: Empty }
  | { name: 'cleanup'; data: Empty };

export type JobState = 'missing' | 'waiting' | 'active' | 'completed' | 'failed';

export interface JobRunner {
  run(job: RecommendationJob): Promise<unknown>;
}

/** Token của bộ chạy job (RecommendationJobs). Hàng đợi lấy qua ModuleRef để không import vòng. */
export const JOB_RUNNER = 'RECOMMENDATION_JOB_RUNNER';

/** BullMQ không cho dấu ":" trong job id tự đặt; đổi ký tự lạ thành "-". */
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '-');

/** Job id cố định để không chạy trùng; undefined = job theo lịch, không cần chống trùng. */
export function jobIdOf(
  job: RecommendationJob,
  now: Date = new Date(),
): string | undefined {
  switch (job.name) {
    case 'build-user-set':
      return `user_${job.data.userId}_${safe(job.data.windowStart)}_${safe(job.data.themeKey)}`;
    case 'generate-user-themes':
      return `themes_${job.data.userId}_${now.toISOString().slice(0, 10)}`;
    case 'upgrade-draft':
      return `upgrade_${job.data.draftId}`;
    case 'fetch-region-image':
      return `image_${job.data.regionId}`;
    default:
      return undefined;
  }
}

export function queueOf(
  job: RecommendationJob,
): typeof RECOMMENDATIONS_QUEUE | typeof RECOMMENDATIONS_AI_QUEUE {
  return job.name === 'upgrade-draft' || job.name === 'generate-user-themes'
    ? RECOMMENDATIONS_AI_QUEUE
    : RECOMMENDATIONS_QUEUE;
}

/** Số lần chạy và backoff theo bảng job của spec. */
export function attemptsOf(job: RecommendationJob): {
  attempts: number;
  backoff?: { type: 'fixed'; delay: number };
} {
  switch (job.name) {
    case 'refresh-window':
      return { attempts: 3, backoff: { type: 'fixed', delay: 30_000 } };
    case 'build-user-set':
      return { attempts: 2, backoff: { type: 'fixed', delay: 5_000 } };
    case 'upgrade-draft':
    case 'generate-user-themes':
    case 'fetch-region-image':
      return { attempts: 2, backoff: { type: 'fixed', delay: 60_000 } };
    default:
      return { attempts: 1 };
  }
}
```

Kiểm tra quy tắc job id của BullMQ phiên bản vừa cài (tài liệu "Job Ids"): nếu chỉ cấm số nguyên thuần và dấu ":", hàm `safe` vẫn đúng.

- [ ] **Step 6: Viết `queue/recommendations-queue.ts`**

```ts
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Queue } from 'bullmq';

import {
  attemptsOf,
  JOB_RUNNER,
  jobIdOf,
  queueOf,
  RECOMMENDATIONS_AI_QUEUE,
  RECOMMENDATIONS_QUEUE,
  type JobRunner,
  type JobState,
  type RecommendationJob,
} from './jobs.js';

/**
 * Cửa duy nhất để đẩy job gợi ý. Có BullMQ (Redis) thì đẩy vào queue; không có
 * (e2e, máy không chạy Redis) thì chạy ngay trong process, vẫn chống trùng theo
 * job id như BullMQ.
 */
@Injectable()
export class RecommendationsQueue {
  private readonly logger = new Logger(RecommendationsQueue.name);
  private readonly inline = new Map<string, JobState>();
  private readonly running = new Set<Promise<void>>();
  private anonymous = 0;

  constructor(
    @Optional() @InjectQueue(RECOMMENDATIONS_QUEUE) private readonly main: Queue | undefined,
    @Optional() @InjectQueue(RECOMMENDATIONS_AI_QUEUE) private readonly ai: Queue | undefined,
    private readonly moduleRef: ModuleRef,
  ) {}

  get usesRedis(): boolean {
    return this.main !== undefined;
  }

  async enqueue(
    job: RecommendationJob,
    opts: { priority?: number } = {},
  ): Promise<void> {
    await this.enqueueMany([job], opts);
  }

  async enqueueMany(
    jobs: RecommendationJob[],
    opts: { priority?: number } = {},
  ): Promise<void> {
    if (jobs.length === 0) return;
    if (this.main && this.ai) {
      for (const target of [this.main, this.ai]) {
        const batch = jobs.filter((j) => queueOf(j) === target.name);
        if (batch.length === 0) continue;
        await target.addBulk(
          batch.map((job) => ({
            name: job.name,
            data: job.data,
            opts: {
              jobId: jobIdOf(job),
              priority: opts.priority,
              ...attemptsOf(job),
            },
          })),
        );
      }
      return;
    }
    for (const job of jobs) this.runInline(job);
  }

  async state(jobId: string): Promise<JobState> {
    if (!this.main || !this.ai) return this.inline.get(jobId) ?? 'missing';
    for (const queue of [this.main, this.ai]) {
      const job = await queue.getJob(jobId);
      if (!job) continue;
      const state = await job.getState();
      if (state === 'completed' || state === 'failed' || state === 'active')
        return state;
      return 'waiting';
    }
    return 'missing';
  }

  async remove(jobId: string): Promise<void> {
    if (!this.main || !this.ai) {
      this.inline.delete(jobId);
      return;
    }
    for (const queue of [this.main, this.ai]) {
      const job = await queue.getJob(jobId);
      if (job) await job.remove();
    }
  }

  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
  }

  private runInline(job: RecommendationJob): void {
    const id = jobIdOf(job) ?? `anonymous_${++this.anonymous}`;
    const current = this.inline.get(id);
    if (current === 'waiting' || current === 'active' || current === 'completed')
      return;
    this.inline.set(id, 'active');
    const runner = this.moduleRef.get<JobRunner>(JOB_RUNNER, {
      strict: false,
    });
    const task = (async () => {
      try {
        await runner.run(job);
        this.inline.set(id, 'completed');
      } catch (error) {
        this.inline.set(id, 'failed');
        this.logger.warn(
          `Job ${job.name} (${id}) lỗi: ${(error as Error).message}`,
        );
      }
    })();
    this.running.add(task);
    void task.finally(() => this.running.delete(task));
  }
}
```

Khác biệt với BullMQ (chấp nhận được): ở chế độ trong process, job `completed` không tự hết hạn sau 1 ngày; chỉ ảnh hưởng một process chạy lâu với `RECOMMENDATIONS_ENABLED=false`, và mỗi khung giờ dùng job id khác nên không kẹt.

- [ ] **Step 7: Viết `queue/bull-queues.module.ts` và `queue/recommendations-queue.module.ts`**

`bull-queues.module.ts`:

```ts
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { RedisConfig } from '../../../config/configuration.js';
import { RECOMMENDATIONS_AI_QUEUE, RECOMMENDATIONS_QUEUE } from './jobs.js';

const DAY_S = 24 * 60 * 60;
const defaultJobOptions = {
  removeOnComplete: { age: DAY_S },
  removeOnFail: { age: 7 * DAY_S },
};

/** Chỉ được import khi hàng đợi bật (ConditionalModule): khởi tạo là mở kết nối Redis. */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: config.getOrThrow<RedisConfig>('redis'),
      }),
    }),
    BullModule.registerQueue(
      { name: RECOMMENDATIONS_QUEUE, defaultJobOptions },
      { name: RECOMMENDATIONS_AI_QUEUE, defaultJobOptions },
    ),
  ],
  exports: [BullModule],
})
export class BullQueuesModule {}
```

`recommendations-queue.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';

import { recommendationsQueueEnabled } from '../../../config/configuration.js';
import { BullQueuesModule } from './bull-queues.module.js';
import { RecommendationScheduler } from './recommendation-scheduler.js';
import { RecommendationsQueue } from './recommendations-queue.js';

/** Global: UsersModule, VisitsModule đẩy job mà không phải import RecommendationsModule. */
@Global()
@Module({
  imports: [
    ConditionalModule.registerWhen(BullQueuesModule, (env) =>
      recommendationsQueueEnabled(env),
    ),
  ],
  providers: [RecommendationsQueue, RecommendationScheduler],
  exports: [RecommendationsQueue],
})
export class RecommendationsQueueModule {}
```

Kiểm tra chữ ký `ConditionalModule.registerWhen` trong `node_modules/@nestjs/config/dist/conditional.module.d.ts` (tham số thứ hai nhận chuỗi tên biến hoặc hàm `(env) => boolean`).

- [ ] **Step 8: Viết `queue/recommendation-scheduler.ts`**

```ts
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { RECOMMENDATIONS_QUEUE } from './jobs.js';

const TZ = 'Asia/Ho_Chi_Minh';

/** Lịch chạy (spec mục "Các job"). Lưu trong Redis; gọi lại khi deploy không tạo lịch trùng. */
const SCHEDULES = [
  { id: 'refresh-window', pattern: '0 6,15 * * *' },
  { id: 'refresh-themes', pattern: '0 3 * * 1' },
  { id: 'warm-featured-regions', pattern: '0 2 * * *' },
  { id: 'cleanup', pattern: '30 4 * * *' },
] as const;

@Injectable()
export class RecommendationScheduler implements OnModuleInit {
  private readonly logger = new Logger(RecommendationScheduler.name);

  constructor(
    @Optional() @InjectQueue(RECOMMENDATIONS_QUEUE) private readonly queue: Queue | undefined,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.queue) {
      this.logger.log('Hàng đợi gợi ý đang tắt: không có lịch làm mới 6:00/15:00.');
      return;
    }
    for (const { id, pattern } of SCHEDULES) {
      await this.queue.upsertJobScheduler(
        id,
        { pattern, tz: TZ },
        { name: id, data: {} },
      );
    }
    this.logger.log(`Đã đăng ký ${SCHEDULES.length} lịch chạy gợi ý (${TZ}).`);
  }
}
```

- [ ] **Step 9: Viết `recommendation-jobs.ts` (khung, các nhánh thật thêm ở Task 4, 6, 7, 8)**

```ts
import { Injectable } from '@nestjs/common';

import type { JobRunner, RecommendationJob } from './queue/jobs.js';

/** Chạy một job gợi ý; dùng chung cho worker BullMQ và chế độ chạy trong process. */
@Injectable()
export class RecommendationJobs implements JobRunner {
  async run(job: RecommendationJob): Promise<unknown> {
    switch (job.name) {
      default:
        throw new Error(`Chưa hỗ trợ job ${job.name}`);
    }
  }
}
```

- [ ] **Step 10: Viết `queue/recommendations.processor.ts`**

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

import { RecommendationJobs } from '../recommendation-jobs.js';
import {
  RECOMMENDATIONS_AI_QUEUE,
  RECOMMENDATIONS_QUEUE,
  type RecommendationJob,
} from './jobs.js';

const toJob = (job: Job) =>
  ({ name: job.name, data: job.data }) as RecommendationJob;

@Processor(RECOMMENDATIONS_QUEUE, { concurrency: 4 })
export class RecommendationsProcessor extends WorkerHost {
  constructor(private readonly jobs: RecommendationJobs) {
    super();
  }

  process(job: Job): Promise<unknown> {
    return this.jobs.run(toJob(job));
  }
}

/** Job gọi Gemini: tối đa 10 job mỗi phút. */
@Processor(RECOMMENDATIONS_AI_QUEUE, {
  concurrency: 2,
  limiter: { max: 10, duration: 60_000 },
})
export class RecommendationsAiProcessor extends WorkerHost {
  constructor(private readonly jobs: RecommendationJobs) {
    super();
  }

  process(job: Job): Promise<unknown> {
    return this.jobs.run(toJob(job));
  }
}
```

- [ ] **Step 11: Viết `recommendations.module.ts` và đăng ký vào `AppModule`**

```ts
import { Module } from '@nestjs/common';

import { JOB_RUNNER } from './queue/jobs.js';
import {
  RecommendationsAiProcessor,
  RecommendationsProcessor,
} from './queue/recommendations.processor.js';
import { RecommendationJobs } from './recommendation-jobs.js';

/**
 * Gợi ý lịch trình ở trang chủ (spec 2026-10-19-home-recommendations). Worker
 * BullMQ chỉ được tạo khi `BullQueuesModule` được nạp (hàng đợi bật).
 */
@Module({
  providers: [
    RecommendationJobs,
    { provide: JOB_RUNNER, useExisting: RecommendationJobs },
    RecommendationsProcessor,
    RecommendationsAiProcessor,
  ],
  exports: [RecommendationJobs, JOB_RUNNER],
})
export class RecommendationsModule {}
```

Trong `app.module.ts`, import `RecommendationsQueueModule` và `RecommendationsModule`, thêm cả hai vào `imports` (sau `VisitsModule`).

Kiểm tra: khi hàng đợi tắt, `@Processor` trên provider không tạo worker (không có `BullExplorer`). Xác nhận ở Step 13.

- [ ] **Step 12: Chạy unit test**

Run: `cd apps/backend && npx vitest run src/modules/recommendations/queue`
Expected: PASS.

- [ ] **Step 13: Kiểm tra khởi động ở cả hai chế độ**

Chạy e2e có sẵn (chế độ tắt, không Redis):

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/health.e2e-spec.ts`
Expected: PASS, không có log lỗi kết nối Redis.

Chạy server với Redis (chế độ bật):

Run: `pnpm infra:up` rồi `pnpm --filter @rong/backend start:dev` (chạy nền), đợi log `Đã đăng ký 4 lịch chạy gợi ý (Asia/Ho_Chi_Minh).`, gọi `curl http://localhost:3001/api/health`, rồi dừng server.
Expected: health 200; `docker exec rong-redis redis-cli keys 'bull:recommendations:*'` có các khóa `repeat`/scheduler.

- [ ] **Step 14: Typecheck, lint, commit**

Run: `pnpm --filter @rong/backend typecheck && pnpm --filter @rong/backend lint`

```bash
git add apps/backend/package.json pnpm-lock.yaml apps/backend/.env.example apps/backend/src/config/configuration.ts apps/backend/src/modules/recommendations apps/backend/src/app.module.ts
git commit -m "feat(backend): add BullMQ queue for recommendations with in-process fallback"
```

---

### Task 4: Kho bản nháp và tạo bộ gợi ý (`build-user-set`)

**Files:**
- Modify: `apps/backend/src/modules/places/places.module.ts` (export `WebPlacesService`)
- Create: `apps/backend/src/modules/recommendations/draft-pool.ts`
- Create: `apps/backend/src/modules/recommendations/theme-catalog.ts`
- Create: `apps/backend/src/modules/recommendations/recommendation-builder.ts`
- Modify: `apps/backend/src/modules/recommendations/recommendation-jobs.ts`
- Modify: `apps/backend/src/modules/recommendations/recommendations.module.ts`
- Test: `apps/backend/test/fixtures/recommendation-regions.ts`
- Test: `apps/backend/test/recommendation-builder.e2e-spec.ts`

**Interfaces:**
- Consumes: `ItineraryPlanner.planTrip`, `VisitsService.inferVisits/visitedPlaceIds` (giai đoạn 1); Task 1–3.
- Produces:
  ```ts
  // draft-pool.ts
  export interface DraftRow { id: string; regionId: string; poolKey: string; listVersion: Date; categories: PlaceCategory[]; daysCount: number; travelParty: TravelParty; pace: Pace; budgetTier: BudgetTier; input: ItineraryInput; days: ItineraryDay[]; unscheduled: UnscheduledPlace[]; warnings: ItineraryWarning[]; tips: string[]; placeIds: string[]; excludePlaceIds: string[]; planner: 'heuristic' | 'ai'; viewCount: number; saveCount: number; upgradedAt: Date | null }
  @Injectable() export class DraftPool {
    findOrCreate(p: { regionId: string; categories: PlaceCategory[]; trip: TripParams; listVersion: Date; excludePlaceIds: string[]; userId: string }): Promise<DraftRow>;
    get(id: string): Promise<DraftRow | null>;
    listVersion(regionId: string): Promise<Date | null>;
  }
  // theme-catalog.ts
  export interface ResolvedTheme { key: string; label: string; icon: string; kind: RecommendationThemeKind; categories: PlaceCategory[]; regionIds: string[] | null; regionHint: string | null }
  @Injectable() export class ThemeCatalog {
    list(userId: string, interests: PlaceCategory[]): Promise<ResolvedTheme[]>;
    resolve(userId: string, key: string, interests: PlaceCategory[]): Promise<ResolvedTheme>; // UNKNOWN_THEME 400
  }
  // recommendation-builder.ts
  @Injectable() export class RecommendationBuilder {
    build(userId: string, windowStart: Date, themeKey: string): Promise<number>; // số thẻ đã ghi
    interests(userId: string): Promise<PlaceCategory[]>;
  }
  ```

- [ ] **Step 1: Fixture dùng chung cho e2e**

`apps/backend/test/fixtures/recommendation-regions.ts`:

```ts
import type { DataSource } from 'typeorm';

/** Ba vùng thật (seed) và danh sách địa điểm giả đứng đầu danh sách của mỗi vùng. */
export const FIXTURE_REGIONS = [
  { sourceKey: 'vn:destination:da-lat', lat: 11.94, lng: 108.44 },
  { sourceKey: 'vn:destination:vung-tau', lat: 10.35, lng: 107.08 },
  { sourceKey: 'vn:destination:phu-quoc', lat: 10.22, lng: 103.96 },
] as const;

const VISITS = ['nature', 'culture', 'check_in', 'cafe', 'kids', 'nature', 'culture', 'check_in', 'cafe', 'nature', 'culture', 'check_in'];
const FOOD = ['food', 'food', 'food', 'food'];

export interface FixtureRegion {
  id: string;
  sourceKey: string;
  placeIds: string[];
  visitIds: string[];
}

/**
 * Mỗi vùng: 12 điểm tham quan + 4 quán ăn tên `E2E rec <prefix> …`, hạng âm để
 * đứng trước dữ liệu thật trong DB dev. Đảm bảo vùng có danh sách `ready`.
 */
export async function seedRecommendationRegions(
  db: DataSource,
  prefix: string,
): Promise<FixtureRegion[]> {
  const out: FixtureRegion[] = [];
  for (const region of FIXTURE_REGIONS) {
    const [{ id }] = (await db.query(
      `SELECT id FROM regions WHERE source_key = $1`,
      [region.sourceKey],
    )) as Array<{ id: string }>;
    await db.query(
      `INSERT INTO region_place_lists (region_id, status, fetched_at, expires_at)
       VALUES ($1, 'ready', now(), now() + interval '30 days')
       ON CONFLICT (region_id) DO UPDATE SET status = 'ready',
         fetched_at = COALESCE(region_place_lists.fetched_at, now())`,
      [id],
    );
    const placeIds: string[] = [];
    const visitIds: string[] = [];
    for (const [i, category] of [...VISITS, ...FOOD].entries()) {
      const [row] = (await db.query(
        `INSERT INTO places (source, name, category, location, location_source)
         VALUES ('web', $1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), 'ai')
         RETURNING id`,
        [
          `E2E rec ${prefix} ${region.sourceKey} ${i}`,
          category,
          region.lng + (i % 4) * 0.005,
          region.lat + Math.floor(i / 4) * 0.005,
        ],
      )) as Array<{ id: string }>;
      await db.query(
        `INSERT INTO region_places (region_id, place_id, rank) VALUES ($1, $2, $3)`,
        [id, row.id, -1000 + i],
      );
      placeIds.push(row.id);
      if (category !== 'food') visitIds.push(row.id);
    }
    out.push({ id, sourceKey: region.sourceKey, placeIds, visitIds });
  }
  return out;
}

export async function cleanupRecommendationRegions(
  db: DataSource,
  prefix: string,
): Promise<void> {
  const like = `E2E rec ${prefix} %`;
  await db.query(
    `DELETE FROM itinerary_drafts d
      WHERE EXISTS (SELECT 1 FROM places p WHERE p.id = ANY(d.place_ids) AND p.name LIKE $1)`,
    [like],
  );
  await db.query(
    `DELETE FROM region_places rp USING places p WHERE rp.place_id = p.id AND p.name LIKE $1`,
    [like],
  );
  await db.query(`DELETE FROM places WHERE name LIKE $1`, [like]);
}
```

- [ ] **Step 2: Viết test hỏng**

`apps/backend/test/recommendation-builder.e2e-spec.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { LangchainService } from '../src/langchain/langchain.service.js';
import { RecommendationBuilder } from '../src/modules/recommendations/recommendation-builder.js';
import { windowFor } from '../src/modules/recommendations/window.js';
import {
  cleanupRecommendationRegions,
  seedRecommendationRegions,
  type FixtureRegion,
} from './fixtures/recommendation-regions.js';

describe('RecommendationBuilder (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let builder: RecommendationBuilder;
  let regions: FixtureRegion[];
  const planItinerary = vi.fn();
  const suggestThemes = vi.fn();
  const { windowStart } = windowFor(new Date());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LangchainService)
      .useValue({ planItinerary, suggestThemes })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DataSource);
    builder = app.get(RecommendationBuilder);
    regions = await seedRecommendationRegions(db, 'builder');
  });

  afterAll(async () => {
    await db?.query(`DELETE FROM users WHERE display_name LIKE 'e2e-rec-builder%'`);
    await cleanupRecommendationRegions(db, 'builder');
    await app?.close();
  });

  const newUser = async () => {
    const [user] = (await db.query(
      `INSERT INTO users (display_name) VALUES ('e2e-rec-builder') RETURNING id`,
    )) as Array<{ id: string }>;
    return user.id;
  };

  /** Chủ đề riêng gồm đúng 3 vùng fixture, để kết quả không phụ thuộc dữ liệu thật trong DB dev. */
  const themeFor = async (userId: string) => {
    const [row] = (await db.query(
      `INSERT INTO user_themes (user_id, label, icon, categories, region_ids, expires_at)
       VALUES ($1, 'E2E chủ đề', 'sparkles', '{nature,culture,check_in,cafe,kids}', $2::uuid[], now() + interval '7 days')
       RETURNING id`,
      [userId, regions.map((r) => r.id)],
    )) as Array<{ id: string }>;
    return `user:${row.id}`;
  };

  const rowsOf = async (userId: string, themeKey: string) =>
    (await db.query(
      `SELECT ur.slot, ur.region_id, ur.reason, ur.params, d.place_ids, d.planner
         FROM user_recommendations ur JOIN itinerary_drafts d ON d.id = ur.draft_id
        WHERE ur.user_id = $1 AND ur.window_start = $2 AND ur.theme_key = $3
        ORDER BY ur.slot`,
      [userId, windowStart, themeKey],
    )) as Array<{
      slot: number;
      region_id: string;
      reason: { newPlaceCount: number; revisit: boolean };
      params: { travelParty: string; daysCount: number };
      place_ids: string[];
      planner: string;
    }>;

  it('ghi 3 gợi ý ở 3 vùng khác nhau, bản nháp heuristic, không gọi Gemini', async () => {
    planItinerary.mockClear();
    const userId = await newUser();
    const themeKey = await themeFor(userId);
    expect(await builder.build(userId, windowStart, themeKey)).toBe(3);
    const rows = await rowsOf(userId, themeKey);
    expect(rows.map((r) => r.slot)).toEqual([0, 1, 2]);
    expect(new Set(rows.map((r) => r.region_id))).toEqual(new Set(regions.map((r) => r.id)));
    expect(rows.every((r) => r.planner === 'heuristic')).toBe(true);
    expect(rows[0].params).toMatchObject({ travelParty: 'couple', daysCount: 2 });
    expect(planItinerary).not.toHaveBeenCalled();
  });

  it('hai người cùng thông số dùng chung bản nháp trong kho', async () => {
    const a = await newUser();
    const b = await newUser();
    const keyA = await themeFor(a);
    const keyB = await themeFor(b);
    await builder.build(a, windowStart, keyA);
    await builder.build(b, windowStart, keyB);
    const drafts = async (u: string, k: string) =>
      (
        (await db.query(
          `SELECT draft_id FROM user_recommendations WHERE user_id = $1 AND theme_key = $2 ORDER BY region_id`,
          [u, k],
        )) as Array<{ draft_id: string }>
      ).map((r) => r.draft_id);
    expect(await drafts(b, keyB)).toEqual(await drafts(a, keyA));
  });

  it('nơi đã đi không có trong bản nháp; vùng đã đi xếp sau', async () => {
    const userId = await newUser();
    const themeKey = await themeFor(userId);
    const visited = regions[0].visitIds.slice(0, 2);
    for (const placeId of visited) {
      await db.query(
        `INSERT INTO visited_places (user_id, place_id, region_id, status, visited_at)
         VALUES ($1, $2, $3, 'confirmed', now())`,
        [userId, placeId, regions[0].id],
      );
    }
    await builder.build(userId, windowStart, themeKey);
    const rows = await rowsOf(userId, themeKey);
    for (const row of rows) for (const id of visited) expect(row.place_ids).not.toContain(id);
    const revisited = rows.find((r) => r.region_id === regions[0].id)!;
    expect(revisited.reason.revisit).toBe(true);
    expect(revisited.slot).toBe(2);
  });

  it('build lại cùng khung giờ thay thế, không nhân đôi', async () => {
    const userId = await newUser();
    const themeKey = await themeFor(userId);
    await builder.build(userId, windowStart, themeKey);
    await builder.build(userId, windowStart, themeKey);
    expect(await rowsOf(userId, themeKey)).toHaveLength(3);
  });

  it('chủ đề không tồn tại → UNKNOWN_THEME', async () => {
    const userId = await newUser();
    await expect(builder.build(userId, windowStart, 'fixed:khong-co')).rejects.toMatchObject({
      response: { code: 'UNKNOWN_THEME' },
    });
  });
});
```

- [ ] **Step 3: Chạy để thấy hỏng**

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/recommendation-builder.e2e-spec.ts`
Expected: FAIL, không resolve được `recommendation-builder.js`.

- [ ] **Step 4: Export `WebPlacesService`**

Trong `places.module.ts`: `exports: [PlaceLocationService, GooglePlaceRowsService, RegionPlaceStore, WebPlacesService],`.

- [ ] **Step 5: Viết `draft-pool.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  BudgetTier,
  ItineraryDay,
  ItineraryInput,
  ItineraryWarning,
  Pace,
  PlaceCategory,
  TravelParty,
  TripParams,
  UnscheduledPlace,
} from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { ItineraryPlanner } from '../itineraries/itinerary-planner.js';
import { poolKey } from './pool-key.js';
import { draftInput } from './trip-params.js';

export interface DraftRow {
  id: string;
  regionId: string;
  poolKey: string;
  listVersion: Date;
  categories: PlaceCategory[];
  daysCount: number;
  travelParty: TravelParty;
  pace: Pace;
  budgetTier: BudgetTier;
  input: ItineraryInput;
  days: ItineraryDay[];
  unscheduled: UnscheduledPlace[];
  warnings: ItineraryWarning[];
  tips: string[];
  placeIds: string[];
  excludePlaceIds: string[];
  planner: 'heuristic' | 'ai';
  viewCount: number;
  saveCount: number;
  upgradedAt: Date | null;
}

export const DRAFT_SELECT = `
  SELECT d.id, d.region_id, d.pool_key, d.list_version, d.categories::text[] AS categories,
         d.days_count, d.travel_party, d.pace, d.budget_tier, d.input, d.days, d.unscheduled,
         d.warnings, d.tips, d.place_ids, d.exclude_place_ids, d.planner, d.view_count,
         d.save_count, d.upgraded_at
    FROM itinerary_drafts d`;

export function toDraft(r: Record<string, unknown>): DraftRow {
  return {
    id: r.id as string,
    regionId: r.region_id as string,
    poolKey: r.pool_key as string,
    listVersion: r.list_version as Date,
    categories: r.categories as PlaceCategory[],
    daysCount: Number(r.days_count),
    travelParty: r.travel_party as TravelParty,
    pace: r.pace as Pace,
    budgetTier: r.budget_tier as BudgetTier,
    input: r.input as ItineraryInput,
    days: r.days as ItineraryDay[],
    unscheduled: r.unscheduled as UnscheduledPlace[],
    warnings: r.warnings as ItineraryWarning[],
    tips: r.tips as string[],
    placeIds: r.place_ids as string[],
    excludePlaceIds: r.exclude_place_ids as string[],
    planner: r.planner as 'heuristic' | 'ai',
    viewCount: Number(r.view_count),
    saveCount: Number(r.save_count),
    upgradedAt: (r.upgraded_at as Date | null) ?? null,
  };
}

/** Mọi placeId trong các ngày của lịch. */
export function placeIdsOf(days: ItineraryDay[]): string[] {
  return [
    ...new Set(
      days.flatMap((d) => d.items.flatMap((i) => (i.placeId ? [i.placeId] : []))),
    ),
  ];
}

/**
 * Kho bản nháp dùng chung (`itinerary_drafts`). Một `pool_key` có thể có nhiều
 * biến thể; chọn bản không chứa nơi người dùng đã đi, ưu tiên bản họ chưa thấy.
 */
@Injectable()
export class DraftPool {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly planner: ItineraryPlanner,
  ) {}

  async findOrCreate(p: {
    regionId: string;
    categories: PlaceCategory[];
    trip: TripParams;
    listVersion: Date;
    excludePlaceIds: string[];
    userId: string;
  }): Promise<DraftRow> {
    const key = poolKey(p);
    const [found] = (await this.db.query(
      `${DRAFT_SELECT}
        WHERE d.pool_key = $1
          AND NOT (d.place_ids && $2::uuid[])
        ORDER BY EXISTS (
                   SELECT 1 FROM user_recommendations ur
                    WHERE ur.user_id = $3 AND ur.draft_id = d.id
                 ) ASC,
                 (d.planner = 'ai') DESC,
                 d.created_at DESC
        LIMIT 1`,
      [key, p.excludePlaceIds, p.userId],
    )) as Array<Record<string, unknown>>;
    if (found) return toDraft(found);

    const input = draftInput(p.regionId, p.categories, p.trip);
    const plan = await this.planner.planTrip(input, {
      excludePlaceIds: p.excludePlaceIds,
      forceHeuristic: true,
    });
    const [row] = (await this.db.query(
      `INSERT INTO itinerary_drafts
         (region_id, pool_key, list_version, categories, days_count, travel_party, pace,
          budget_tier, input, days, unscheduled, warnings, tips, place_ids,
          exclude_place_ids, planner)
       VALUES ($1, $2, $3, $4::place_category[], $5::int, $6, $7, $8, $9::jsonb, $10::jsonb,
               $11::jsonb, $12::jsonb, $13::jsonb, $14::uuid[], $15::uuid[], $16)
       RETURNING id`,
      [
        p.regionId,
        key,
        p.listVersion,
        [...new Set(p.categories)],
        p.trip.daysCount,
        p.trip.travelParty,
        p.trip.pace,
        p.trip.budgetTier,
        JSON.stringify(input),
        JSON.stringify(plan.days),
        JSON.stringify(plan.unscheduled),
        JSON.stringify(plan.warnings),
        JSON.stringify(plan.tips),
        placeIdsOf(plan.days),
        p.excludePlaceIds,
        plan.planner === 'ai' ? 'ai' : 'heuristic',
      ],
    )) as Array<{ id: string }>;
    return (await this.get(row.id))!;
  }

  async get(id: string): Promise<DraftRow | null> {
    const [row] = (await this.db.query(`${DRAFT_SELECT} WHERE d.id = $1`, [
      id,
    ])) as Array<Record<string, unknown>>;
    return row ? toDraft(row) : null;
  }

  /** `fetched_at` của danh sách `ready`; null khi vùng chưa có danh sách dùng được. */
  async listVersion(regionId: string): Promise<Date | null> {
    const [row] = (await this.db.query(
      `SELECT fetched_at FROM region_place_lists WHERE region_id = $1 AND status = 'ready'`,
      [regionId],
    )) as Array<{ fetched_at: Date | null }>;
    return row?.fetched_at ?? null;
  }
}
```

`exclude_place_ids` lưu đúng tập `excludePlaceIds` dùng khi tạo, để `upgrade-draft` loại lại đúng các nơi đó.

- [ ] **Step 6: Viết `theme-catalog.ts`**

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { PlaceCategory, RecommendationThemeKind } from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { FIXED_THEMES } from './themes.js';

export interface ResolvedTheme {
  key: string;
  label: string;
  icon: string;
  kind: RecommendationThemeKind;
  /** Danh mục của chủ đề (chưa gộp sở thích). `default`: chính là sở thích. */
  categories: PlaceCategory[];
  /** null = mọi vùng. */
  regionIds: string[] | null;
  regionHint: string | null;
}

export const DEFAULT_THEME_KEY = 'default';

export function unknownTheme(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: 'UNKNOWN_THEME',
    message: 'Chủ đề này không còn nữa. Hãy chọn chủ đề khác.',
  });
}

/** Chủ đề của một người: "Dành cho bạn", chủ đề riêng còn hạn, chủ đề cố định. */
@Injectable()
export class ThemeCatalog {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** Thứ tự chip: mặc định, chủ đề riêng, chủ đề cố định khớp sở thích, phần còn lại. */
  async list(userId: string, interests: PlaceCategory[]): Promise<ResolvedTheme[]> {
    const personal = (await this.db.query(
      `SELECT t.id, t.label, t.icon, t.categories::text[] AS categories, t.region_ids,
              (SELECT string_agg(r.name, ', ' ORDER BY r.name) FROM regions r WHERE r.id = ANY(t.region_ids)) AS hint
         FROM user_themes t
        WHERE t.user_id = $1 AND t.expires_at > now()
        ORDER BY t.generated_at, t.label`,
      [userId],
    )) as Array<{ id: string; label: string; icon: string; categories: PlaceCategory[]; region_ids: string[]; hint: string | null }>;

    const fixedRegionIds = await this.fixedRegionIds();
    const fixed = FIXED_THEMES.map<ResolvedTheme>((t) => ({
      key: `fixed:${t.key}`,
      label: t.label,
      icon: t.icon,
      kind: 'fixed',
      categories: t.categories,
      regionIds: t.regionSourceKeys ? (fixedRegionIds.get(t.key) ?? []) : null,
      regionHint: null,
    }));
    const matches = (t: ResolvedTheme) => t.categories.some((c) => interests.includes(c));

    return [
      {
        key: DEFAULT_THEME_KEY,
        label: 'Dành cho bạn',
        icon: 'sparkles',
        kind: 'default',
        categories: interests,
        regionIds: null,
        regionHint: null,
      },
      ...personal.map<ResolvedTheme>((t) => ({
        key: `user:${t.id}`,
        label: t.label,
        icon: t.icon,
        kind: 'personal',
        categories: t.categories,
        regionIds: t.region_ids,
        regionHint: t.hint,
      })),
      ...fixed.filter(matches),
      ...fixed.filter((t) => !matches(t)),
    ];
  }

  async resolve(
    userId: string,
    key: string,
    interests: PlaceCategory[],
  ): Promise<ResolvedTheme> {
    const theme = (await this.list(userId, interests)).find((t) => t.key === key);
    if (!theme) throw unknownTheme();
    return theme;
  }

  private async fixedRegionIds(): Promise<Map<string, string[]>> {
    const keys = FIXED_THEMES.flatMap((t) => t.regionSourceKeys ?? []);
    const rows = (await this.db.query(
      `SELECT id, source_key FROM regions WHERE source_key = ANY($1::text[])`,
      [keys],
    )) as Array<{ id: string; source_key: string }>;
    const byKey = new Map(rows.map((r) => [r.source_key, r.id]));
    return new Map(
      FIXED_THEMES.map((t) => [
        t.key,
        (t.regionSourceKeys ?? []).flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : [])),
      ]),
    );
  }
}
```

- [ ] **Step 7: Viết `recommendation-builder.ts`**

```ts
import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { ItineraryInput, PlaceCategory } from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { VisitsService } from '../visits/visits.service.js';
import type { RecommendationReason } from './copy.js';
import { tripBounds, nextSaturday } from './draft-dates.js';
import { DraftPool, type DraftRow } from './draft-pool.js';
import { RecommendationsQueue } from './queue/recommendations-queue.js';
import { minNewPlaces, pickRegions, type RegionStats } from './scoring.js';
import { ThemeCatalog } from './theme-catalog.js';
import { learnTripParams } from './trip-params.js';

/** Số hạng đầu của danh sách vùng được tính là "nơi nổi bật". */
const TOP_RANKS = 60;
/** Số dòng gợi ý gần nhất (trước khung giờ hiện tại) dùng để hạ điểm vùng lặp. */
const RECENT_ROWS = 9;
const CARDS = 3;

/** Vùng được gợi ý: điểm đến du lịch và tỉnh/thành hiện hành (bỏ bản trước sáp nhập, xã/phường). */
const REGION_KIND = `(r.type = 'destination'
  OR (r.type = 'administrative' AND r.level = 'province' AND r.boundary_version = 'current'))`;

/** Tạo bộ 3 gợi ý cho (người dùng, khung giờ, chủ đề) — spec mục "Tạo bộ gợi ý". */
@Injectable()
export class RecommendationBuilder {
  private readonly logger = new Logger(RecommendationBuilder.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly visits: VisitsService,
    private readonly themes: ThemeCatalog,
    private readonly pool: DraftPool,
    private readonly queue: RecommendationsQueue,
  ) {}

  async interests(userId: string): Promise<PlaceCategory[]> {
    const [row] = (await this.db.query(
      `SELECT interests::text[] AS interests FROM users WHERE id = $1`,
      [userId],
    )) as Array<{ interests: PlaceCategory[] }>;
    return row?.interests ?? [];
  }

  async build(userId: string, windowStart: Date, themeKey: string): Promise<number> {
    await this.visits.inferVisits(userId);
    const interests = await this.interests(userId);
    const theme = await this.themes.resolve(userId, themeKey, interests);
    const visited = await this.visits.visitedPlaceIds(userId);
    const inputs = (
      (await this.db.query(
        `SELECT input FROM itineraries WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [userId],
      )) as Array<{ input: ItineraryInput }>
    ).map((r) => r.input);
    const trip = learnTripParams(inputs);
    const categories =
      theme.kind === 'default'
        ? interests
        : [...new Set([...theme.categories, ...interests])];

    const stats = await this.regionStats(userId, visited, categories, theme.regionIds, windowStart);
    const picked = pickRegions(stats, minNewPlaces(trip), CARDS);

    const startDate = nextSaturday(new Date());
    const startsAt = tripBounds(startDate, trip.daysCount).startsAt;
    const rows: Array<{ region: RegionStats & { score: number }; draft: DraftRow; reason: RecommendationReason }> = [];
    for (const region of picked) {
      let draft: DraftRow;
      try {
        draft = await this.pool.findOrCreate({
          regionId: region.regionId,
          categories,
          trip,
          listVersion: region.listVersion,
          excludePlaceIds: visited,
          userId,
        });
      } catch (error) {
        // FR-6.4: vùng không đủ địa điểm hợp đối tượng thì bỏ qua vùng đó.
        if (error instanceof UnprocessableEntityException) continue;
        throw error;
      }
      rows.push({
        region,
        draft,
        reason: {
          matchedInterests: interests.filter((c) => draftCategories(draft).includes(c)),
          newPlaceCount: region.newPlaces,
          revisit: region.visitedAny,
          savedCount: region.savedNew,
        },
      });
    }

    await this.db.transaction(async (m) => {
      await m.query(
        `DELETE FROM user_recommendations WHERE user_id = $1 AND window_start = $2 AND theme_key = $3`,
        [userId, windowStart, themeKey],
      );
      for (const [slot, row] of rows.entries()) {
        await m.query(
          `INSERT INTO user_recommendations
             (user_id, window_start, theme_key, slot, draft_id, region_id, starts_at, params, reason, score)
           VALUES ($1, $2, $3, $4::int, $5, $6, $7, $8::jsonb, $9::jsonb, $10::real)`,
          [
            userId,
            windowStart,
            themeKey,
            slot,
            row.draft.id,
            row.region.regionId,
            startsAt,
            JSON.stringify(trip),
            JSON.stringify(row.reason),
            row.region.score,
          ],
        );
      }
    });

    await this.enqueueMissingImages(rows.map((r) => r.region.regionId));
    this.logger.log(`Gợi ý ${themeKey} cho ${userId}: ${rows.length} thẻ.`);
    return rows.length;
  }

  private async regionStats(
    userId: string,
    visited: string[],
    categories: PlaceCategory[],
    regionIds: string[] | null,
    windowStart: Date,
  ): Promise<RegionStats[]> {
    const rows = (await this.db.query(
      `WITH recent AS (
         SELECT region_id FROM user_recommendations
          WHERE user_id = $1 AND window_start < $5
          ORDER BY created_at DESC LIMIT $6::int
       )
       SELECT r.id, r.name, l.fetched_at AS list_version,
              (SELECT count(*) FROM (
                 SELECT rp.place_id, p.category FROM region_places rp
                   JOIN places p ON p.id = rp.place_id
                  WHERE rp.region_id = r.id
                  ORDER BY rp.rank LIMIT $7::int
               ) top
                WHERE NOT (top.place_id = ANY($2::uuid[]))
                  AND (CASE WHEN cardinality($3::place_category[]) = 0
                            THEN top.category NOT IN ('stay', 'food')
                            ELSE top.category = ANY($3::place_category[]) END)
              )::int AS new_places,
              (SELECT count(*) FROM saved_places s
                WHERE s.user_id = $1 AND s.region_id = r.id
                  AND NOT (s.place_id = ANY($2::uuid[])))::int AS saved_new,
              EXISTS (SELECT 1 FROM region_places rp
                       WHERE rp.region_id = r.id AND rp.place_id = ANY($2::uuid[])) AS visited_any,
              r.id IN (SELECT region_id FROM recent) AS recently_shown
         FROM regions r
         JOIN region_place_lists l ON l.region_id = r.id AND l.status = 'ready' AND l.fetched_at IS NOT NULL
        WHERE ${REGION_KIND}
          AND ($4::uuid[] IS NULL OR r.id = ANY($4::uuid[]))`,
      [userId, visited, categories, regionIds, windowStart, RECENT_ROWS, TOP_RANKS],
    )) as Array<{
      id: string;
      name: string;
      list_version: Date;
      new_places: number;
      saved_new: number;
      visited_any: boolean;
      recently_shown: boolean;
    }>;
    return rows.map((r) => ({
      regionId: r.id,
      regionName: r.name,
      newPlaces: r.new_places,
      savedNew: r.saved_new,
      visitedAny: r.visited_any,
      recentlyShown: r.recently_shown,
      listVersion: r.list_version,
    }));
  }

  private async enqueueMissingImages(regionIds: string[]): Promise<void> {
    if (regionIds.length === 0) return;
    const rows = (await this.db.query(
      `SELECT id FROM unnest($1::uuid[]) AS id
        WHERE NOT EXISTS (SELECT 1 FROM region_images ri WHERE ri.region_id = id)`,
      [regionIds],
    )) as Array<{ id: string }>;
    await this.queue.enqueueMany(
      rows.map((r) => ({ name: 'fetch-region-image' as const, data: { regionId: r.id } })),
    );
  }
}

/** Danh mục điểm tham quan trong bản nháp, nhiều nhất trước. */
export function draftCategories(draft: Pick<DraftRow, 'days'>): PlaceCategory[] {
  const counts = new Map<PlaceCategory, number>();
  for (const item of draft.days.flatMap((d) => d.items)) {
    if (item.kind !== 'visit' || !item.place) continue;
    const c = item.place.category as PlaceCategory;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}
```

Kiểm tra `regions.level` và `regions.type` là enum (`region_type`, `administrative_level`) nên so sánh với chuỗi literal được; `boundary_version` giá trị `'current'`.

- [ ] **Step 8: Nối job `build-user-set` và đăng ký provider**

Trong `recommendation-jobs.ts`:

```ts
import { Injectable } from '@nestjs/common';

import type { JobRunner, RecommendationJob } from './queue/jobs.js';
import { RecommendationBuilder } from './recommendation-builder.js';

@Injectable()
export class RecommendationJobs implements JobRunner {
  constructor(private readonly builder: RecommendationBuilder) {}

  async run(job: RecommendationJob): Promise<unknown> {
    switch (job.name) {
      case 'build-user-set':
        return this.builder.build(
          job.data.userId,
          new Date(job.data.windowStart),
          job.data.themeKey,
        );
      default:
        throw new Error(`Chưa hỗ trợ job ${job.name}`);
    }
  }
}
```

Trong `recommendations.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { ItinerariesModule } from '../itineraries/itineraries.module.js';
import { VisitsModule } from '../visits/visits.module.js';
import { DraftPool } from './draft-pool.js';
import { JOB_RUNNER } from './queue/jobs.js';
import {
  RecommendationsAiProcessor,
  RecommendationsProcessor,
} from './queue/recommendations.processor.js';
import { RecommendationBuilder } from './recommendation-builder.js';
import { RecommendationJobs } from './recommendation-jobs.js';
import { ThemeCatalog } from './theme-catalog.js';

@Module({
  imports: [ItinerariesModule, VisitsModule],
  providers: [
    DraftPool,
    ThemeCatalog,
    RecommendationBuilder,
    RecommendationJobs,
    { provide: JOB_RUNNER, useExisting: RecommendationJobs },
    RecommendationsProcessor,
    RecommendationsAiProcessor,
  ],
  exports: [RecommendationJobs, JOB_RUNNER],
})
export class RecommendationsModule {}
```

- [ ] **Step 9: Chạy test**

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/recommendation-builder.e2e-spec.ts`
Expected: PASS. Nếu ca "vùng đã đi xếp sau" hỏng vì vùng 0 vẫn đứng trên: kiểm tra `newPlaces` các vùng (12 điểm hạng âm + dữ liệu thật, giới hạn 60) — vùng 0 sau × 0,3 phải thấp hơn hai vùng còn lại; nếu dữ liệu thật trong DB dev làm lệch, giảm `TOP_RANKS` **không được**, thay vào đó đổi ca test so sánh `score` thay vì `slot`.

- [ ] **Step 10: Typecheck, lint, commit**

Run: `pnpm --filter @rong/backend typecheck && pnpm --filter @rong/backend lint`

```bash
git add apps/backend/src/modules/places/places.module.ts apps/backend/src/modules/recommendations apps/backend/test/fixtures/recommendation-regions.ts apps/backend/test/recommendation-builder.e2e-spec.ts
git commit -m "feat(backend): build per-user recommendation sets from a shared draft pool"
```

---

### Task 5: API `/recommendations` — feed, xem bản nháp, xem trước, lưu

**Files:**
- Modify: `apps/backend/src/modules/itineraries/itineraries.service.ts` (thêm `createFromPlan`)
- Create: `apps/backend/src/modules/recommendations/dto/feed-query.dto.ts`
- Create: `apps/backend/src/modules/recommendations/dto/preview-draft.dto.ts`
- Create: `apps/backend/src/modules/recommendations/dto/save-draft.dto.ts`
- Create: `apps/backend/src/modules/recommendations/recommendations.service.ts`
- Create: `apps/backend/src/modules/recommendations/recommendations.controller.ts`
- Modify: `apps/backend/src/modules/recommendations/recommendations.module.ts`
- Test: `apps/backend/test/recommendations.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1–4; `ItinerariesService`, `AccessService.requireGroupRole`, `withItineraryPlaceData`.
- Produces:
  ```ts
  // ItinerariesService
  createFromPlan(ownerId: string, p: { input: ItineraryInput; days: ItineraryDay[]; unscheduled: UnscheduledPlace[]; warnings: ItineraryWarning[]; tips: string[]; planner: PlannerKind; groupId: string | null }): Promise<Itinerary /* response */>;
  // RecommendationsService
  feed(userId: string, themeKey: string, retry: boolean): Promise<RecommendationFeed>;
  draft(userId: string, id: string): Promise<ItineraryDraft>;
  preview(userId: string, id: string, req: PreviewDraftRequest): Promise<ItineraryDraft>;
  save(userId: string, id: string, req: SaveDraftRequest): Promise<{ itinerary: Itinerary; created: boolean }>;
  maybeUpgrade(draftId: string): Promise<void>;
  ```
- Routes: `GET /recommendations?theme=&retry=1`, `GET /recommendations/:id`, `POST /recommendations/:id/preview`, `POST /recommendations/:id/save` (201 tạo mới, 200 đã lưu trước đó).

- [ ] **Step 1: Viết test hỏng**

`apps/backend/test/recommendations.e2e-spec.ts`:

```ts
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
import {
  cleanupRecommendationRegions,
  seedRecommendationRegions,
  type FixtureRegion,
} from './fixtures/recommendation-regions.js';

describe('Gợi ý trang chủ (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let jwt: JwtService;
  let queue: RecommendationsQueue;
  let regions: FixtureRegion[];
  const planItinerary = vi.fn();
  const suggestThemes = vi.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LangchainService)
      .useValue({ planItinerary, suggestThemes })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    db = app.get(DataSource);
    jwt = app.get(JwtService);
    queue = app.get(RecommendationsQueue);
    regions = await seedRecommendationRegions(db, 'api');
  });

  afterAll(async () => {
    await queue?.idle();
    await db?.query(`DELETE FROM users WHERE display_name LIKE 'e2e-rec-api%'`);
    await cleanupRecommendationRegions(db, 'api');
    await app?.close();
  });

  const newUser = async (suffix = '') => {
    const [user] = (await db.query(
      `INSERT INTO users (display_name) VALUES ($1) RETURNING id`,
      [`e2e-rec-api${suffix}`],
    )) as Array<{ id: string }>;
    const [theme] = (await db.query(
      `INSERT INTO user_themes (user_id, label, icon, categories, region_ids, expires_at)
       VALUES ($1, 'E2E chủ đề', 'sparkles', '{nature,culture,check_in,cafe,kids}', $2::uuid[], now() + interval '7 days')
       RETURNING id`,
      [user.id, regions.map((r) => r.id)],
    )) as Array<{ id: string }>;
    return { id: user.id, token: jwt.sign({ sub: user.id }), theme: `user:${theme.id}` };
  };

  const api = (token: string) => ({
    get: (path: string) =>
      request(app.getHttpServer()).get(`/api${path}`).set('Authorization', `Bearer ${token}`),
    post: (path: string, body: object) =>
      request(app.getHttpServer()).post(`/api${path}`).set('Authorization', `Bearer ${token}`).send(body),
  });

  /** Gọi feed tới khi `ready` (job chạy trong process). */
  const readyFeed = async (token: string, theme: string) => {
    const first = await api(token).get(`/recommendations?theme=${encodeURIComponent(theme)}`).expect(200);
    if (first.body.status === 'ready') return first.body;
    await queue.idle();
    const second = await api(token).get(`/recommendations?theme=${encodeURIComponent(theme)}`).expect(200);
    expect(second.body.status).toBe('ready');
    return second.body;
  };

  it('lần đầu building, sau đó ready với 3 thẻ; danh sách chủ đề có "Dành cho bạn" đầu tiên', async () => {
    const u = await newUser();
    const first = await api(u.token).get(`/recommendations?theme=${encodeURIComponent(u.theme)}`).expect(200);
    expect(first.body.status).toBe('building');
    expect(first.body.items).toEqual([]);
    expect(first.body.themes[0]).toMatchObject({ key: 'default', kind: 'default' });
    expect(first.body.themes[1]).toMatchObject({ key: u.theme, kind: 'personal' });
    expect(first.body.themes[1].regionHint).toContain('Đà Lạt');

    const feed = await readyFeed(u.token, u.theme);
    expect(feed.items).toHaveLength(3);
    const card = feed.items[0];
    expect(card).toMatchObject({ dayCount: 2, nightCount: 1, estimatedCost: null, weather: null, savedItineraryId: null });
    expect(card.title).toContain('E2E chủ đề');
    expect(card.highlights.length).toBeGreaterThan(0);
    expect(new Date(card.startsAt).getUTCDay()).toBe(6); // 8:00 +07:00 thứ Bảy vẫn là thứ Bảy UTC
    expect(Date.parse(feed.nextRefreshAt)).toBeGreaterThan(Date.parse(feed.windowStart));
    expect(planItinerary).not.toHaveBeenCalled();
  });

  it('xem bản nháp, đổi thông số → bản nháp mới; chỉ đổi ngày → giữ bản nháp', async () => {
    const u = await newUser();
    const feed = await readyFeed(u.token, u.theme);
    const id = feed.items[0].id;

    const draft = await api(u.token).get(`/recommendations/${id}`).expect(200);
    expect(draft.body).toMatchObject({ recommendationId: id, planner: 'heuristic', savedItineraryId: null });
    expect(draft.body.days).toHaveLength(2);
    expect(draft.body.days[0].date).toBe(feed.items[0].startsAt.slice(0, 10));

    const params = { ...draft.body.params };
    const nextWeek = new Date(Date.parse(`${draft.body.days[0].date}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
    const sameDraft = await api(u.token)
      .post(`/recommendations/${id}/preview`, { ...params, startDate: nextWeek })
      .expect(201);
    expect(sameDraft.body.draftId).toBe(draft.body.draftId);
    expect(sameDraft.body.days[0].date).toBe(nextWeek);

    const longer = await api(u.token)
      .post(`/recommendations/${id}/preview`, { ...params, startDate: nextWeek, daysCount: 3, travelParty: 'friends' })
      .expect(201);
    expect(longer.body.draftId).not.toBe(draft.body.draftId);
    expect(longer.body.days).toHaveLength(3);
    expect(longer.body.params).toMatchObject({ daysCount: 3, travelParty: 'friends' });
  });

  it('preview sai thông số → 400, không đổi bản nháp', async () => {
    const u = await newUser();
    const feed = await readyFeed(u.token, u.theme);
    const id = feed.items[0].id;
    const draft = await api(u.token).get(`/recommendations/${id}`).expect(200);
    const base = { ...draft.body.params, startDate: draft.body.days[0].date };

    await api(u.token).post(`/recommendations/${id}/preview`, { ...base, daysCount: 8 }).expect(400);
    await api(u.token).post(`/recommendations/${id}/preview`, { ...base, startDate: '2026-02-30' }).expect(400);
    const past = await api(u.token).post(`/recommendations/${id}/preview`, { ...base, startDate: '2020-01-04' }).expect(400);
    expect(past.body.code).toBe('INVALID_DATES');

    const after = await api(u.token).get(`/recommendations/${id}`).expect(200);
    expect(after.body.draftId).toBe(draft.body.draftId);
  });

  it('lưu: tạo lịch trình (201), không trừ lượt AI; lưu lần hai trả lại lịch trình đó (200)', async () => {
    const u = await newUser();
    const feed = await readyFeed(u.token, u.theme);
    const id = feed.items[1].id;
    const draft = await api(u.token).get(`/recommendations/${id}`).expect(200);

    const saved = await api(u.token).post(`/recommendations/${id}/save`, { draftId: draft.body.draftId }).expect(201);
    expect(saved.body).toMatchObject({ ownerId: u.id, aiEditsRemaining: 3, planner: 'heuristic' });
    expect(saved.body.days[0].date).toBe(draft.body.days[0].date);

    const [{ ai_generations_used }] = (await db.query(
      `SELECT ai_generations_used FROM users WHERE id = $1`,
      [u.id],
    )) as Array<{ ai_generations_used: number }>;
    expect(ai_generations_used).toBe(0);

    const again = await api(u.token).post(`/recommendations/${id}/save`, { draftId: draft.body.draftId }).expect(200);
    expect(again.body.id).toBe(saved.body.id);

    const feedAfter = await api(u.token).get(`/recommendations?theme=${encodeURIComponent(u.theme)}`).expect(200);
    expect(feedAfter.body.items.find((c: { id: string }) => c.id === id).savedItineraryId).toBe(saved.body.id);
  });

  it('lịch trình đã lưu bị xóa → thẻ hết "Đã lưu", lưu lại tạo lịch trình mới', async () => {
    const u = await newUser();
    const feed = await readyFeed(u.token, u.theme);
    const id = feed.items[0].id;
    const draft = await api(u.token).get(`/recommendations/${id}`).expect(200);
    const saved = await api(u.token).post(`/recommendations/${id}/save`, { draftId: draft.body.draftId }).expect(201);
    await request(app.getHttpServer())
      .delete(`/api/itineraries/${saved.body.id}`)
      .set('Authorization', `Bearer ${u.token}`)
      .expect(204);

    const feedAfter = await api(u.token).get(`/recommendations?theme=${encodeURIComponent(u.theme)}`).expect(200);
    expect(feedAfter.body.items.find((c: { id: string }) => c.id === id).savedItineraryId).toBeNull();
    const again = await api(u.token).post(`/recommendations/${id}/save`, { draftId: draft.body.draftId }).expect(201);
    expect(again.body.id).not.toBe(saved.body.id);
  });

  it('draftId cũ → DRAFT_NOT_FOUND; người khác → RECOMMENDATION_NOT_FOUND; chủ đề lạ → UNKNOWN_THEME', async () => {
    const u = await newUser();
    const other = await newUser('-other');
    const feed = await readyFeed(u.token, u.theme);
    const id = feed.items[0].id;

    const wrong = await api(u.token)
      .post(`/recommendations/${id}/save`, { draftId: '00000000-0000-4000-8000-000000000000' })
      .expect(404);
    expect(wrong.body.code).toBe('DRAFT_NOT_FOUND');

    const hidden = await api(other.token).get(`/recommendations/${id}`).expect(404);
    expect(hidden.body.code).toBe('RECOMMENDATION_NOT_FOUND');

    const theme = await api(other.token).get(`/recommendations?theme=${encodeURIComponent(u.theme)}`).expect(400);
    expect(theme.body.code).toBe('UNKNOWN_THEME');
    await api(u.token).get('/recommendations?theme=fixed:khong-co').expect(400);
  });

  it('không đủ vùng → ready rỗng, không kẹt building', async () => {
    const u = await newUser();
    // Chủ đề chỉ gồm danh mục Về đêm: fixture không có điểm nào → mọi vùng bị loại.
    const [row] = (await db.query(
      `INSERT INTO user_themes (user_id, label, icon, categories, region_ids, expires_at)
       VALUES ($1, 'E2E rỗng', 'nightlife', '{nightlife}', $2::uuid[], now() + interval '7 days') RETURNING id`,
      [u.id, regions.map((r) => r.id)],
    )) as Array<{ id: string }>;
    const theme = `user:${row.id}`;
    const feed = await readyFeed(u.token, theme);
    expect(feed.items).toEqual([]);
  });

  it('cập nhật last_seen_at', async () => {
    const u = await newUser();
    await db.query(`UPDATE users SET last_seen_at = now() - interval '2 days' WHERE id = $1`, [u.id]);
    await api(u.token).get(`/recommendations?theme=${encodeURIComponent(u.theme)}`).expect(200);
    const [{ recent }] = (await db.query(
      `SELECT last_seen_at > now() - interval '1 minute' AS recent FROM users WHERE id = $1`,
      [u.id],
    )) as Array<{ recent: boolean }>;
    expect(recent).toBe(true);
    await queue.idle();
  });
});
```

Kiểm tra `DELETE /itineraries/:id` trả 204 (`itineraries.controller.ts:85`); nếu khác, sửa `.expect(...)` cho khớp.

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/recommendations.e2e-spec.ts`
Expected: FAIL, route `/api/recommendations` trả 404.

- [ ] **Step 3: `ItinerariesService.createFromPlan`**

Thêm vào `itineraries.service.ts`, ngay sau `create()`:

```ts
  /**
   * Lưu một lịch đã xếp sẵn (bản nháp gợi ý ở trang chủ). Không trừ lượt AI:
   * bản nháp do hệ thống tạo (spec 2026-10-19-home-recommendations).
   */
  async createFromPlan(
    ownerId: string,
    p: {
      input: ItineraryInput;
      days: ItineraryDay[];
      unscheduled: UnscheduledPlace[];
      warnings: ItineraryWarning[];
      tips: string[];
      planner: PlannerKind;
      groupId: string | null;
    },
  ): Promise<ItineraryResponse> {
    if (p.groupId) await this.access.requireGroupRole(ownerId, p.groupId, 'editor');
    const region = await this.planner.regionName(p.input.regionId);
    const saved = await this.db.transaction(async (m) => {
      const it = await m.save(
        this.itineraries.create({
          ownerId,
          regionId: p.input.regionId,
          groupId: p.groupId,
          planner: p.planner,
          startsAt: new Date(Date.parse(p.input.startsAt)),
          endsAt: new Date(Date.parse(p.input.endsAt)),
          input: p.input,
          days: p.days,
          unscheduled: p.unscheduled,
          warnings: p.warnings,
          tips: p.tips,
        }),
      );
      await this.logToGroup(m, it, ownerId, 'itinerary_added', region);
      return it;
    });
    return this.respond(saved, { isCreator: true, groupRole: null });
  }
```

Thêm lại `PlannerKind`, `UnscheduledPlace` vào import type nếu giai đoạn 1 đã bỏ.

- [ ] **Step 4: DTO**

`dto/feed-query.dto.ts`:

```ts
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class FeedQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  theme?: string;

  /** "1": job lần trước lỗi/không ra gợi ý, chạy lại. */
  @IsOptional()
  @IsIn(['1'])
  retry?: '1';
}
```

`dto/preview-draft.dto.ts`:

```ts
import type { BudgetTier, Pace, TravelParty } from '@rong/shared-types';
import { IsIn, IsInt, IsISO8601, Max, Min } from 'class-validator';

import { MAX_TRIP_DAYS } from '../../itineraries/planning/rules.js';

export class PreviewDraftDto {
  /** "YYYY-MM-DD" theo giờ Việt Nam. */
  @IsISO8601({ strict: true, strictSeparator: true })
  startDate!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_TRIP_DAYS)
  daysCount!: number;

  @IsIn(['friends', 'family_with_kids', 'couple', 'solo', 'with_elderly'])
  travelParty!: TravelParty;

  @IsInt()
  @Min(1)
  @Max(30)
  adults!: number;

  @IsInt()
  @Min(0)
  @Max(30)
  children!: number;

  @IsIn(['relaxed', 'moderate', 'packed'])
  pace!: Pace;

  @IsIn(['budget', 'moderate', 'comfortable'])
  budgetTier!: BudgetTier;
}
```

`IsISO8601({ strict: true })` từ chối `2026-02-30`. Thêm kiểm tra định dạng `^\d{4}-\d{2}-\d{2}$` bằng `@Matches(/^\d{4}-\d{2}-\d{2}$/)` để không nhận chuỗi có giờ.

`dto/save-draft.dto.ts`:

```ts
import { IsOptional, IsUUID } from 'class-validator';

export class SaveDraftDto {
  @IsUUID()
  draftId!: string;

  @IsOptional()
  @IsUUID()
  groupId?: string | null;
}
```

- [ ] **Step 5: `recommendations.service.ts`**

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  Itinerary,
  ItineraryDay,
  ItineraryDraft,
  PlaceCategory,
  PreviewDraftRequest,
  RecommendationCard,
  RecommendationFeed,
  RegionImage,
  SaveDraftRequest,
  TripParams,
} from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { ItinerariesService } from '../itineraries/itineraries.service.js';
import { withItineraryPlaceData } from '../itineraries/itinerary-place-data.js';
import { VisitsService } from '../visits/visits.service.js';
import { cardTitle, reasonText, type RecommendationReason } from './copy.js';
import { shiftPlan, tripBounds, vietnamDate } from './draft-dates.js';
import { DraftPool, type DraftRow } from './draft-pool.js';
import { jobIdOf } from './queue/jobs.js';
import { RecommendationsQueue } from './queue/recommendations-queue.js';
import { draftCategories, RecommendationBuilder } from './recommendation-builder.js';
import {
  DEFAULT_THEME_KEY,
  ThemeCatalog,
  unknownTheme,
  type ResolvedTheme,
} from './theme-catalog.js';
import { windowFor } from './window.js';

const VIEW_UPGRADE_THRESHOLD = 5;
const SAVE_UPGRADE_THRESHOLD = 2;

interface RecRow {
  id: string;
  user_id: string;
  region_id: string;
  region_name: string;
  theme_key: string;
  draft_id: string;
  starts_at: Date;
  params: TripParams;
  reason: RecommendationReason;
  saved_itinerary_id: string | null;
}

const REC_SELECT = `
  SELECT ur.id, ur.user_id, ur.region_id, r.name AS region_name, ur.theme_key, ur.draft_id,
         ur.starts_at, ur.params, ur.reason, ur.saved_itinerary_id
    FROM user_recommendations ur
    JOIN regions r ON r.id = ur.region_id`;

const notFound = () =>
  new NotFoundException({
    statusCode: 404,
    code: 'RECOMMENDATION_NOT_FOUND',
    message: 'Gợi ý này không còn nữa.',
  });

@Injectable()
export class RecommendationsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly themes: ThemeCatalog,
    private readonly builder: RecommendationBuilder,
    private readonly pool: DraftPool,
    private readonly queue: RecommendationsQueue,
    private readonly itineraries: ItinerariesService,
    private readonly visits: VisitsService,
  ) {}

  async feed(userId: string, themeKey = DEFAULT_THEME_KEY, retry = false): Promise<RecommendationFeed> {
    await this.db.query(
      `UPDATE users SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '1 hour'`,
      [userId],
    );
    const { windowStart, nextRefreshAt } = windowFor(new Date());
    const interests = await this.builder.interests(userId);
    const themes = await this.themes.list(userId, interests);
    const theme = themes.find((t) => t.key === themeKey);
    if (!theme) throw unknownTheme();

    const base = {
      windowStart: windowStart.toISOString(),
      nextRefreshAt: nextRefreshAt.toISOString(),
      theme: themeKey,
      themes: themes.map(({ key, label, icon, regionHint, kind }) => ({ key, label, icon, regionHint, kind })),
    };

    const items = await this.cards(userId, windowStart, theme);
    if (items.length > 0) return { ...base, status: 'ready', items };

    const job = {
      name: 'build-user-set' as const,
      data: { userId, windowStart: windowStart.toISOString(), themeKey },
    };
    const jobId = jobIdOf(job)!;
    const state = await this.queue.state(jobId);
    if (state === 'completed' && !retry) return { ...base, status: 'ready', items: [] };
    if (state === 'failed' || (retry && state === 'completed')) await this.queue.remove(jobId);
    if (state !== 'waiting' && state !== 'active') await this.queue.enqueue(job, { priority: 1 });
    return { ...base, status: 'building', items: [] };
  }

  async draft(userId: string, id: string): Promise<ItineraryDraft> {
    const rec = await this.own(userId, id);
    const first = (await this.db.query(
      `UPDATE user_recommendations SET viewed_at = now() WHERE id = $1 AND viewed_at IS NULL RETURNING id`,
      [id],
    )) as unknown[];
    if (first.length > 0) {
      await this.db.query(`UPDATE itinerary_drafts SET view_count = view_count + 1 WHERE id = $1`, [rec.draft_id]);
      await this.maybeUpgrade(rec.draft_id);
    }
    return this.view(rec);
  }

  async preview(userId: string, id: string, req: PreviewDraftRequest): Promise<ItineraryDraft> {
    const rec = await this.own(userId, id);
    if (req.startDate < vietnamDate(new Date())) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_DATES',
        message: 'Ngày đi phải từ hôm nay trở đi.',
      });
    }
    const current = (await this.pool.get(rec.draft_id))!;
    const trip: TripParams = {
      travelParty: req.travelParty,
      adults: req.adults,
      children: req.children,
      pace: req.pace,
      budgetTier: req.budgetTier,
      daysCount: req.daysCount,
    };
    const startsAt = tripBounds(req.startDate, trip.daysCount).startsAt;
    const same =
      current.daysCount === trip.daysCount &&
      current.travelParty === trip.travelParty &&
      current.pace === trip.pace &&
      current.budgetTier === trip.budgetTier;

    let draftId = current.id;
    if (!same) {
      const listVersion = (await this.pool.listVersion(current.regionId)) ?? current.listVersion;
      const next = await this.pool.findOrCreate({
        regionId: current.regionId,
        categories: current.categories,
        trip,
        listVersion,
        excludePlaceIds: await this.visits.visitedPlaceIds(userId),
        userId,
      });
      draftId = next.id;
    }
    await this.db.query(
      `UPDATE user_recommendations SET draft_id = $2, starts_at = $3, params = $4::jsonb WHERE id = $1`,
      [id, draftId, startsAt, JSON.stringify(trip)],
    );
    return this.view(await this.own(userId, id));
  }

  async save(userId: string, id: string, req: SaveDraftRequest): Promise<{ itinerary: Itinerary; created: boolean }> {
    const rec = await this.own(userId, id);
    if (rec.draft_id !== req.draftId) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'DRAFT_NOT_FOUND',
        message: 'Bản nháp đã thay đổi. Tải lại rồi thử lại.',
      });
    }
    if (rec.saved_itinerary_id) {
      return { itinerary: await this.itineraries.get(userId, rec.saved_itinerary_id), created: false };
    }
    const view = await this.view(rec);
    const itinerary = await this.itineraries.createFromPlan(userId, {
      input: view.input,
      days: view.days,
      unscheduled: view.unscheduled,
      warnings: view.warnings,
      tips: view.tips,
      planner: view.planner,
      groupId: req.groupId ?? null,
    });
    await this.db.query(`UPDATE user_recommendations SET saved_itinerary_id = $2 WHERE id = $1`, [id, itinerary.id]);
    await this.db.query(`UPDATE itinerary_drafts SET save_count = save_count + 1 WHERE id = $1`, [rec.draft_id]);
    await this.maybeUpgrade(rec.draft_id);
    return { itinerary, created: true };
  }

  async maybeUpgrade(draftId: string): Promise<void> {
    const [row] = (await this.db.query(
      `SELECT 1 FROM itinerary_drafts
        WHERE id = $1 AND planner = 'heuristic' AND upgraded_at IS NULL
          AND (view_count >= $2::int OR save_count >= $3::int)`,
      [draftId, VIEW_UPGRADE_THRESHOLD, SAVE_UPGRADE_THRESHOLD],
    )) as unknown[];
    if (row) await this.queue.enqueue({ name: 'upgrade-draft', data: { draftId } });
  }

  private async own(userId: string, id: string): Promise<RecRow> {
    const [row] = (await this.db.query(`${REC_SELECT} WHERE ur.id = $1 AND ur.user_id = $2`, [id, userId])) as RecRow[];
    if (!row) throw notFound();
    return row;
  }

  private async view(rec: RecRow): Promise<ItineraryDraft> {
    const draft = (await this.pool.get(rec.draft_id))!;
    const startDate = vietnamDate(rec.starts_at);
    const shifted = shiftPlan(
      { input: { ...draft.input, adults: rec.params.adults, children: rec.params.children }, days: draft.days },
      startDate,
    );
    return {
      recommendationId: rec.id,
      draftId: draft.id,
      regionId: rec.region_id,
      regionName: rec.region_name,
      params: rec.params,
      input: shifted.input,
      days: await withItineraryPlaceData(this.db, shifted.days),
      unscheduled: draft.unscheduled,
      warnings: draft.warnings,
      tips: draft.tips,
      planner: draft.planner,
      savedItineraryId: rec.saved_itinerary_id,
    };
  }

  private async cards(userId: string, windowStart: Date, theme: ResolvedTheme): Promise<RecommendationCard[]> {
    const rows = (await this.db.query(
      `SELECT ur.id, ur.region_id, r.name AS region_name, ur.starts_at, ur.reason, ur.saved_itinerary_id,
              d.days_count, d.days,
              ri.status AS image_status, ri.blocked, ri.url, ri.source, ri.author, ri.author_url, ri.source_url
         FROM user_recommendations ur
         JOIN itinerary_drafts d ON d.id = ur.draft_id
         JOIN regions r ON r.id = ur.region_id
         LEFT JOIN region_images ri ON ri.region_id = ur.region_id
        WHERE ur.user_id = $1 AND ur.window_start = $2 AND ur.theme_key = $3
        ORDER BY ur.slot`,
      [userId, windowStart, theme.key],
    )) as Array<{
      id: string;
      region_id: string;
      region_name: string;
      starts_at: Date;
      reason: RecommendationReason;
      saved_itinerary_id: string | null;
      days_count: number;
      days: ItineraryDay[];
      image_status: 'found' | 'none' | null;
      blocked: boolean | null;
      url: string | null;
      source: 'unsplash' | 'web' | null;
      author: string | null;
      author_url: string | null;
      source_url: string | null;
    }>;
    return rows.map((r) => {
      const visits = r.days.flatMap((d) => d.items).filter((i) => i.kind === 'visit' && i.place);
      const { endsAt } = tripBounds(vietnamDate(r.starts_at), Number(r.days_count));
      const image: RegionImage | null =
        r.image_status === 'found' && !r.blocked && r.url && r.source
          ? { url: r.url, source: r.source, author: r.author, authorUrl: r.author_url, sourceUrl: r.source_url }
          : null;
      return {
        id: r.id,
        regionId: r.region_id,
        regionName: r.region_name,
        title: cardTitle(r.region_name, theme.kind === 'default' ? null : theme.label, draftCategories({ days: r.days })),
        dayCount: Number(r.days_count),
        nightCount: Number(r.days_count) - 1,
        startsAt: r.starts_at.toISOString(),
        endsAt: new Date(Date.parse(endsAt)).toISOString(),
        placeCount: new Set(visits.map((i) => i.placeId)).size,
        highlights: [...new Set(visits.map((i) => i.place!.name))].slice(0, 3),
        reason: reasonText(r.reason),
        revisit: r.reason.revisit,
        image,
        estimatedCost: null,
        weather: null,
        savedItineraryId: r.saved_itinerary_id,
      };
    });
  }
}

```

- [ ] **Step 6: Controller**

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Itinerary, ItineraryDraft, RecommendationFeed } from '@rong/shared-types';
import type { Response } from 'express';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { FeedQueryDto } from './dto/feed-query.dto.js';
import { PreviewDraftDto } from './dto/preview-draft.dto.js';
import { SaveDraftDto } from './dto/save-draft.dto.js';
import { RecommendationsService } from './recommendations.service.js';

@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Get()
  feed(@CurrentUser() user: AuthUser, @Query() q: FeedQueryDto): Promise<RecommendationFeed> {
    return this.recommendations.feed(user.userId, q.theme ?? 'default', q.retry === '1');
  }

  @Get(':id')
  draft(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ItineraryDraft> {
    return this.recommendations.draft(user.userId, id);
  }

  @Post(':id/preview')
  preview(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PreviewDraftDto,
  ): Promise<ItineraryDraft> {
    return this.recommendations.preview(user.userId, id, dto);
  }

  /** 201 khi vừa tạo lịch trình, 200 khi gợi ý này đã được lưu trước đó. */
  @Post(':id/save')
  async save(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveDraftDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Itinerary> {
    const { itinerary, created } = await this.recommendations.save(user.userId, id, dto);
    res.status(created ? 201 : 200);
    return itinerary;
  }
}
```

Kiểm tra `express` có trong dependency backend (`platform-express` kéo theo); nếu lint phàn nàn import kiểu, dùng `import type { Response } from 'express';` như trên.

`ParseUUIDPipe` trả lỗi 400 khi id không phải uuid (giống các route khác dùng nó).

- [ ] **Step 7: Đăng ký vào module**

Trong `recommendations.module.ts`: thêm `controllers: [RecommendationsController]`, thêm `RecommendationsService` vào `providers` và `exports`.

- [ ] **Step 8: Chạy test**

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/recommendations.e2e-spec.ts test/recommendation-builder.e2e-spec.ts test/itinerary.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 9: Typecheck, lint, commit**

Run: `pnpm --filter @rong/backend typecheck && pnpm --filter @rong/backend lint`

```bash
git add apps/backend/src/modules/itineraries/itineraries.service.ts apps/backend/src/modules/recommendations apps/backend/test/recommendations.e2e-spec.ts
git commit -m "feat(backend): serve, preview and save home recommendations"
```

---

### Task 6: Chủ đề riêng do Gemini sinh (`generate-user-themes`)

**Files:**
- Create: `apps/backend/src/chat-models/user-themes-schema.ts`
- Create: `apps/backend/src/chat-models/gemini-user-themes.ts`
- Modify: `apps/backend/src/langchain/langchain.service.ts`, `apps/backend/src/langchain/langchain.module.ts`
- Create: `apps/backend/src/modules/recommendations/theme-generator.ts`
- Modify: `apps/backend/src/modules/recommendations/recommendation-jobs.ts`, `recommendations.module.ts`
- Modify: `apps/backend/src/modules/users/users.controller.ts`
- Modify: `apps/backend/src/modules/visits/visits.controller.ts`
- Test: `apps/backend/test/user-themes.e2e-spec.ts`

**Interfaces:**
- Consumes: `sanitizeThemes` (Task 2), `RecommendationsQueue` (Task 3).
- Produces:
  ```ts
  // LangchainService
  suggestThemes(system: string, request: string): Promise<{ themes: RawTheme[] }>;
  // ThemeGenerator
  generate(userId: string): Promise<number>; // số chủ đề đã lưu
  ```
  Job `generate-user-themes` chạy `ThemeGenerator.generate`.

- [ ] **Step 1: Viết test hỏng**

`apps/backend/test/user-themes.e2e-spec.ts`:

```ts
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
import {
  cleanupRecommendationRegions,
  seedRecommendationRegions,
  type FixtureRegion,
} from './fixtures/recommendation-regions.js';

describe('Chủ đề riêng (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let jwt: JwtService;
  let queue: RecommendationsQueue;
  let regions: FixtureRegion[];
  const planItinerary = vi.fn();
  const suggestThemes = vi.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LangchainService)
      .useValue({ planItinerary, suggestThemes })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    db = app.get(DataSource);
    jwt = app.get(JwtService);
    queue = app.get(RecommendationsQueue);
    regions = await seedRecommendationRegions(db, 'themes');
  });

  afterAll(async () => {
    await queue?.idle();
    await db?.query(`DELETE FROM users WHERE display_name = 'e2e-rec-themes'`);
    await cleanupRecommendationRegions(db, 'themes');
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
```

Ghi chú: ca "Gemini lỗi" ở chế độ trong process không có lượt thử lại (attempts chỉ áp cho BullMQ); job ném lỗi → giữ chủ đề cũ là đúng vì không có dòng nào bị xóa trước khi Gemini trả lời.

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/user-themes.e2e-spec.ts`
Expected: FAIL (`suggestThemes` không được gọi).

- [ ] **Step 3: Schema và model Gemini**

`chat-models/user-themes-schema.ts`:

```ts
import * as z from 'zod';

/** Chủ đề khám phá riêng cho một người — xem modules/recommendations/theme-generator.ts. */
export const UserThemesPlan = z.object({
  themes: z
    .array(
      z.object({
        label: z.string().describe('Tên chủ đề ngắn gọn, gợi cảm hứng, tiếng Việt, dưới 40 ký tự, ví dụ "Xứ sở dừa"'),
        icon: z.string().describe('Một trong: sparkles, forest, sun, cafe, food, culture, nature, kids, nightlife, kayak, motorcycle, explore'),
        categories: z.array(z.string()).describe('Danh mục địa điểm: check_in, food, cafe, nature, kids, culture, nightlife'),
        regionIds: z.array(z.string()).describe('id vùng, chỉ dùng id có trong danh sách được cung cấp'),
      }),
    )
    .describe('Tối đa 3 chủ đề'),
});

export type UserThemesPlanType = z.infer<typeof UserThemesPlan>;
```

`chat-models/gemini-user-themes.ts`:

```ts
import type { Provider } from '@nestjs/common';

import { createGeminiModel } from './gemini-model.factory.js';
import { UserThemesPlan } from './user-themes-schema.js';

export const GEMINI_USER_THEMES_MODEL = 'GEMINI_USER_THEMES_MODEL';

export const GeminiUserThemesProvider: Provider = {
  provide: GEMINI_USER_THEMES_MODEL,
  useFactory: () =>
    createGeminiModel({ thinkingConfig: { thinkingLevel: 'LOW' } }).withStructuredOutput(
      UserThemesPlan,
      { strict: true },
    ),
};
```

Kiểm tra cách `place-search.service.ts:156` truyền `thinkingConfig` và dùng đúng kiểu đó.

- [ ] **Step 4: `LangchainService.suggestThemes`**

Trong `langchain.service.ts`, inject thêm `@Inject(GEMINI_USER_THEMES_MODEL) private readonly userThemesModel: BaseChatModel` và thêm:

```ts
  /** Chủ đề khám phá riêng cho trang chủ; kết quả được kiểm tra lại ở ThemeGenerator. */
  async suggestThemes(system: string, request: string): Promise<UserThemesPlanType> {
    return (await this.userThemesModel.invoke([
      new SystemMessage(system),
      new HumanMessage(request),
    ])) as unknown as UserThemesPlanType;
  }
```

Trong `langchain.module.ts`, thêm `GeminiUserThemesProvider` vào `providers`.

- [ ] **Step 5: `theme-generator.ts`**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { PlaceCategory } from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { LangchainService } from '../../langchain/langchain.service.js';
import { MAX_USER_THEMES, sanitizeThemes, THEME_ICONS } from './themes.js';

const THEME_TTL_DAYS = 7;
const MAX_REGIONS_IN_PROMPT = 80;

const SYSTEM_PROMPT = `Bạn đặt chủ đề khám phá du lịch Việt Nam cho một người dùng.
Mỗi chủ đề gồm tên ngắn gợi cảm hứng (dưới 40 ký tự), một icon, vài danh mục địa điểm và 1–4 vùng phù hợp.
Chỉ dùng id vùng có trong danh sách. Ưu tiên vùng người dùng chưa đến và hợp sở thích. Tối đa ${MAX_USER_THEMES} chủ đề.
Icon hợp lệ: ${THEME_ICONS.join(', ')}.`;

/** Job `generate-user-themes`: Gemini đặt tối đa 3 chủ đề riêng, code kiểm tra rồi thay bộ cũ. */
@Injectable()
export class ThemeGenerator {
  private readonly logger = new Logger(ThemeGenerator.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly langchain: LangchainService,
  ) {}

  async generate(userId: string): Promise<number> {
    const [user] = (await this.db.query(
      `SELECT interests::text[] AS interests FROM users WHERE id = $1`,
      [userId],
    )) as Array<{ interests: PlaceCategory[] }>;
    if (!user) return 0;

    const visitedRegions = (
      (await this.db.query(
        `SELECT DISTINCT r.name FROM visited_places v JOIN regions r ON r.id = v.region_id
          WHERE v.user_id = $1 AND v.status IN ('inferred', 'confirmed') LIMIT 10`,
        [userId],
      )) as Array<{ name: string }>
    ).map((r) => r.name);

    const regions = (await this.db.query(
      `SELECT r.id, r.name,
              (SELECT array_agg(c ORDER BY n DESC) FROM (
                 SELECT p.category::text AS c, count(*) AS n FROM region_places rp
                   JOIN places p ON p.id = rp.place_id
                  WHERE rp.region_id = r.id AND p.category NOT IN ('stay', 'food')
                  GROUP BY p.category ORDER BY n DESC LIMIT 3) t) AS top_categories
         FROM regions r
         JOIN region_place_lists l ON l.region_id = r.id AND l.status = 'ready'
        WHERE r.type = 'destination'
           OR (r.type = 'administrative' AND r.level = 'province' AND r.boundary_version = 'current')
        ORDER BY r.name
        LIMIT $1::int`,
      [MAX_REGIONS_IN_PROMPT],
    )) as Array<{ id: string; name: string; top_categories: string[] | null }>;
    if (regions.length === 0) return 0;

    const request = JSON.stringify({
      interests: user.interests,
      visitedRegions,
      regions: regions.map((r) => ({ id: r.id, name: r.name, categories: r.top_categories ?? [] })),
    });
    // Lỗi Gemini ném ra ngoài: BullMQ thử lại; hết lượt thì chủ đề cũ vẫn còn.
    const result = await this.langchain.suggestThemes(SYSTEM_PROMPT, request);
    const themes = sanitizeThemes(result.themes ?? [], new Set(regions.map((r) => r.id)));

    await this.db.transaction(async (m) => {
      await m.query(`DELETE FROM user_themes WHERE user_id = $1`, [userId]);
      for (const t of themes) {
        await m.query(
          `INSERT INTO user_themes (user_id, label, icon, categories, region_ids, expires_at)
           VALUES ($1, $2, $3, $4::place_category[], $5::uuid[], now() + $6::int * interval '1 day')`,
          [userId, t.label, t.icon, t.categories, t.regionIds, THEME_TTL_DAYS],
        );
      }
    });
    this.logger.log(`Chủ đề riêng cho ${userId}: ${themes.length}.`);
    return themes.length;
  }
}
```

- [ ] **Step 6: Nối job và nơi kích hoạt**

`recommendation-jobs.ts`: inject `ThemeGenerator`, thêm nhánh:

```ts
      case 'generate-user-themes':
        return this.themes.generate(job.data.userId);
```

`recommendations.module.ts`: thêm `LangchainModule` vào `imports`, `ThemeGenerator` vào `providers`.

`users.controller.ts`:

```ts
import { RecommendationsQueue } from '../recommendations/queue/recommendations-queue.js';
```

```ts
  constructor(
    private readonly users: UsersService,
    private readonly recommendations: RecommendationsQueue,
  ) {}
```

```ts
  @Patch('me')
  async update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfile> {
    const { profile, interestsChanged } = await this.users.updateProfile(user.userId, dto);
    if (interestsChanged) {
      await this.recommendations.enqueue({
        name: 'generate-user-themes',
        data: { userId: user.userId },
      });
    }
    return profile;
  }
```

`visits.controller.ts` — sau `review`:

```ts
  @Post('review')
  @HttpCode(HttpStatus.NO_CONTENT)
  async review(
    @CurrentUser() user: AuthUser,
    @Body() dto: ReviewVisitsDto,
  ): Promise<void> {
    await this.visits.review(user.userId, dto.itineraryId, dto.visitedPlaceIds);
    await this.recommendations.enqueue({
      name: 'generate-user-themes',
      data: { userId: user.userId },
    });
  }
```

(inject `RecommendationsQueue` vào constructor như `UsersController`). `RecommendationsQueueModule` là global nên không cần import thêm module.

Job id `themes_<user>_<ngày>` chống trùng trong ngày: đổi sở thích nhiều lần trong một ngày chỉ sinh một lần. Ở chế độ trong process, test ca 1 và ca 2 dùng hai người khác nhau nên không đụng nhau.

- [ ] **Step 7: Chạy test**

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/user-themes.e2e-spec.ts test/account.e2e-spec.ts test/visits.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck, lint, commit**

Run: `pnpm --filter @rong/backend typecheck && pnpm --filter @rong/backend lint`

```bash
git add apps/backend/src/chat-models apps/backend/src/langchain apps/backend/src/modules/recommendations apps/backend/src/modules/users/users.controller.ts apps/backend/src/modules/visits/visits.controller.ts apps/backend/test/user-themes.e2e-spec.ts
git commit -m "feat(backend): generate personal recommendation themes with Gemini"
```

---

### Task 7: Ảnh vùng (`fetch-region-image`)

**Files:**
- Create: `apps/backend/src/modules/recommendations/unsplash.client.ts`
- Create: `apps/backend/src/modules/recommendations/region-images.ts`
- Modify: `apps/backend/src/modules/recommendations/recommendation-jobs.ts`, `recommendations.module.ts`
- Test: `apps/backend/src/modules/recommendations/unsplash.client.spec.ts`
- Test: `apps/backend/test/region-images.e2e-spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export const UNSPLASH_FETCH = 'UNSPLASH_FETCH';
  export interface UnsplashPhoto { url: string; width: number; height: number; author: string; authorUrl: string; pageUrl: string }
  @Injectable() export class UnsplashClient { readonly enabled: boolean; searchLandscape(query: string): Promise<UnsplashPhoto | null> }
  @Injectable() export class RegionImages { fetch(regionId: string): Promise<'found' | 'none' | 'skipped'> }
  ```

- [ ] **Step 1: Viết test hỏng — client**

`unsplash.client.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { UnsplashClient } from './unsplash.client.js';

const photo = {
  width: 4000,
  height: 2600,
  urls: { regular: 'https://images.unsplash.com/photo-1?w=1080' },
  links: { html: 'https://unsplash.com/photos/abc', download_location: 'https://api.unsplash.com/photos/abc/download' },
  user: { name: 'Nguyễn A', links: { html: 'https://unsplash.com/@nguyena' } },
};

describe('UnsplashClient', () => {
  it('lấy ảnh ngang đầu tiên và báo lượt tải theo điều khoản API', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [photo] }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const client = new UnsplashClient({ unsplashAccessKey: 'key', queueEnabled: false }, fetchImpl);

    const result = await client.searchLandscape('Đà Lạt Vietnam');
    expect(result).toEqual({
      url: 'https://images.unsplash.com/photo-1?w=1080',
      width: 4000,
      height: 2600,
      author: 'Nguyễn A',
      authorUrl: 'https://unsplash.com/@nguyena?utm_source=rong&utm_medium=referral',
      pageUrl: 'https://unsplash.com/photos/abc?utm_source=rong&utm_medium=referral',
    });
    const [searchUrl, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(searchUrl).toContain('orientation=landscape');
    expect(searchUrl).toContain(encodeURIComponent('Đà Lạt Vietnam'));
    expect((init.headers as Record<string, string>).Authorization).toBe('Client-ID key');
    expect(fetchImpl.mock.calls[1][0]).toBe(photo.links.download_location);
  });

  it('không có kết quả → null; không có key → không gọi', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    expect(
      await new UnsplashClient({ unsplashAccessKey: 'key', queueEnabled: false }, fetchImpl).searchLandscape('x'),
    ).toBeNull();
    const none = vi.fn();
    const disabled = new UnsplashClient({ unsplashAccessKey: null, queueEnabled: false }, none);
    expect(disabled.enabled).toBe(false);
    expect(await disabled.searchLandscape('x')).toBeNull();
    expect(none).not.toHaveBeenCalled();
  });

  it('HTTP lỗi → ném lỗi để job thử lại', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('rate limited', { status: 403 }));
    await expect(
      new UnsplashClient({ unsplashAccessKey: 'key', queueEnabled: false }, fetchImpl).searchLandscape('x'),
    ).rejects.toThrow('403');
  });
});
```

- [ ] **Step 2: Viết test hỏng — e2e fallback**

`apps/backend/test/region-images.e2e-spec.ts`:

```ts
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
```

- [ ] **Step 3: Chạy để thấy hỏng**

Run: `cd apps/backend && npx vitest run src/modules/recommendations/unsplash.client.spec.ts && npx vitest run --config vitest.config.e2e.ts test/region-images.e2e-spec.ts`
Expected: FAIL, module chưa có.

- [ ] **Step 4: `unsplash.client.ts`**

```ts
import { Inject, Injectable, Optional } from '@nestjs/common';

import type { RecommendationsConfig } from '../../config/configuration.js';

export const RECOMMENDATIONS_CONFIG = 'RECOMMENDATIONS_CONFIG';
export const UNSPLASH_FETCH = 'UNSPLASH_FETCH';

const SEARCH_URL = 'https://api.unsplash.com/search/photos';
const TIMEOUT_MS = 10_000;
/** Unsplash yêu cầu link về tác giả và ảnh kèm UTM của ứng dụng. */
const UTM = 'utm_source=rong&utm_medium=referral';

export interface UnsplashPhoto {
  url: string;
  width: number;
  height: number;
  author: string;
  authorUrl: string;
  pageUrl: string;
}

const withUtm = (url: string) => `${url}${url.includes('?') ? '&' : '?'}${UTM}`;

/** Cổng duy nhất tới Unsplash API (ảnh vùng cho thẻ gợi ý). */
@Injectable()
export class UnsplashClient {
  constructor(
    @Inject(RECOMMENDATIONS_CONFIG) private readonly config: RecommendationsConfig,
    @Optional() @Inject(UNSPLASH_FETCH) private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get enabled(): boolean {
    return !!this.config.unsplashAccessKey;
  }

  async searchLandscape(query: string): Promise<UnsplashPhoto | null> {
    if (!this.enabled) return null;
    const headers = { Authorization: `Client-ID ${this.config.unsplashAccessKey}` };
    const params = new URLSearchParams({ query, orientation: 'landscape', per_page: '1' });
    const res = await this.fetchImpl(`${SEARCH_URL}?${params}`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Unsplash trả HTTP ${res.status}`);
    const body = (await res.json()) as {
      results?: Array<{
        width: number;
        height: number;
        urls: { regular: string };
        links: { html: string; download_location: string };
        user: { name: string; links: { html: string } };
      }>;
    };
    const photo = body.results?.[0];
    if (!photo) return null;
    // Điều khoản API: báo một lượt "tải" khi ảnh được dùng.
    await this.fetchImpl(photo.links.download_location, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => undefined);
    return {
      url: photo.urls.regular,
      width: photo.width,
      height: photo.height,
      author: photo.user.name,
      authorUrl: withUtm(photo.user.links.html),
      pageUrl: withUtm(photo.links.html),
    };
  }
}
```

Unit test tạo client bằng `new UnsplashClient(config, fetchImpl)`; Nest dùng `fetch` toàn cục khi không có `UNSPLASH_FETCH`.

- [ ] **Step 5: `region-images.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { PlaceImage } from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { UnsplashClient } from './unsplash.client.js';

/** Vùng đã tìm mà không có ảnh: tìm lại sau chừng này ngày. */
const RETRY_NONE_DAYS = 30;

/** Ảnh cho thẻ gợi ý: Unsplash → ảnh địa điểm hạng cao nhất (bài viết, có nguồn) → không có. */
@Injectable()
export class RegionImages {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly unsplash: UnsplashClient,
  ) {}

  async fetch(regionId: string): Promise<'found' | 'none' | 'skipped'> {
    const [existing] = (await this.db.query(
      `SELECT status, fetched_at > now() - $2::int * interval '1 day' AS fresh
         FROM region_images WHERE region_id = $1`,
      [regionId, RETRY_NONE_DAYS],
    )) as Array<{ status: 'found' | 'none'; fresh: boolean }>;
    if (existing && (existing.status === 'found' || existing.fresh)) return 'skipped';

    const [region] = (await this.db.query(`SELECT name FROM regions WHERE id = $1`, [regionId])) as Array<{ name: string }>;
    if (!region) return 'skipped';

    const photo = await this.unsplash.searchLandscape(`${region.name} Vietnam`);
    if (photo) {
      await this.upsert(regionId, {
        status: 'found',
        url: photo.url,
        width: photo.width,
        height: photo.height,
        source: 'unsplash',
        author: photo.author,
        author_url: photo.authorUrl,
        source_url: photo.pageUrl,
        license: 'Unsplash License',
      });
      return 'found';
    }

    const [article] = (await this.db.query(
      `SELECT image FROM region_places WHERE region_id = $1 AND image IS NOT NULL ORDER BY rank LIMIT 1`,
      [regionId],
    )) as Array<{ image: PlaceImage }>;
    if (article?.image?.url) {
      await this.upsert(regionId, {
        status: 'found',
        url: article.image.url,
        source: 'web',
        source_url: article.image.sourceUrl,
      });
      return 'found';
    }

    await this.upsert(regionId, { status: 'none' });
    return 'none';
  }

  private async upsert(
    regionId: string,
    v: {
      status: 'found' | 'none';
      url?: string;
      width?: number;
      height?: number;
      source?: 'unsplash' | 'web';
      author?: string;
      author_url?: string;
      source_url?: string;
      license?: string;
    },
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO region_images (region_id, status, url, width, height, source, author, author_url, source_url, license, fetched_at)
       VALUES ($1, $2, $3, $4::int, $5::int, $6, $7, $8, $9, $10, now())
       ON CONFLICT (region_id) DO UPDATE SET
         status = EXCLUDED.status, url = EXCLUDED.url, width = EXCLUDED.width, height = EXCLUDED.height,
         source = EXCLUDED.source, author = EXCLUDED.author, author_url = EXCLUDED.author_url,
         source_url = EXCLUDED.source_url, license = EXCLUDED.license, fetched_at = now()
       WHERE region_images.blocked = false`,
      [
        regionId,
        v.status,
        v.url ?? null,
        v.width ?? null,
        v.height ?? null,
        v.source ?? null,
        v.author ?? null,
        v.author_url ?? null,
        v.source_url ?? null,
        v.license ?? null,
      ],
    );
  }
}
```

`WHERE region_images.blocked = false`: ảnh đã bị gỡ vì khiếu nại thì job không ghi đè; muốn đổi ảnh, quản trị viên sửa tay dòng đó.

`PlaceImage` có trong `@rong/shared-types` (`place.ts:90`).

- [ ] **Step 6: Nối job, provider config**

`recommendations.module.ts` — thêm vào `providers`:

```ts
    UnsplashClient,
    RegionImages,
    {
      provide: RECOMMENDATIONS_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<AppConfig['recommendations']>('recommendations'),
    },
```

(import `ConfigService` từ `@nestjs/config`, `AppConfig` type từ `../../config/configuration.js`, `RECOMMENDATIONS_CONFIG` từ `./unsplash.client.js`).

`recommendation-jobs.ts`: inject `RegionImages`, thêm nhánh:

```ts
      case 'fetch-region-image':
        return this.images.fetch(job.data.regionId);
```

- [ ] **Step 7: Chạy test**

Run: `cd apps/backend && npx vitest run src/modules/recommendations && npx vitest run --config vitest.config.e2e.ts test/region-images.e2e-spec.ts test/recommendations.e2e-spec.ts`
Expected: PASS. (Ở `recommendations.e2e-spec.ts`, job ảnh chạy thật với `UnsplashClient` không có key: dùng ảnh bài viết hoặc `none`, không gọi mạng.)

Lưu ý: nếu `apps/backend/.env` của máy có `UNSPLASH_ACCESS_KEY`, e2e `recommendations.e2e-spec.ts` sẽ gọi Unsplash thật. Thêm `.overrideProvider(UnsplashClient).useValue({ enabled: false, searchLandscape: async () => null })` vào `beforeAll` của `recommendations.e2e-spec.ts`, `recommendation-builder.e2e-spec.ts` và `user-themes.e2e-spec.ts`.

- [ ] **Step 8: Typecheck, lint, commit**

Run: `pnpm --filter @rong/backend typecheck && pnpm --filter @rong/backend lint`

```bash
git add apps/backend/src/modules/recommendations apps/backend/test
git commit -m "feat(backend): fetch region images from Unsplash or article photos"
```

---

### Task 8: Job theo lịch và nâng cấp bản nháp

**Files:**
- Create: `apps/backend/src/modules/recommendations/maintenance.ts`
- Modify: `apps/backend/src/modules/recommendations/recommendation-jobs.ts`, `recommendations.module.ts`
- Modify: `apps/backend/src/modules/recommendations/recommendation-jobs.ts` (bỏ nhánh `default` ném lỗi: mọi job đã có nhánh)
- Test: `apps/backend/test/recommendation-maintenance.e2e-spec.ts`

**Interfaces:**
- Produces:
  ```ts
  @Injectable() export class RecommendationMaintenance {
    refreshWindow(now?: Date): Promise<number>;   // số job build đã đẩy
    refreshThemes(): Promise<number>;             // số job themes đã đẩy
    warmFeaturedRegions(): Promise<number>;       // số vùng đã gọi tạo danh sách
    cleanup(): Promise<{ recommendations: number; drafts: number; themes: number }>;
    upgradeDraft(draftId: string): Promise<boolean>;
  }
  ```

- [ ] **Step 1: Viết test hỏng**

`apps/backend/test/recommendation-maintenance.e2e-spec.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { LangchainService } from '../src/langchain/langchain.service.js';
import { RecommendationMaintenance } from '../src/modules/recommendations/maintenance.js';
import { RecommendationsQueue } from '../src/modules/recommendations/queue/recommendations-queue.js';
import { RecommendationBuilder } from '../src/modules/recommendations/recommendation-builder.js';
import { UnsplashClient } from '../src/modules/recommendations/unsplash.client.js';
import { windowFor } from '../src/modules/recommendations/window.js';
import {
  cleanupRecommendationRegions,
  seedRecommendationRegions,
  type FixtureRegion,
} from './fixtures/recommendation-regions.js';

describe('Job theo lịch (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let jobs: RecommendationMaintenance;
  let queue: RecommendationsQueue;
  let builder: RecommendationBuilder;
  let regions: FixtureRegion[];
  const planItinerary = vi.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LangchainService)
      .useValue({ planItinerary, suggestThemes: vi.fn().mockResolvedValue({ themes: [] }) })
      .overrideProvider(UnsplashClient)
      .useValue({ enabled: false, searchLandscape: async () => null })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DataSource);
    jobs = app.get(RecommendationMaintenance);
    queue = app.get(RecommendationsQueue);
    builder = app.get(RecommendationBuilder);
    regions = await seedRecommendationRegions(db, 'maint');
  });

  afterAll(async () => {
    await queue?.idle();
    await db?.query(`DELETE FROM users WHERE display_name LIKE 'e2e-rec-maint%'`);
    await cleanupRecommendationRegions(db, 'maint');
    await app?.close();
  });

  const newUser = async (lastSeen: string) => {
    const [u] = (await db.query(
      `INSERT INTO users (display_name, last_seen_at) VALUES ('e2e-rec-maint', now() - $1::interval) RETURNING id`,
      [lastSeen],
    )) as Array<{ id: string }>;
    const [t] = (await db.query(
      `INSERT INTO user_themes (user_id, label, icon, categories, region_ids, expires_at)
       VALUES ($1, 'E2E', 'sparkles', '{nature,culture,check_in,cafe,kids}', $2::uuid[], now() + interval '7 days') RETURNING id`,
      [u.id, regions.map((r) => r.id)],
    )) as Array<{ id: string }>;
    return { id: u.id, theme: `user:${t.id}` };
  };

  it('refresh-window chỉ đẩy job cho người dùng hoạt động trong 14 ngày', async () => {
    const active = await newUser('1 day');
    const idle = await newUser('20 days');
    const spy = vi.spyOn(queue, 'enqueueMany');
    await jobs.refreshWindow();
    const pushed = spy.mock.calls.flatMap(([batch]) => batch);
    spy.mockRestore();
    const users = pushed.map((j) => (j.data as { userId: string }).userId);
    expect(users).toContain(active.id);
    expect(users).not.toContain(idle.id);
    expect(pushed.every((j) => j.name === 'build-user-set')).toBe(true);
    await queue.idle();
  });

  it('upgrade-draft: Gemini thành công → planner ai, giữ loại trừ', async () => {
    const u = await newUser('1 hour');
    const { windowStart } = windowFor(new Date());
    await builder.build(u.id, windowStart, u.theme);
    const [{ draft_id }] = (await db.query(
      `SELECT draft_id FROM user_recommendations WHERE user_id = $1 ORDER BY slot LIMIT 1`,
      [u.id],
    )) as Array<{ draft_id: string }>;

    // Gemini giả: giữ nguyên các điểm được giao, thứ tự như gửi.
    planItinerary.mockImplementationOnce(async (_s: string, req: string) => {
      const offered = JSON.parse(req.split('\n').at(-1)!) as Array<{ id: string; required: boolean; day?: number }>;
      return {
        days: [0, 1].map((dayIndex) => ({
          dayIndex,
          stops: offered
            .filter((o) => o.required && (o.day ?? 0) === dayIndex)
            .map((o) => ({ placeId: o.id, visitMinutes: 60, reason: 'Đẹp', openingHours: '' })),
        })),
        tips: ['Mang áo khoác'],
      };
    });
    expect(await jobs.upgradeDraft(draft_id)).toBe(true);
    const [draft] = (await db.query(
      `SELECT planner, upgraded_at, tips FROM itinerary_drafts WHERE id = $1`,
      [draft_id],
    )) as Array<{ planner: string; upgraded_at: Date | null; tips: string[] }>;
    expect(draft.planner).toBe('ai');
    expect(draft.upgraded_at).not.toBeNull();
    // Đã nâng cấp thì không chạy lại.
    expect(await jobs.upgradeDraft(draft_id)).toBe(false);
  });

  it('cleanup xóa gợi ý cũ hơn 30 ngày và chủ đề hết hạn', async () => {
    const u = await newUser('1 hour');
    const { windowStart } = windowFor(new Date());
    await builder.build(u.id, windowStart, u.theme);
    await db.query(
      `UPDATE user_recommendations SET created_at = now() - interval '31 days' WHERE user_id = $1`,
      [u.id],
    );
    await db.query(`UPDATE user_themes SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [u.id]);
    const result = await jobs.cleanup();
    expect(result.recommendations).toBeGreaterThanOrEqual(3);
    expect(result.themes).toBeGreaterThanOrEqual(1);
    const left = (await db.query(`SELECT 1 FROM user_recommendations WHERE user_id = $1`, [u.id])) as unknown[];
    expect(left).toHaveLength(0);
  });
});
```

Trước khi viết mock Gemini ở ca `upgrade-draft`, đọc `buildPlannerRequest` trong `itineraries/ai-planner.ts` để biết định dạng dòng JSON cuối của request (tên trường id/required/ngày) và sửa phần `offered` cho khớp. Ca `'AI xếp lịch: …'` trong `test/itinerary.e2e-spec.ts` là mẫu đã chạy được.

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/recommendation-maintenance.e2e-spec.ts`
Expected: FAIL, không resolve được `maintenance.js`.

- [ ] **Step 3: `maintenance.ts`**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ItineraryPlanner } from '../itineraries/itinerary-planner.js';
import { WebPlacesService } from '../places/web-places.service.js';
import { DraftPool, placeIdsOf } from './draft-pool.js';
import { RecommendationsQueue } from './queue/recommendations-queue.js';
import { FEATURED_REGION_SOURCE_KEYS } from './themes.js';
import { windowFor } from './window.js';

const ACTIVE_DAYS = 14;
const BATCH = 500;
const KEEP_RECOMMENDATIONS_DAYS = 30;

/** Các job theo lịch (spec mục "Các job") và nâng cấp bản nháp bằng Gemini. */
@Injectable()
export class RecommendationMaintenance {
  private readonly logger = new Logger(RecommendationMaintenance.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly queue: RecommendationsQueue,
    private readonly pool: DraftPool,
    private readonly planner: ItineraryPlanner,
    private readonly webPlaces: WebPlacesService,
  ) {}

  /** 6:00 và 15:00: đẩy `build-user-set` (chủ đề mặc định, ưu tiên thấp) cho người dùng hoạt động. */
  async refreshWindow(now = new Date()): Promise<number> {
    const { windowStart } = windowFor(now);
    const users = await this.activeUsers();
    for (let i = 0; i < users.length; i += BATCH) {
      await this.queue.enqueueMany(
        users.slice(i, i + BATCH).map((userId) => ({
          name: 'build-user-set' as const,
          data: { userId, windowStart: windowStart.toISOString(), themeKey: 'default' },
        })),
        { priority: 10 },
      );
    }
    this.logger.log(`Làm mới gợi ý: ${users.length} người dùng.`);
    return users.length;
  }

  /** Thứ Hai 3:00: sinh lại chủ đề riêng cho người dùng hoạt động. */
  async refreshThemes(): Promise<number> {
    const users = await this.activeUsers();
    for (let i = 0; i < users.length; i += BATCH) {
      await this.queue.enqueueMany(
        users.slice(i, i + BATCH).map((userId) => ({
          name: 'generate-user-themes' as const,
          data: { userId },
        })),
        { priority: 10 },
      );
    }
    return users.length;
  }

  /** 2:00: vùng nổi bật chưa có danh sách hoặc quá hạn thì tạo, lần lượt từng vùng. */
  async warmFeaturedRegions(): Promise<number> {
    const rows = (await this.db.query(
      `SELECT r.id, r.name FROM regions r
         LEFT JOIN region_place_lists l ON l.region_id = r.id
        WHERE r.source_key = ANY($1::text[])
          AND (l.region_id IS NULL OR l.status <> 'ready' OR l.expires_at <= now())`,
      [FEATURED_REGION_SOURCE_KEYS],
    )) as Array<{ id: string; name: string }>;
    for (const region of rows) {
      try {
        await this.webPlaces.listForRegion(region.id, undefined);
      } catch (error) {
        this.logger.warn(`Không tạo được danh sách ${region.name}: ${(error as Error).message}`);
      }
    }
    return rows.length;
  }

  /** 4:30: dọn gợi ý cũ, bản nháp hết phiên bản không còn ai trỏ tới, chủ đề hết hạn. */
  async cleanup(): Promise<{ recommendations: number; drafts: number; themes: number }> {
    const recs = (await this.db.query(
      `DELETE FROM user_recommendations WHERE created_at < now() - $1::int * interval '1 day' RETURNING id`,
      [KEEP_RECOMMENDATIONS_DAYS],
    )) as unknown[];
    const drafts = (await this.db.query(
      `DELETE FROM itinerary_drafts d
        USING region_place_lists l
        WHERE l.region_id = d.region_id
          AND l.fetched_at IS NOT NULL AND d.list_version < l.fetched_at
          AND NOT EXISTS (SELECT 1 FROM user_recommendations ur WHERE ur.draft_id = d.id)
        RETURNING d.id`,
    )) as unknown[];
    const themes = (await this.db.query(
      `DELETE FROM user_themes WHERE expires_at < now() RETURNING id`,
    )) as unknown[];
    return { recommendations: recs.length, drafts: drafts.length, themes: themes.length };
  }

  /** Xếp lại bằng Gemini; false khi không cần (đã là `ai`) hoặc bản nháp không còn. Gemini lỗi thì ném để BullMQ thử lại. */
  async upgradeDraft(draftId: string): Promise<boolean> {
    const draft = await this.pool.get(draftId);
    if (!draft || draft.planner === 'ai' || draft.upgradedAt) return false;
    const plan = await this.planner.planTrip(draft.input, {
      excludePlaceIds: draft.excludePlaceIds,
    });
    if (plan.planner !== 'ai') throw new Error('Gemini không xếp được bản nháp');
    await this.db.query(
      `UPDATE itinerary_drafts
          SET days = $2::jsonb, unscheduled = $3::jsonb, warnings = $4::jsonb, tips = $5::jsonb,
              place_ids = $6::uuid[], planner = 'ai', upgraded_at = now()
        WHERE id = $1`,
      [
        draftId,
        JSON.stringify(plan.days),
        JSON.stringify(plan.unscheduled),
        JSON.stringify(plan.warnings),
        JSON.stringify(plan.tips),
        placeIdsOf(plan.days),
      ],
    );
    return true;
  }

  private async activeUsers(): Promise<string[]> {
    const rows = (await this.db.query(
      `SELECT id FROM users WHERE is_guest = false AND last_seen_at > now() - $1::int * interval '1 day'`,
      [ACTIVE_DAYS],
    )) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }
}
```

Ghi chú: `planTrip` đã đảm bảo mọi địa điểm có trong DB (FR-6.3) và không chứa `excludePlaceIds`, nên không cần kiểm tra thêm "chỉ địa điểm trong pool vùng" như bảng job của spec ghi.

- [ ] **Step 4: Nối mọi job**

`recommendation-jobs.ts` cuối cùng:

```ts
import { Injectable } from '@nestjs/common';

import { RecommendationMaintenance } from './maintenance.js';
import type { JobRunner, RecommendationJob } from './queue/jobs.js';
import { RecommendationBuilder } from './recommendation-builder.js';
import { RegionImages } from './region-images.js';
import { ThemeGenerator } from './theme-generator.js';

/** Chạy một job gợi ý; dùng chung cho worker BullMQ và chế độ chạy trong process. */
@Injectable()
export class RecommendationJobs implements JobRunner {
  constructor(
    private readonly builder: RecommendationBuilder,
    private readonly themes: ThemeGenerator,
    private readonly images: RegionImages,
    private readonly maintenance: RecommendationMaintenance,
  ) {}

  async run(job: RecommendationJob): Promise<unknown> {
    switch (job.name) {
      case 'build-user-set':
        return this.builder.build(job.data.userId, new Date(job.data.windowStart), job.data.themeKey);
      case 'generate-user-themes':
        return this.themes.generate(job.data.userId);
      case 'fetch-region-image':
        return this.images.fetch(job.data.regionId);
      case 'upgrade-draft':
        return this.maintenance.upgradeDraft(job.data.draftId);
      case 'refresh-window':
        return this.maintenance.refreshWindow();
      case 'refresh-themes':
        return this.maintenance.refreshThemes();
      case 'warm-featured-regions':
        return this.maintenance.warmFeaturedRegions();
      case 'cleanup':
        return this.maintenance.cleanup();
    }
  }
}
```

`recommendations.module.ts`: thêm `PlacesModule` vào `imports`, `RecommendationMaintenance` vào `providers` và `exports`.

- [ ] **Step 5: Chạy toàn bộ test giai đoạn 2**

Run: `cd apps/backend && npx vitest run src/modules/recommendations && npx vitest run --config vitest.config.e2e.ts test/recommendation-maintenance.e2e-spec.ts test/recommendations.e2e-spec.ts test/recommendation-builder.e2e-spec.ts test/user-themes.e2e-spec.ts test/region-images.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 6: Chạy toàn bộ test backend**

Run: `pnpm --filter @rong/backend test && pnpm --filter @rong/backend test:e2e`
Expected: PASS. Bỏ qua `*.live-spec.ts` (không nằm trong `include` của `vitest.config.e2e.ts`).

- [ ] **Step 7: Typecheck, lint, commit**

Run: `pnpm --filter @rong/backend typecheck && pnpm --filter @rong/backend lint`

```bash
git add apps/backend/src/modules/recommendations apps/backend/test/recommendation-maintenance.e2e-spec.ts
git commit -m "feat(backend): add scheduled recommendation jobs and Gemini draft upgrades"
```

---

### Task 9: Kiểm tra với Redis thật, tài liệu

**Files:**
- Create: `apps/backend/scripts/enqueue-recommendation-job.ts`
- Modify: `apps/backend/src/modules/README.md`
- Modify: `CLAUDE.md` (mục backend)

- [ ] **Step 1: Script đẩy job tay**

`apps/backend/scripts/enqueue-recommendation-job.ts`:

```ts
/**
 * Đẩy một job gợi ý vào BullMQ để kiểm tra tay (Redis local, `pnpm infra:up`).
 *   npx tsx scripts/enqueue-recommendation-job.ts refresh-window
 *   npx tsx scripts/enqueue-recommendation-job.ts generate-user-themes <userId>
 */
import { Queue } from 'bullmq';

const [name, arg] = process.argv.slice(2);
const AI_JOBS = new Set(['generate-user-themes', 'upgrade-draft']);
const data =
  name === 'generate-user-themes'
    ? { userId: arg }
    : name === 'upgrade-draft'
      ? { draftId: arg }
      : name === 'fetch-region-image'
        ? { regionId: arg }
        : {};

const queue = new Queue(AI_JOBS.has(name) ? 'recommendations-ai' : 'recommendations', {
  connection: { host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6379) },
});
await queue.add(name, data);
console.log(`Đã đẩy job ${name}`, data);
await queue.close();
```

Kiểm tra `apps/backend/scripts/` có script khác chạy bằng `tsx` không (`ls apps/backend/scripts`, xem `package.json`); dùng đúng cách chạy đó.

- [ ] **Step 2: Kiểm tra tay với Redis**

1. `pnpm infra:up`
2. Trong `apps/backend/.env`: `RECOMMENDATIONS_ENABLED=true`. `pnpm --filter @rong/backend start:dev`.
3. Đăng nhập một tài khoản dev, gọi `GET /api/recommendations` với token: lần đầu `building`, vài giây sau `ready`.
4. `cd apps/backend && npx tsx scripts/enqueue-recommendation-job.ts refresh-window` → log `Làm mới gợi ý: N người dùng.` và các dòng `Gợi ý default cho …`.
5. `docker exec rong-redis redis-cli zrange bull:recommendations:completed 0 -1` có các job vừa chạy.

Ghi kết quả (thành công hoặc lỗi kèm log) vào mô tả commit/PR. Nếu bước nào hỏng, dừng lại báo người dùng.

- [ ] **Step 3: Tài liệu**

`apps/backend/src/modules/README.md` — thêm mục `recommendations/` (theo định dạng các mục khác):
- Bảng tin gợi ý ở trang chủ: 3 bản nháp mỗi (người dùng, khung 6:00/15:00, chủ đề), lấy từ kho bản nháp chung `itinerary_drafts` (heuristic, nâng cấp bằng Gemini khi được xem/lưu nhiều).
- Chỉ dùng vùng có danh sách `ready`; chỉ `warm-featured-regions` được tạo danh sách (vùng nổi bật).
- Hàng đợi BullMQ `recommendations` + `recommendations-ai` (Gemini, limiter); `RECOMMENDATIONS_ENABLED=false` hoặc e2e: chạy trong process, không có cron.
- Ảnh vùng: Unsplash → ảnh bài viết có nguồn (`region_images.blocked` để gỡ).
- Lệch PRD: bản nháp không trừ lượt AI (FR-6.5).

`CLAUDE.md` gốc — trong "Backend architecture", thêm một đoạn ngắn "### Home recommendations" tóm 4 ý trên và đường dẫn spec; trong "Commands", thêm `RECOMMENDATIONS_ENABLED=false` khi không chạy Redis. Trong "Deploy", thêm dòng: "Gợi ý trang chủ cần Redis: `infra/prod/docker-compose.yml` chưa có service Redis — thêm trước khi deploy."

- [ ] **Step 4: Commit**

```bash
git add apps/backend/scripts/enqueue-recommendation-job.ts apps/backend/src/modules/README.md CLAUDE.md
git commit -m "docs: document home recommendations backend and queue"
```
