# Tái cấu trúc mobile — Đợt 1: Nền móng — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dọn code thừa, thêm lớp `src/api/` (module API thuần theo tài nguyên + `useApi()`), query key, `QueryClient` và provider TanStack Query — chưa màn hình nào đổi cách tải dữ liệu.

**Architecture:** Mỗi module API là `(f: Fetcher) => ({ … })`, hàm thuần không biết React; `useApi()` dựng `createApi(authFetch)`. `QueryProvider` nằm trong `AuthProvider`, xóa cache khi đổi người dùng/đăng xuất và nối `focusManager` với `AppState`. Đợt 2 mới chuyển hook/màn sang dùng các thứ này.

**Tech Stack:** Expo 57 / React Native 0.86 / React 19.2, expo-router, `@tanstack/react-query` v5, Jest (`jest-expo`) + `@testing-library/react-native`, knip, jscpd.

**Spec:** `docs/superpowers/specs/2026-10-23-mobile-refactor-design.md` (mục "Đợt 1")

## Global Constraints

- Chỉ sửa `apps/mobile`. Không đổi backend, `packages/shared-types`, `apps/web`.
- **Giao diện và hành vi không đổi trong đợt này**: không màn/hook nào được chuyển sang `src/api/` (việc của đợt 2).
- Module API tạo ra **đúng chuỗi đường dẫn, method, body như lời gọi hiện có** (test cũ khẳng định đường dẫn, ví dụ `'/places/reverse-geocode?lat=…&lng=…'`). Lời gọi GET không có option thì gọi `f(path)` một tham số.
- Mobile dùng nháy đơn, import alias `@/…`, không đuôi `.js`; comment tiếng Việt, chỉ giải thích *vì sao*.
- Không chạy prettier trên file có sẵn (mobile không format bằng prettier); file mới viết theo style file xung quanh (2 space, nháy đơn, dấu chấm phẩy).
- Kiểm tra: `pnpm --filter @rong/mobile typecheck`, `pnpm --filter @rong/mobile lint` (expo lint; cảnh báo cũ ở `(tabs)/account.tsx:42` là có sẵn), `pnpm --filter @rong/mobile test`.
- Commit nhỏ, mỗi task một commit; cuối commit message:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` và
  `Claude-Session: https://claude.ai/code/session_0144WGq2fQ1byzqdA9K6qGhQ`.
- **Trước Task 1:** `apps/mobile/package.json` và `pnpm-lock.yaml` đang có thay đổi chưa commit của người dùng (cùng `apps/mobile/eas.json`). Task 1 và Task 6 sửa hai file đó. Phải hỏi người dùng commit/stash trước; không được trộn thay đổi của họ vào commit của plan.

## Review Focus

1. **Đăng xuất rồi đăng nhập tài khoản khác:** không được thấy dữ liệu cache của người trước. (Task 7: test đổi `session.user.id` → cache rỗng.)
2. **Phiên hết hạn (`401 SESSION_EXPIRED`) hay lỗi 4xx:** không retry lặp lại. (Task 6: `shouldRetry` với 401/404/422.)
3. **App ra nền rồi quay lại:** `focusManager` nhận `active` → focused, nền → không focused; gỡ listener khi unmount. (Task 6.)
4. **Mất mạng:** retry tối đa 2 lần rồi dừng. (Task 6: `failureCount` 0, 1 → retry; 2 → không.)
5. **Tham số có ký tự đặc biệt** (token mời, `googlePlaceId`, chuỗi tìm có dấu cách): được mã hóa đúng như hiện tại. (Task 4, Task 5.)

---

## File Structure

- Create `apps/mobile/knip.json` — cấu hình knip (ngoại lệ có lý do).
- Modify `apps/mobile/package.json` — script `knip`, `dup`; bỏ `expo-device`, `expo-web-browser`; thêm `@tanstack/react-query`, devDeps `knip`, `jscpd`.
- Delete `src/components/themed-view.tsx`, `src/hooks/use-color-scheme.ts`.
- Modify các file có export thừa (Task 1).
- Create `src/api/client.ts` (+ `client.test.ts`) — `Fetcher`, `toApiError`, `UNKNOWN_ERROR_MESSAGE`.
- Create `src/api/itineraries.ts`, `recommendations.ts`, `visits.ts` (+ tests) — Task 3.
- Create `src/api/places.ts`, `regions.ts`, `saved-places.ts` (+ tests) — Task 4.
- Create `src/api/groups.ts`, `invites.ts`, `share-imports.ts`, `users.ts`, `index.ts` (+ tests) — Task 5.
- Create `src/api/query-keys.ts`, `src/api/query-client.ts` (+ test) — Task 6.
- Create `src/api/query-provider.tsx` (+ test), `src/test-utils/query.tsx`; modify `src/app/_layout.tsx` — Task 7.
- Modify `src/lib/share-link.ts` — dùng `Fetcher` thay type `AuthFetch` tự khai báo (Task 2).

---

### Task 1: Dọn code thừa, cấu hình knip và jscpd

**Files:**
- Create: `apps/mobile/knip.json`
- Modify: `apps/mobile/package.json`
- Delete: `apps/mobile/src/components/themed-view.tsx`, `apps/mobile/src/hooks/use-color-scheme.ts`
- Modify: `src/auth/validation.ts`, `src/components/itinerary-editor.tsx`, `src/components/recommendation-card.tsx`, `src/components/ui/approximate-location.tsx`, `src/components/weather-strip.tsx`, `src/constants/motion.ts`, `src/constants/theme.ts`, `src/lib/itinerary-edit.ts`, `src/lib/trip-format.ts`, và các file có type export thừa (danh sách ở Step 4)

**Interfaces:**
- Produces: script `pnpm --filter @rong/mobile knip` (thoát 0 khi sạch), `pnpm --filter @rong/mobile dup` (báo cáo, chưa chặn).

Đây là việc xóa code không có hành vi; "test" của task là knip đỏ → xanh, và typecheck/lint/jest không đổi.

- [ ] **Step 1: Cài công cụ và ghi baseline**

Run (từ gốc repo):
```bash
pnpm --filter @rong/mobile add -D knip@5 jscpd@4
pnpm --filter @rong/mobile remove expo-device expo-web-browser
```

Thêm vào `scripts` của `apps/mobile/package.json`:

```json
    "knip": "knip",
    "dup": "jscpd src --min-lines 6 --min-tokens 60 --format typescript,tsx --ignore \"**/__tests__/**,**/*.test.*\" --reporters console"
```

Tạo `apps/mobile/knip.json`:

```json
{
  "$schema": "https://unpkg.com/knip@5/schema.json",
  "ignore": ["src/**/*.web.tsx", "src/api/**", "src/test-utils/**"],
  "ignoreDependencies": ["@rong/shared-types", "expo-updates"],
  "ignoreBinaries": ["jest"]
}
```

Lý do từng ngoại lệ (ghi vào commit message, không ghi vào JSON):
- `*.web.tsx`: Metro chọn theo nền tảng, knip không thấy import.
- `src/api/**`, `src/test-utils/**`: đợt 1 tạo trước, đợt 2 mới dùng — **đợt 2 phải bỏ hai dòng này**.
- `@rong/shared-types`: chỉ import kiểu, knip báo nhầm.
- `expo-updates`: plugin trong `app.config.ts`, được cài ở gốc monorepo.
- `jest`: binary hoisted ở gốc.

Run: `pnpm --filter @rong/mobile knip`
Expected: FAIL (exit ≠ 0), liệt kê 2 file thừa và các export/type thừa.

- [ ] **Step 2: Xóa hai file thừa**

```bash
git rm apps/mobile/src/components/themed-view.tsx apps/mobile/src/hooks/use-color-scheme.ts
```

Run: `pnpm --filter @rong/mobile typecheck`
Expected: PASS (không ai import hai file này — đã grep: `ThemedView` chỉ xuất hiện trong chính file; `use-color-scheme` không được import, `hooks/use-theme.ts` chỉ nhắc tên trong comment).

- [ ] **Step 3: Export thừa — bỏ `export`, xóa nếu không ai dùng**

Với mỗi tên dưới đây: bỏ từ khóa `export` ở khai báo. Sau đó chạy lint; nếu `@typescript-eslint/no-unused-vars` báo tên đó không dùng trong file thì **xóa luôn khai báo** (và import chỉ phục vụ nó).

| File | Tên |
| --- | --- |
| `src/auth/validation.ts` | `MAX_PASSWORD_LENGTH` |
| `src/components/itinerary-editor.tsx` | `itemTitle` |
| `src/components/recommendation-card.tsx` | `THEME_ICONS`, `themeGradient`, type `ThemeIcon` |
| `src/components/ui/approximate-location.tsx` | `APPROXIMATE_LOCATION_NOTE` |
| `src/components/weather-strip.tsx` | `WeatherDayChip` |
| `src/constants/motion.ts` | `STAGGER_MS`, `EaseOut` |
| `src/constants/theme.ts` | `FontFamily`, `MaxContentWidth` |
| `src/lib/itinerary-edit.ts` | `defaultDuration`, `newId`, `locate` |
| `src/lib/trip-format.ts` | `formatShortDate`, `formatDayTitle`, `DAY_PART_LABELS` |

Đếm trước (số lần tên xuất hiện trong file của nó): `MaxContentWidth` 1 và `DAY_PART_LABELS` 1 → chắc chắn xóa; các tên còn lại xuất hiện ≥ 2 lần → nhiều khả năng chỉ bỏ `export`. Lint quyết định.

Run: `pnpm --filter @rong/mobile lint`
Expected: chỉ còn 1 cảnh báo có sẵn (`(tabs)/account.tsx` exhaustive-deps), không có `no-unused-vars` mới.

- [ ] **Step 4: Type export thừa — bỏ `export`**

Bỏ `export` ở các type sau (chỉ dùng trong file của nó; nếu lint báo không dùng thì xóa):

`src/components/glass.tsx`: `GlassVariant`, `GlassShape`, `GlassProps` · `src/components/itinerary-view/itinerary-view.tsx`: `ItineraryViewData` · `src/components/themed-text.tsx`: `ThemedTextProps` · `src/components/ui/button.tsx`: `ButtonVariant`, `ButtonProps` · `src/components/ui/notice.tsx`: `NoticeTone` · `src/components/ui/pressable-scale.tsx`: `PressableScaleProps` · `src/components/ui/search-field.tsx`: `SearchFieldProps` · `src/components/ui/text-field.tsx`: `TextFieldProps` · `src/hooks/use-google-place-preview.ts`: `GooglePlacePreviewState` · `src/hooks/use-pin-address.ts`: `PinAddressState` · `src/hooks/use-place-detail.ts`: `PlaceDetailState` · `src/hooks/use-region-places.ts`: `RegionPlacesState` · `src/hooks/use-region-search.ts`: `RegionSearchState` · `src/lib/preferences.ts`: `Preferences` · `src/lib/saved-places.tsx`: `SaveablePlace`

Knip coi import từ file test là có dùng, nên tên nào test import sẽ không nằm trong danh sách. Chỉ xử lý những tên knip còn báo sau Step 3.

- [ ] **Step 5: knip sạch, mọi thứ còn xanh**

Run: `pnpm --filter @rong/mobile knip && pnpm --filter @rong/mobile typecheck && pnpm --filter @rong/mobile lint && pnpm --filter @rong/mobile test`
Expected: knip exit 0 không in gì; typecheck PASS; lint chỉ cảnh báo có sẵn; jest `Tests: 111 passed`.

Run: `pnpm --filter @rong/mobile dup`
Expected: in báo cáo (khoảng 17 cụm); ghi lại số cụm vào commit message làm baseline.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/knip.json apps/mobile/package.json pnpm-lock.yaml apps/mobile/src
git commit -m "chore(mobile): remove unused files, exports and dependencies; add knip and jscpd"
```

---

### Task 2: `src/api/client.ts`

**Files:**
- Create: `apps/mobile/src/api/client.ts`
- Test: `apps/mobile/src/api/client.test.ts`
- Modify: `apps/mobile/src/lib/share-link.ts:12` (dùng `Fetcher`)

**Interfaces:**
- Consumes: `ApiError`, `RequestOptions` từ `@/lib/api`.
- Produces:
  - `type Fetcher = <T>(path: string, options?: Omit<RequestOptions, 'token'>) => Promise<T>`
  - `const UNKNOWN_ERROR_MESSAGE = 'Có lỗi không mong muốn. Thử lại sau.'`
  - `function toApiError(error: unknown): ApiError`

- [ ] **Step 1: Test**

```ts
import { ApiError } from '@/lib/api';

import { toApiError, UNKNOWN_ERROR_MESSAGE } from './client';

describe('toApiError', () => {
  it('giữ nguyên ApiError', () => {
    const error = new ApiError(404, 'NOT_FOUND', 'Không thấy');
    expect(toApiError(error)).toBe(error);
  });

  it('lỗi khác thành UNKNOWN với thông báo chung', () => {
    const wrapped = toApiError(new TypeError('boom'));
    expect(wrapped).toBeInstanceOf(ApiError);
    expect(wrapped).toMatchObject({ status: 0, code: 'UNKNOWN', message: UNKNOWN_ERROR_MESSAGE });
    expect(toApiError('chuỗi lạ')).toMatchObject({ code: 'UNKNOWN' });
  });
});
```

Run: `pnpm --filter @rong/mobile test -- src/api/client.test.ts`
Expected: FAIL — `Cannot find module './client'`.

- [ ] **Step 2: Triển khai**

```ts
import { ApiError, type RequestOptions } from '@/lib/api';

/** Cùng chữ ký `authFetch`: module API không cần biết token hay cách làm mới phiên. */
export type Fetcher = <T>(path: string, options?: Omit<RequestOptions, 'token'>) => Promise<T>;

export const UNKNOWN_ERROR_MESSAGE = 'Có lỗi không mong muốn. Thử lại sau.';

/** Màn hình rẽ nhánh theo `code`, nên mọi lỗi đều phải là ApiError. */
export function toApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError(0, 'UNKNOWN', UNKNOWN_ERROR_MESSAGE);
}
```

`src/lib/share-link.ts`: xóa dòng `type AuthFetch = …` và import `RequestOptions` nếu chỉ phục vụ nó; thêm `import type { Fetcher } from '@/api/client';` và đổi `authFetch: AuthFetch` thành `authFetch: Fetcher`.

- [ ] **Step 3: Chạy test**

Run: `pnpm --filter @rong/mobile test -- src/api/client.test.ts src/lib/share-link.test.ts && pnpm --filter @rong/mobile typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/api/client.ts apps/mobile/src/api/client.test.ts apps/mobile/src/lib/share-link.ts
git commit -m "feat(mobile): api client types and a single toApiError"
```

---

### Task 3: Module API — lịch trình, gợi ý, nơi đã đi

**Files:**
- Create: `apps/mobile/src/api/itineraries.ts`, `recommendations.ts`, `visits.ts`
- Test: `apps/mobile/src/api/itineraries.test.ts`, `recommendations.test.ts`, `visits.test.ts`

**Interfaces:**
- Consumes: `Fetcher` (Task 2).
- Produces:
  - `itinerariesApi(f)`: `list()`, `get(id)`, `create(body: CreateItineraryBody)`, `update(id, body: UpdateItineraryRequest)`, `remove(id)`, `setGroup(id, groupId: string | null)`, `alternatives(id, placeId)`, `shareLink(id)`, `ensureShareLink(id)`; `type CreateItineraryBody = Omit<ItineraryInput, 'pace'> & { pace?: Pace }`.
  - `recommendationsApi(f)`: `feed(theme: string, retry?: boolean)`, `draft(id)`, `preview(id, body: PreviewDraftRequest)`, `save(id, draftId: string)`.
  - `visitsApi(f)`: `pending()`, `review(body: ReviewVisitsRequest)`.

Mỗi hàm khớp một lời gọi hiện có (nguồn trong comment test).

- [ ] **Step 1: Tests**

`itineraries.test.ts`:

```ts
import { itinerariesApi } from './itineraries';

describe('itinerariesApi', () => {
  const f = jest.fn().mockResolvedValue(undefined);
  const api = itinerariesApi(f);
  beforeEach(() => f.mockClear());

  it('đọc', async () => {
    await api.list();
    expect(f).toHaveBeenLastCalledWith('/itineraries');
    await api.get('it1');
    expect(f).toHaveBeenLastCalledWith('/itineraries/it1');
    await api.alternatives('it1', 'p1');
    expect(f).toHaveBeenLastCalledWith('/itineraries/it1/alternatives?placeId=p1');
    await api.shareLink('it1');
    expect(f).toHaveBeenLastCalledWith('/itineraries/it1/share-link');
  });

  it('ghi', async () => {
    const body = { regionId: 'r1' } as never;
    await api.create(body);
    expect(f).toHaveBeenLastCalledWith('/itineraries', { method: 'POST', body });
    await api.update('it1', body);
    expect(f).toHaveBeenLastCalledWith('/itineraries/it1', { method: 'PUT', body });
    await api.remove('it1');
    expect(f).toHaveBeenLastCalledWith('/itineraries/it1', { method: 'DELETE' });
    await api.setGroup('it1', 'g1');
    expect(f).toHaveBeenLastCalledWith('/itineraries/it1/group', { method: 'PATCH', body: { groupId: 'g1' } });
    await api.setGroup('it1', null);
    expect(f).toHaveBeenLastCalledWith('/itineraries/it1/group', { method: 'PATCH', body: { groupId: null } });
    await api.ensureShareLink('it1');
    expect(f).toHaveBeenLastCalledWith('/itineraries/it1/share-link', { method: 'PUT' });
  });
});
```

`recommendations.test.ts`:

```ts
import { recommendationsApi } from './recommendations';

describe('recommendationsApi', () => {
  const f = jest.fn().mockResolvedValue(undefined);
  const api = recommendationsApi(f);
  beforeEach(() => f.mockClear());

  it('feed theo chủ đề, retry=1 khi thử lại', async () => {
    await api.feed('user:abc');
    expect(f).toHaveBeenLastCalledWith('/recommendations?theme=user%3Aabc');
    await api.feed('default', true);
    expect(f).toHaveBeenLastCalledWith('/recommendations?theme=default&retry=1');
  });

  it('bản nháp: xem, xem trước với thông số, lưu', async () => {
    await api.draft('d1');
    expect(f).toHaveBeenLastCalledWith('/recommendations/d1');
    const body = { startDate: '2026-10-25', daysCount: 2 } as never;
    await api.preview('d1', body);
    expect(f).toHaveBeenLastCalledWith('/recommendations/d1/preview', { method: 'POST', body });
    await api.save('d1', 'draft-9');
    expect(f).toHaveBeenLastCalledWith('/recommendations/d1/save', { method: 'POST', body: { draftId: 'draft-9' } });
  });
});
```

`visits.test.ts`:

```ts
import { visitsApi } from './visits';

describe('visitsApi', () => {
  it('chuyến chờ hỏi và trả lời', async () => {
    const f = jest.fn().mockResolvedValue(undefined);
    const api = visitsApi(f);
    await api.pending();
    expect(f).toHaveBeenLastCalledWith('/visits/pending');
    await api.review({ itineraryId: 'it1', visitedPlaceIds: ['p1'] });
    expect(f).toHaveBeenLastCalledWith('/visits/review', {
      method: 'POST',
      body: { itineraryId: 'it1', visitedPlaceIds: ['p1'] },
    });
  });
});
```

Run: `pnpm --filter @rong/mobile test -- src/api`
Expected: FAIL — không tìm thấy ba module.

- [ ] **Step 2: Triển khai**

`itineraries.ts`:

```ts
import type {
  CurrentItineraryShareLink,
  Itinerary,
  ItineraryInput,
  ItineraryShareLink,
  ItinerarySummary,
  Pace,
  PlaceAlternative,
  UpdateItineraryRequest,
} from '@rong/shared-types';

import type { Fetcher } from './client';

/** Tạo lịch trình: không gửi `pace` thì backend tự chọn theo đối tượng đi. */
export type CreateItineraryBody = Omit<ItineraryInput, 'pace'> & { pace?: Pace };

export const itinerariesApi = (f: Fetcher) => ({
  list: () => f<ItinerarySummary[]>('/itineraries'),
  get: (id: string) => f<Itinerary>(`/itineraries/${id}`),
  create: (body: CreateItineraryBody) => f<Itinerary>('/itineraries', { method: 'POST', body }),
  update: (id: string, body: UpdateItineraryRequest) => f<Itinerary>(`/itineraries/${id}`, { method: 'PUT', body }),
  remove: (id: string) => f<void>(`/itineraries/${id}`, { method: 'DELETE' }),
  setGroup: (id: string, groupId: string | null) =>
    f<void>(`/itineraries/${id}/group`, { method: 'PATCH', body: { groupId } }),
  alternatives: (id: string, placeId: string) =>
    f<PlaceAlternative[]>(`/itineraries/${id}/alternatives?placeId=${placeId}`),
  shareLink: (id: string) => f<CurrentItineraryShareLink>(`/itineraries/${id}/share-link`),
  /** Lấy hoặc tạo link, không thu hồi link đã gửi. */
  ensureShareLink: (id: string) => f<ItineraryShareLink>(`/itineraries/${id}/share-link`, { method: 'PUT' }),
});
```

Nếu kiểu `CreateBody` trong `app/(app)/itinerary/new.tsx` khác `Omit<ItineraryInput, 'pace'> & { pace?: Pace }`, chép đúng kiểu đang có ở đó.

`recommendations.ts`:

```ts
import type { Itinerary, ItineraryDraft, PreviewDraftRequest, RecommendationFeed } from '@rong/shared-types';

import type { Fetcher } from './client';

export const recommendationsApi = (f: Fetcher) => ({
  feed: (theme: string, retry = false) => {
    const params = new URLSearchParams({ theme });
    if (retry) params.set('retry', '1');
    return f<RecommendationFeed>(`/recommendations?${params}`);
  },
  draft: (id: string) => f<ItineraryDraft>(`/recommendations/${id}`),
  preview: (id: string, body: PreviewDraftRequest) =>
    f<ItineraryDraft>(`/recommendations/${id}/preview`, { method: 'POST', body }),
  save: (id: string, draftId: string) =>
    f<Itinerary>(`/recommendations/${id}/save`, { method: 'POST', body: { draftId } }),
});
```

`visits.ts`:

```ts
import type { PendingVisitReview, ReviewVisitsRequest } from '@rong/shared-types';

import type { Fetcher } from './client';

export const visitsApi = (f: Fetcher) => ({
  pending: () => f<PendingVisitReview[]>('/visits/pending'),
  review: (body: ReviewVisitsRequest) => f<void>('/visits/review', { method: 'POST', body }),
});
```

- [ ] **Step 3: Chạy test**

Run: `pnpm --filter @rong/mobile test -- src/api && pnpm --filter @rong/mobile typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/api
git commit -m "feat(mobile): api modules for itineraries, recommendations and visits"
```

---

### Task 4: Module API — địa điểm, vùng, "Muốn đi"

**Files:**
- Create: `apps/mobile/src/api/places.ts`, `regions.ts`, `saved-places.ts`
- Test: `apps/mobile/src/api/places.test.ts`, `regions.test.ts`, `saved-places.test.ts`

**Interfaces:**
- Consumes: `Fetcher`.
- Produces:
  - `placesApi(f)`: `detail(id)`, `updateNotes(id, patch: Partial<PlaceNotes>)`, `createUserPlace(body: CreateUserPlaceRequest)`, `updateUserPlace(id, body: UpdateUserPlaceRequest)`, `googlePreview(googlePlaceId)`, `saveGoogle(body: SaveGooglePlaceRequest)`, `reverseGeocode(lat: number, lng: number)`.
  - `regionsApi(f)`: `search(q: string, online?: boolean)`, `places(regionId, categories?: string)`, `searchPlaces(regionId, q: string, online?: boolean)`, `weather(regionId, from: string, to: string)`.
  - `savedPlacesApi(f)`: `list()`, `add(placeId, regionId)`, `remove(placeId)`.

- [ ] **Step 1: Tests**

`places.test.ts`:

```ts
import { placesApi } from './places';

describe('placesApi', () => {
  const f = jest.fn().mockResolvedValue(undefined);
  const api = placesApi(f);
  beforeEach(() => f.mockClear());

  it('chi tiết và ghi chú', async () => {
    await api.detail('p1');
    expect(f).toHaveBeenLastCalledWith('/places/p1');
    await api.updateNotes('p1', { note: 'ngon' });
    expect(f).toHaveBeenLastCalledWith('/places/p1/notes', { method: 'PATCH', body: { note: 'ngon' } });
  });

  it('địa điểm tự ghim', async () => {
    const body = { name: 'Quán' } as never;
    await api.createUserPlace(body);
    expect(f).toHaveBeenLastCalledWith('/places/user', { method: 'POST', body });
    await api.updateUserPlace('p1', body);
    expect(f).toHaveBeenLastCalledWith('/places/user/p1', { method: 'PATCH', body });
  });

  it('Google: xem trước (mã hóa id) và lưu', async () => {
    await api.googlePreview('ChIJ a/b');
    expect(f).toHaveBeenLastCalledWith('/places/google/ChIJ%20a%2Fb');
    const body = { googlePlaceId: 'g1', name: 'X', category: 'cafe', regionId: 'r1' } as never;
    await api.saveGoogle(body);
    expect(f).toHaveBeenLastCalledWith('/places/google', { method: 'POST', body });
  });

  it('địa chỉ dưới ghim', async () => {
    await api.reverseGeocode(10.5, 106.25);
    expect(f).toHaveBeenLastCalledWith('/places/reverse-geocode?lat=10.5&lng=106.25');
  });
});
```

`regions.test.ts`:

```ts
import { regionsApi } from './regions';

describe('regionsApi', () => {
  const f = jest.fn().mockResolvedValue(undefined);
  const api = regionsApi(f);
  beforeEach(() => f.mockClear());

  it('tìm vùng, online khi bấm tìm', async () => {
    await api.search('Đà Lạt');
    expect(f).toHaveBeenLastCalledWith(`/regions/search?${new URLSearchParams({ q: 'Đà Lạt' })}`);
    await api.search('Hội An', true);
    expect(f).toHaveBeenLastCalledWith(`/regions/search?${new URLSearchParams({ q: 'Hội An', online: 'true' })}`);
  });

  it('danh sách địa điểm, lọc theo loại', async () => {
    await api.places('r1');
    expect(f).toHaveBeenLastCalledWith('/regions/r1/places?');
    await api.places('r1', 'cafe,food');
    expect(f).toHaveBeenLastCalledWith('/regions/r1/places?categories=cafe%2Cfood');
  });

  it('tìm địa điểm theo tên trong vùng', async () => {
    await api.searchPlaces('r1', 'bún bò');
    expect(f).toHaveBeenLastCalledWith(`/regions/r1/places/search?${new URLSearchParams({ q: 'bún bò' })}`);
    await api.searchPlaces('r1', 'bún bò', true);
    expect(f).toHaveBeenLastCalledWith(
      `/regions/r1/places/search?${new URLSearchParams({ q: 'bún bò', online: 'true' })}`,
    );
  });

  it('thời tiết', async () => {
    await api.weather('r1', '2026-10-25', '2026-10-26');
    expect(f).toHaveBeenLastCalledWith('/regions/r1/weather?from=2026-10-25&to=2026-10-26');
  });
});
```

`saved-places.test.ts`:

```ts
import { savedPlacesApi } from './saved-places';

describe('savedPlacesApi', () => {
  it('danh sách, thêm (PUT kèm vùng), bỏ', async () => {
    const f = jest.fn().mockResolvedValue(undefined);
    const api = savedPlacesApi(f);
    await api.list();
    expect(f).toHaveBeenLastCalledWith('/saved-places');
    await api.add('p1', 'r1');
    expect(f).toHaveBeenLastCalledWith('/saved-places/p1', { method: 'PUT', body: { regionId: 'r1' } });
    await api.remove('p1');
    expect(f).toHaveBeenLastCalledWith('/saved-places/p1', { method: 'DELETE' });
  });
});
```

Run: `pnpm --filter @rong/mobile test -- src/api`
Expected: FAIL — ba module mới chưa có.

- [ ] **Step 2: Triển khai**

`places.ts`:

```ts
import type {
  CreateUserPlaceRequest,
  CreateUserPlaceResponse,
  GooglePlacePreviewResponse,
  PlaceDetail,
  PlaceNotes,
  ReverseGeocodeResponse,
  SaveGooglePlaceRequest,
  SaveGooglePlaceResponse,
  UpdateUserPlaceRequest,
} from '@rong/shared-types';

import type { Fetcher } from './client';

export const placesApi = (f: Fetcher) => ({
  detail: (id: string) => f<PlaceDetail>(`/places/${id}`),
  updateNotes: (id: string, patch: Partial<PlaceNotes>) =>
    f<PlaceNotes | null>(`/places/${id}/notes`, { method: 'PATCH', body: patch }),
  createUserPlace: (body: CreateUserPlaceRequest) =>
    f<CreateUserPlaceResponse>('/places/user', { method: 'POST', body }),
  updateUserPlace: (id: string, body: UpdateUserPlaceRequest) =>
    f<void>(`/places/user/${id}`, { method: 'PATCH', body }),
  googlePreview: (googlePlaceId: string) =>
    f<GooglePlacePreviewResponse>(`/places/google/${encodeURIComponent(googlePlaceId)}`),
  saveGoogle: (body: SaveGooglePlaceRequest) =>
    f<SaveGooglePlaceResponse>('/places/google', { method: 'POST', body }),
  reverseGeocode: (lat: number, lng: number) =>
    f<ReverseGeocodeResponse>(`/places/reverse-geocode?lat=${lat}&lng=${lng}`),
});
```

`regions.ts`:

```ts
import type { PlaceSearchResponse, PlacesPage, RegionSearchResult, RegionWeather } from '@rong/shared-types';

import type { Fetcher } from './client';

function searchParams(q: string, online: boolean): URLSearchParams {
  const params = new URLSearchParams({ q });
  if (online) params.set('online', 'true');
  return params;
}

export const regionsApi = (f: Fetcher) => ({
  /** `online`: hỏi thêm Nominatim, chỉ khi người dùng bấm tìm. */
  search: (q: string, online = false) => f<RegionSearchResult[]>(`/regions/search?${searchParams(q, online)}`),
  places: (regionId: string, categories?: string) => {
    const params = new URLSearchParams();
    if (categories) params.set('categories', categories);
    return f<PlacesPage>(`/regions/${regionId}/places?${params}`);
  },
  /** `online`: tìm Google khi bấm tìm (có giới hạn theo ngày). */
  searchPlaces: (regionId: string, q: string, online = false) =>
    f<PlaceSearchResponse>(`/regions/${regionId}/places/search?${searchParams(q, online)}`),
  weather: (regionId: string, from: string, to: string) =>
    f<RegionWeather>(`/regions/${regionId}/weather?from=${from}&to=${to}`),
});
```

`saved-places.ts`:

```ts
import type { SavedPlace } from '@rong/shared-types';

import type { Fetcher } from './client';

export const savedPlacesApi = (f: Fetcher) => ({
  list: () => f<SavedPlace[]>('/saved-places'),
  add: (placeId: string, regionId: string) =>
    f<void>(`/saved-places/${placeId}`, { method: 'PUT', body: { regionId } }),
  remove: (placeId: string) => f<void>(`/saved-places/${placeId}`, { method: 'DELETE' }),
});
```

Ghi chú cho đợt 2 (không làm bây giờ): `app/(app)/place/pin.tsx:286` gọi `/regions/search?q=${encodeURIComponent(name)}` (dấu cách thành `%20`), còn `regionsApi.search` dùng `URLSearchParams` (dấu cách thành `+`); backend đọc như nhau.

- [ ] **Step 3: Chạy test**

Run: `pnpm --filter @rong/mobile test -- src/api && pnpm --filter @rong/mobile typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/api
git commit -m "feat(mobile): api modules for places, regions and saved places"
```

---

### Task 5: Module API — nhóm, lời mời, chia sẻ vào app, người dùng; `createApi` + `useApi`

**Files:**
- Create: `apps/mobile/src/api/groups.ts`, `invites.ts`, `share-imports.ts`, `users.ts`, `index.ts`
- Test: `apps/mobile/src/api/groups.test.ts`, `invites.test.ts`, `share-imports.test.ts`, `users.test.ts`, `index.test.tsx`

**Interfaces:**
- Consumes: `Fetcher`; mọi module của Task 3, 4; `useAuth()` từ `@/auth/auth-context` (`authFetch` có chữ ký `Fetcher`).
- Produces:
  - `groupsApi(f)`: `list()`, `get(id)`, `create(name)`, `rename(id, name)`, `remove(id)`, `setMemberRole(groupId, userId, role: InviteRole)`, `removeMember(groupId, userId)`, `createInvite(groupId, role: InviteRole)`, `removeItinerary(groupId, itineraryId)`.
  - `invitesApi(f)`: `preview(token)`, `accept(token)`.
  - `shareImportsApi(f)`: `list()`, `get(id)`, `create(body: CreateShareImportRequest)`, `save(id, selections: ShareImportSelection[])`.
  - `usersApi(f)`: `update(body: { displayName: string } | { interests: PlaceCategory[] })`, `remove()`.
  - `createApi(f): Api` gồm `itineraries, recommendations, visits, places, regions, savedPlaces, groups, invites, shareImports, users`; `type Api = ReturnType<typeof createApi>`; `useApi(): Api`.

- [ ] **Step 1: Tests**

`groups.test.ts`:

```ts
import { groupsApi } from './groups';

describe('groupsApi', () => {
  const f = jest.fn().mockResolvedValue(undefined);
  const api = groupsApi(f);
  beforeEach(() => f.mockClear());

  it('nhóm', async () => {
    await api.list();
    expect(f).toHaveBeenLastCalledWith('/groups');
    await api.get('g1');
    expect(f).toHaveBeenLastCalledWith('/groups/g1');
    await api.create('Đà Lạt 2026');
    expect(f).toHaveBeenLastCalledWith('/groups', { method: 'POST', body: { name: 'Đà Lạt 2026' } });
    await api.rename('g1', 'Mới');
    expect(f).toHaveBeenLastCalledWith('/groups/g1', { method: 'PATCH', body: { name: 'Mới' } });
    await api.remove('g1');
    expect(f).toHaveBeenLastCalledWith('/groups/g1', { method: 'DELETE' });
  });

  it('thành viên, lời mời, lịch trình trong nhóm', async () => {
    await api.setMemberRole('g1', 'u2', 'editor');
    expect(f).toHaveBeenLastCalledWith('/groups/g1/members/u2', { method: 'PATCH', body: { role: 'editor' } });
    await api.removeMember('g1', 'u2');
    expect(f).toHaveBeenLastCalledWith('/groups/g1/members/u2', { method: 'DELETE' });
    await api.createInvite('g1', 'viewer');
    expect(f).toHaveBeenLastCalledWith('/groups/g1/invites', { method: 'POST', body: { role: 'viewer' } });
    await api.removeItinerary('g1', 'it1');
    expect(f).toHaveBeenLastCalledWith('/groups/g1/itineraries/it1', { method: 'DELETE' });
  });
});
```

`invites.test.ts`:

```ts
import { invitesApi } from './invites';

describe('invitesApi', () => {
  it('xem trước và nhận lời mời, mã hóa token', async () => {
    const f = jest.fn().mockResolvedValue(undefined);
    const api = invitesApi(f);
    await api.preview('a b/c');
    expect(f).toHaveBeenLastCalledWith('/invites/a%20b%2Fc');
    await api.accept('a b/c');
    expect(f).toHaveBeenLastCalledWith('/invites/a%20b%2Fc/accept', { method: 'POST' });
  });
});
```

`share-imports.test.ts`:

```ts
import { shareImportsApi } from './share-imports';

describe('shareImportsApi', () => {
  it('danh sách, chi tiết, tạo, lưu lựa chọn', async () => {
    const f = jest.fn().mockResolvedValue(undefined);
    const api = shareImportsApi(f);
    await api.list();
    expect(f).toHaveBeenLastCalledWith('/share-imports');
    await api.get('s1');
    expect(f).toHaveBeenLastCalledWith('/share-imports/s1');
    await api.create({ url: 'https://x', text: 'y' });
    expect(f).toHaveBeenLastCalledWith('/share-imports', { method: 'POST', body: { url: 'https://x', text: 'y' } });
    const selections = [{ candidateKey: 'k1' }] as never;
    await api.save('s1', selections);
    expect(f).toHaveBeenLastCalledWith('/share-imports/s1/save', { method: 'POST', body: { selections } });
  });
});
```

`users.test.ts`:

```ts
import { usersApi } from './users';

describe('usersApi', () => {
  it('sửa hồ sơ và xóa tài khoản', async () => {
    const f = jest.fn().mockResolvedValue(undefined);
    const api = usersApi(f);
    await api.update({ displayName: 'Lan' });
    expect(f).toHaveBeenLastCalledWith('/users/me', { method: 'PATCH', body: { displayName: 'Lan' } });
    await api.update({ interests: ['cafe'] });
    expect(f).toHaveBeenLastCalledWith('/users/me', { method: 'PATCH', body: { interests: ['cafe'] } });
    await api.remove();
    expect(f).toHaveBeenLastCalledWith('/users/me', { method: 'DELETE' });
  });
});
```

`index.test.tsx`:

```tsx
import { renderHook } from '@testing-library/react-native';

import { useApi } from './index';

const mockAuthFetch = jest.fn().mockResolvedValue([]);
jest.mock('@/auth/auth-context', () => ({ useAuth: () => ({ authFetch: mockAuthFetch }) }));

describe('useApi', () => {
  it('dựng các module trên authFetch của phiên, giữ nguyên object giữa các lần render', async () => {
    const { result, rerender } = renderHook(() => useApi());
    const first = result.current;
    await first.itineraries.list();
    expect(mockAuthFetch).toHaveBeenCalledWith('/itineraries');
    rerender({});
    expect(result.current).toBe(first);
    expect(Object.keys(first).sort()).toEqual(
      ['groups', 'invites', 'itineraries', 'places', 'recommendations', 'regions', 'savedPlaces', 'shareImports', 'users', 'visits'],
    );
  });
});
```

Run: `pnpm --filter @rong/mobile test -- src/api`
Expected: FAIL — các module mới chưa có.

- [ ] **Step 2: Triển khai**

`groups.ts`:

```ts
import type { CreatedGroupInvite, GroupDetail, GroupSummary, InviteRole } from '@rong/shared-types';

import type { Fetcher } from './client';

export const groupsApi = (f: Fetcher) => ({
  list: () => f<GroupSummary[]>('/groups'),
  get: (id: string) => f<GroupDetail>(`/groups/${id}`),
  create: (name: string) => f<GroupDetail>('/groups', { method: 'POST', body: { name } }),
  rename: (id: string, name: string) => f<void>(`/groups/${id}`, { method: 'PATCH', body: { name } }),
  remove: (id: string) => f<void>(`/groups/${id}`, { method: 'DELETE' }),
  setMemberRole: (groupId: string, userId: string, role: InviteRole) =>
    f<void>(`/groups/${groupId}/members/${userId}`, { method: 'PATCH', body: { role } }),
  /** Cả rời nhóm (chính mình) lẫn mời người khác ra. */
  removeMember: (groupId: string, userId: string) =>
    f<void>(`/groups/${groupId}/members/${userId}`, { method: 'DELETE' }),
  createInvite: (groupId: string, role: InviteRole) =>
    f<CreatedGroupInvite>(`/groups/${groupId}/invites`, { method: 'POST', body: { role } }),
  /** Đưa lịch trình về danh sách riêng của người tạo, không xóa. */
  removeItinerary: (groupId: string, itineraryId: string) =>
    f<void>(`/groups/${groupId}/itineraries/${itineraryId}`, { method: 'DELETE' }),
});
```

Lưu ý: `group/[id].tsx:127` truyền `role` có kiểu theo state của màn; nếu đó là `GroupRole` chứ không phải `InviteRole`, đổi tham số `setMemberRole` sang đúng kiểu ấy (typecheck báo ở đợt 2).

`invites.ts`:

```ts
import type { GroupDetail, InvitePreview } from '@rong/shared-types';

import type { Fetcher } from './client';

export const invitesApi = (f: Fetcher) => ({
  preview: (token: string) => f<InvitePreview>(`/invites/${encodeURIComponent(token)}`),
  accept: (token: string) => f<GroupDetail>(`/invites/${encodeURIComponent(token)}/accept`, { method: 'POST' }),
});
```

`share-imports.ts`:

```ts
import type {
  CreateShareImportRequest,
  SaveShareImportResponse,
  ShareImport,
  ShareImportSelection,
  ShareImportSummary,
} from '@rong/shared-types';

import type { Fetcher } from './client';

export const shareImportsApi = (f: Fetcher) => ({
  list: () => f<ShareImportSummary[]>('/share-imports'),
  get: (id: string) => f<ShareImport>(`/share-imports/${id}`),
  create: (body: CreateShareImportRequest) => f<{ id: string }>('/share-imports', { method: 'POST', body }),
  save: (id: string, selections: ShareImportSelection[]) =>
    f<SaveShareImportResponse>(`/share-imports/${id}/save`, { method: 'POST', body: { selections } }),
});
```

`users.ts`:

```ts
import type { PlaceCategory, UserProfile } from '@rong/shared-types';

import type { Fetcher } from './client';

export const usersApi = (f: Fetcher) => ({
  update: (body: { displayName: string } | { interests: PlaceCategory[] }) =>
    f<UserProfile>('/users/me', { method: 'PATCH', body }),
  remove: () => f<void>('/users/me', { method: 'DELETE' }),
});
```

`index.ts`:

```ts
import { useMemo } from 'react';

import { useAuth } from '@/auth/auth-context';

import type { Fetcher } from './client';
import { groupsApi } from './groups';
import { invitesApi } from './invites';
import { itinerariesApi } from './itineraries';
import { placesApi } from './places';
import { recommendationsApi } from './recommendations';
import { regionsApi } from './regions';
import { savedPlacesApi } from './saved-places';
import { shareImportsApi } from './share-imports';
import { usersApi } from './users';
import { visitsApi } from './visits';

export function createApi(f: Fetcher) {
  return {
    itineraries: itinerariesApi(f),
    recommendations: recommendationsApi(f),
    visits: visitsApi(f),
    places: placesApi(f),
    regions: regionsApi(f),
    savedPlaces: savedPlacesApi(f),
    groups: groupsApi(f),
    invites: invitesApi(f),
    shareImports: shareImportsApi(f),
    users: usersApi(f),
  };
}

export type Api = ReturnType<typeof createApi>;

/** API của phiên hiện tại: làm mới token và 401 vẫn do `authFetch` lo. */
export function useApi(): Api {
  const { authFetch } = useAuth();
  return useMemo(() => createApi(authFetch), [authFetch]);
}
```

- [ ] **Step 3: Chạy test**

Run: `pnpm --filter @rong/mobile test -- src/api && pnpm --filter @rong/mobile typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/api
git commit -m "feat(mobile): api modules for groups, invites, share imports and users; createApi and useApi"
```

---

### Task 6: Query key và `QueryClient`

**Files:**
- Modify: `apps/mobile/package.json`, `pnpm-lock.yaml` (thêm `@tanstack/react-query`)
- Create: `apps/mobile/src/api/query-keys.ts`, `apps/mobile/src/api/query-client.ts`
- Test: `apps/mobile/src/api/query-client.test.ts`

**Interfaces:**
- Consumes: `toApiError` (Task 2).
- Produces:
  - `qk` (đúng như spec).
  - `shouldRetry(failureCount: number, error: unknown): boolean`
  - `createQueryClient(): QueryClient`
  - `connectFocusManager(): () => void`

- [ ] **Step 1: Cài thư viện**

Run: `pnpm --filter @rong/mobile add @tanstack/react-query@^5`
Expected: thêm vào `dependencies`.

- [ ] **Step 2: Test**

```ts
import { focusManager } from '@tanstack/react-query';
import { AppState } from 'react-native';

import { ApiError } from '@/lib/api';

import { connectFocusManager, createQueryClient, shouldRetry } from './query-client';

describe('shouldRetry', () => {
  it('mất mạng và lỗi máy chủ: thử lại tối đa 2 lần', () => {
    const network = new ApiError(0, 'NETWORK_ERROR', 'mạng');
    expect(shouldRetry(0, network)).toBe(true);
    expect(shouldRetry(1, network)).toBe(true);
    expect(shouldRetry(2, network)).toBe(false);
    expect(shouldRetry(0, new ApiError(503, 'HTTP_503', 'bận'))).toBe(true);
  });

  it('4xx (kể cả hết phiên) không thử lại', () => {
    expect(shouldRetry(0, new ApiError(401, 'SESSION_EXPIRED', 'hết phiên'))).toBe(false);
    expect(shouldRetry(0, new ApiError(404, 'NOT_FOUND', 'không có'))).toBe(false);
    expect(shouldRetry(0, new ApiError(400, 'VALIDATION_ERROR', 'sai'))).toBe(false);
  });

  it('lỗi lạ coi như UNKNOWN: không thử lại', () => {
    expect(shouldRetry(0, new Error('boom'))).toBe(false);
  });
});

describe('createQueryClient', () => {
  it('mặc định: staleTime 30 s, query dùng shouldRetry, mutation không retry', () => {
    const client = createQueryClient();
    const { queries, mutations } = client.getDefaultOptions();
    expect(queries?.staleTime).toBe(30_000);
    expect(queries?.retry).toBe(shouldRetry);
    expect(mutations?.retry).toBe(false);
  });
});

describe('connectFocusManager', () => {
  it('AppState active → focused, background → không; gỡ listener khi dọn', () => {
    const remove = jest.fn();
    let listener: (state: string) => void = () => undefined;
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      listener = handler as (state: string) => void;
      return { remove } as never;
    });
    const disconnect = connectFocusManager();
    listener('background');
    expect(focusManager.isFocused()).toBe(false);
    listener('active');
    expect(focusManager.isFocused()).toBe(true);
    disconnect();
    expect(remove).toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

Run: `pnpm --filter @rong/mobile test -- src/api/query-client.test.ts`
Expected: FAIL — `Cannot find module './query-client'`.

- [ ] **Step 3: Triển khai**

`query-keys.ts`:

```ts
/** Mọi query key ở một chỗ, theo cây để invalidate cả nhánh (ví dụ `qk.itineraries.all`). */
export const qk = {
  itineraries: {
    all: ['itineraries'] as const,
    list: () => ['itineraries', 'list'] as const,
    detail: (id: string) => ['itineraries', id] as const,
  },
  places: {
    detail: (id: string) => ['places', id] as const,
    google: (googlePlaceId: string) => ['places', 'google', googlePlaceId] as const,
  },
  regions: {
    search: (q: string, online: boolean) => ['regions', 'search', q, online] as const,
    places: (id: string) => ['regions', id, 'places'] as const,
    placeSearch: (id: string, q: string) => ['regions', id, 'place-search', q] as const,
    weather: (id: string, from: string, to: string) => ['regions', id, 'weather', from, to] as const,
  },
  groups: {
    all: ['groups'] as const,
    detail: (id: string) => ['groups', id] as const,
  },
  savedPlaces: ['saved-places'] as const,
  recommendations: {
    all: ['recommendations'] as const,
    feed: (theme: string) => ['recommendations', 'feed', theme] as const,
  },
  shareImports: {
    all: ['share-imports'] as const,
    detail: (id: string) => ['share-imports', id] as const,
  },
  me: ['users', 'me'] as const,
  pendingVisits: ['visits', 'pending'] as const,
};
```

`query-client.ts`:

```ts
import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState } from 'react-native';

import { toApiError } from './client';

/** Mở lại màn trong khoảng này thì dùng dữ liệu đã có, không gọi lại. */
const STALE_MS = 30_000;
const MAX_RETRIES = 2;

/** Chỉ thử lại khi có thể tự khỏi (mất mạng, máy chủ lỗi); 4xx có nghĩa với màn hình nên trả ngay. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  const apiError = toApiError(error);
  return apiError.code === 'NETWORK_ERROR' || apiError.status >= 500;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: STALE_MS, retry: shouldRetry },
      mutations: { retry: false },
    },
  });
}

/** React Native không có sự kiện focus cửa sổ: app trở lại foreground thì tải lại các query đã cũ. */
export function connectFocusManager(): () => void {
  const subscription = AppState.addEventListener('change', (state) => focusManager.setFocused(state === 'active'));
  return () => subscription.remove();
}
```

- [ ] **Step 4: Chạy test**

Run: `pnpm --filter @rong/mobile test -- src/api && pnpm --filter @rong/mobile typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/package.json pnpm-lock.yaml apps/mobile/src/api/query-keys.ts apps/mobile/src/api/query-client.ts apps/mobile/src/api/query-client.test.ts
git commit -m "feat(mobile): TanStack Query client, retry policy and query keys"
```

---

### Task 7: `QueryProvider` trong layout gốc, xóa cache khi đổi người dùng, helper test

**Files:**
- Create: `apps/mobile/src/api/query-provider.tsx`, `apps/mobile/src/test-utils/query.tsx`
- Modify: `apps/mobile/src/app/_layout.tsx:45-47`
- Test: `apps/mobile/src/api/query-provider.test.tsx`

**Interfaces:**
- Consumes: `createQueryClient`, `connectFocusManager` (Task 6); `useAuth().session?.user.id`.
- Produces:
  - `QueryProvider({ children })`.
  - `src/test-utils/query.tsx`: `createTestQueryClient(): QueryClient`, `queryWrapper(client): ({ children }) => JSX.Element` — đợt 2 dùng với `render`/`renderHook`.

- [ ] **Step 1: Test**

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { QueryProvider } from './query-provider';

let mockUserId: string | null = 'u1';
jest.mock('@/auth/auth-context', () => ({
  useAuth: () => ({ session: mockUserId ? { user: { id: mockUserId } } : null }),
}));

function Probe() {
  const client = useQueryClient();
  const cached = client.getQueryData<string>(['probe']);
  return <Text testID="probe">{cached ?? 'trống'}</Text>;
}

describe('QueryProvider', () => {
  it('đổi người dùng hay đăng xuất thì xóa cache của người trước', () => {
    let client: ReturnType<typeof useQueryClient> | null = null;
    function Capture() {
      client = useQueryClient();
      return null;
    }
    mockUserId = 'u1';
    const view = render(
      <QueryProvider>
        <Capture />
        <Probe />
      </QueryProvider>,
    );
    client!.setQueryData(['probe'], 'của u1');
    view.rerender(
      <QueryProvider>
        <Capture />
        <Probe />
      </QueryProvider>,
    );
    expect(client!.getQueryData(['probe'])).toBe('của u1');

    mockUserId = 'u2';
    view.rerender(
      <QueryProvider>
        <Capture />
        <Probe />
      </QueryProvider>,
    );
    expect(client!.getQueryData(['probe'])).toBeUndefined();

    client!.setQueryData(['probe'], 'của u2');
    mockUserId = null;
    view.rerender(
      <QueryProvider>
        <Capture />
        <Probe />
      </QueryProvider>,
    );
    expect(client!.getQueryData(['probe'])).toBeUndefined();
  });
});
```

Run: `pnpm --filter @rong/mobile test -- src/api/query-provider.test.tsx`
Expected: FAIL — `Cannot find module './query-provider'`.

- [ ] **Step 2: Triển khai**

`query-provider.tsx`:

```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useAuth } from '@/auth/auth-context';

import { connectFocusManager, createQueryClient } from './query-client';

/** Cache gắn với một người dùng: đăng xuất hay đổi tài khoản thì xóa, để người sau không thấy dữ liệu người trước. */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  const userId = useAuth().session?.user.id ?? null;
  const previousUserId = useRef(userId);

  useEffect(() => {
    if (previousUserId.current === userId) return;
    previousUserId.current = userId;
    client.clear();
  }, [client, userId]);

  useEffect(() => connectFocusManager(), []);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```

`src/app/_layout.tsx`: import `QueryProvider` từ `@/api/query-provider`, bọc `RootNavigator`:

```tsx
        <AuthProvider>
          <QueryProvider>
            <RootNavigator />
          </QueryProvider>
        </AuthProvider>
```

`src/test-utils/query.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/** Test không thử lại và giữ cache tới hết test, để assert ổn định. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
}

export function queryWrapper(client: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
```

- [ ] **Step 3: Chạy toàn bộ**

Run: `pnpm --filter @rong/mobile test && pnpm --filter @rong/mobile typecheck && pnpm --filter @rong/mobile lint && pnpm --filter @rong/mobile knip`
Expected: jest tất cả PASS (111 test cũ + test mới của đợt); typecheck PASS; lint chỉ cảnh báo có sẵn; knip exit 0.

- [ ] **Step 4: Thử app**

Run: `pnpm --filter @rong/mobile start` (Metro), mở app trên Android: đăng nhập, mở vài tab, đăng xuất, đăng nhập lại — app chạy như trước (đợt này chưa màn nào dùng cache). Không có thiết bị thì ghi lại là chưa thử.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/api/query-provider.tsx apps/mobile/src/api/query-provider.test.tsx apps/mobile/src/test-utils/query.tsx apps/mobile/src/app/_layout.tsx
git commit -m "feat(mobile): QueryProvider in the root layout, cleared when the user changes"
```
