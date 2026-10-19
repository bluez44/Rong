# Gợi ý lịch trình cá nhân hóa ở trang chủ

Ngày: 2026-10-19 · Trạng thái: chờ duyệt · Nhánh: `feat/home-recommendations` (tách từ `feat/mobile-groups`)

## Vì sao

Trang chủ mobile (`apps/mobile/src/app/(app)/(tabs)/index.tsx`) đang hiển thị dữ liệu mẫu cứng: hàng chip "mood"
(`MOOD_CHIPS`) bấm không làm gì, và ba thẻ "Hành trình cuối tuần" (`FEATURED_TRIPS`: Cần Thơ, Hà Giang, Hội An) với
ảnh, chi phí, thời tiết bịa sẵn. Người dùng muốn trang chủ **tự gợi ý lịch trình khám phá cho từng người**, dựa trên:

- sở thích đã chọn ở onboarding hoặc trang Tài khoản;
- những nơi người dùng đã đi;
- những địa điểm trong database mà người dùng chưa đi.

Hiện trạng liên quan (đã kiểm tra trong code):

- Sở thích chỉ lưu trên máy (`apps/mobile/src/lib/preferences.ts`, SecureStore); backend không biết.
- Chưa có khái niệm "đã đi".
- Danh sách địa điểm của một vùng (`region_place_lists` + `region_places`) chỉ có sau khi pipeline Tavily + Gemini chạy
  (tốn tiền, ~25 s), nên gợi ý chỉ được dùng vùng đã có danh sách `ready`.
- `ItinerariesService.create()` (`modules/itineraries/itineraries.service.ts:99`) lập lịch và lưu luôn trong một hàm.
- Backend chưa có hàng đợi hay thư viện lập lịch (job định kỳ dùng `setInterval`, ví dụ `google-location-janitor.ts`).
  `RedisConfig` có trong `config/configuration.ts` nhưng chưa ai dùng. `infra/docker-compose.yml` đã có Redis 7.

## Mục tiêu

1. Trang chủ hiện **3 thẻ gợi ý xếp dọc** (giữ kiểu thẻ hiện tại). Mỗi thẻ là một **bản nháp lịch trình được xếp như
   lịch trình thật** (chia ngày, giờ, bữa ăn, di chuyển) ở một vùng.
2. **Hàng chip chủ đề** thay cho `MOOD_CHIPS`: chủ đề cố định trong code + tối đa 3 chủ đề riêng do Gemini sinh cho
   từng người (tên tự do, kèm gợi ý vùng, ví dụ "Xứ sở dừa" · "Bến Tre, Vĩnh Long"). Chọn chip → 3 gợi ý mới theo chủ
   đề đó.
3. Bộ gợi ý **tự làm mới lúc 6:00 và 15:00** mỗi ngày (giờ Việt Nam); giữa hai mốc, mỗi tổ hợp (người dùng, chủ đề)
   được cache. Không có nút đổi tay.
4. Bản nháp được **lưu vào database và dùng chung** giữa những người có cùng thông số (kho bản nháp), cộng một lớp
   "gợi ý cho tôi" riêng từng người.
5. Bấm thẻ → **màn xem trước bản nháp**; chỉnh được ngày, đối tượng đi, số người, nhịp độ, ngân sách; bấm **Lưu** mới
   thành lịch trình riêng. Không trừ lượt AI.
6. **Nơi đã đi**: suy ra từ lịch trình đã kết thúc; sau chuyến đi, app hỏi lại "Bạn đã đến những nơi nào?" để sửa.
7. Sở thích được **đồng bộ lên server**.
8. Ảnh vùng tìm từ nguồn miễn phí (Unsplash) hoặc ảnh từ bài viết kèm nguồn.

## Không làm trong lượt này

- Redis trên production (`infra/prod/docker-compose.yml`). Lượt này chỉ chạy Redis local qua `pnpm infra:up`.
  **Phải thêm trước khi deploy** (service `redis:7-alpine`, `appendonly yes`, cùng network với backend).
- Chi phí ước tính thật (F7) và thời tiết: thẻ hiện placeholder "Đang cập nhật".
- Thông báo đẩy (gợi ý mới, nhắc xác nhận nơi đã đi).
- Màn quản trị chủ đề cố định.
- Đánh dấu "Đã đến" thủ công từ màn chi tiết địa điểm.
- Analytics cho thẻ gợi ý.
- Nút bookmark / lưu nhanh trên thẻ: chỉ lưu từ màn xem trước.

## Điều không được xảy ra

- Gợi ý kích hoạt pipeline tạo danh sách vùng theo yêu cầu của người dùng (tốn tiền, chậm). Chỉ job
  `warm-featured-regions` được tạo danh sách, và chỉ cho tập vùng nổi bật.
- Bản nháp chứa địa điểm không có trong database (FR-6.3), hoặc chủ đề do Gemini sinh trỏ tới vùng không tồn tại.
- Bản nháp hoặc thẻ chứa nơi người dùng đã xác nhận là đã đi (`confirmed`) hay suy ra là đã đi (`inferred`).
- Bản nháp trong kho chứa dữ liệu riêng của một người (ví dụ địa điểm "Muốn đi" của họ).
- Người dùng xem được gợi ý của người khác (trả 404).
- Job chạy trùng: cùng một (người dùng, khung giờ, chủ đề) chỉ có một job; scheduler không nhân đôi khi deploy lại.
- Tách `planTrip()` làm đổi hành vi `POST /itineraries`.
- Trừ lượt AI của người dùng vì bản nháp do hệ thống tạo.
- Hiển thị số liệu không có cơ sở (chi phí, thời tiết) như số thật.
- Ảnh không ghi nguồn.

## Quyết định đã chốt với người dùng

| # | Câu hỏi | Chốt |
|---|---|---|
| 1 | "Đã đi" xác định thế nào | Suy ra từ lịch trình đã kết thúc + hỏi lại sau chuyến đi |
| 2 | Gợi ý gồm gì | Thẻ vùng; bấm vào xem bản nháp xếp như lịch trình thật; Lưu mới thành lịch trình riêng |
| 3 | Lấy từ vùng nào | Vùng nổi bật ∪ vùng đã có danh sách; ưu tiên vùng có "Muốn đi"; vùng đã đi vẫn gợi ý nhưng xếp thấp |
| 4 | Thông số chuyến đi | Học từ lịch trình cũ; người mới dùng mặc định; chỉnh được ở màn xem trước |
| 5–7 | Làm mới, số thẻ | Tự làm mới 6:00 và 15:00, không nút đổi; 3 thẻ dọc như mẫu |
| 8 | Chip mood | Thành chip chủ đề; chọn chip → gợi ý mới; cache đến mốc làm mới; lưu DB để tái sử dụng |
| 9 | Tái sử dụng | Kho bản nháp chung + lớp gợi ý riêng từng người |
| 10 | Xếp bản nháp bằng gì | Heuristic trước, Gemini nâng cấp bản nháp được quan tâm; không trừ lượt AI |
| 11 | Chip lấy từ đâu | Chủ đề cố định + chủ đề riêng do job nền sinh (tên tự do kèm gợi ý vùng) |
| 12–13 | Thẻ và ảnh | Ảnh Unsplash hoặc ảnh từ bài viết có ghi nguồn; chi phí, thời tiết để placeholder |
| — | Chạy nền | BullMQ (`@nestjs/bullmq`) cho cả lập lịch lẫn xử lý job |
| — | Hệ số vùng đã đi | × 0,3 |
| — | Bookmark trên thẻ | Bỏ |

## Kiến trúc tổng quan

```
mobile index.tsx ──GET /recommendations?theme──► RecommendationsController
        │                                          │ có bộ cho khung giờ? ──► trả 'ready'
        │                                          └ chưa ──► queue.add('build-user-set', ưu tiên cao) ──► 'building'
        │ (hỏi lại mỗi 3 s)
        ▼
recommendation/[id].tsx ──GET/POST preview/save──► RecommendationsService ──► ItineraryPlanner.planTrip()

BullMQ queue "recommendations" (Redis)
  scheduler 0 6,15 * * *  ──► refresh-window ──► build-user-set × người dùng hoạt động
  scheduler 0 3 * * 1     ──► generate-user-themes (theo lô)
  scheduler 0 2 * * *     ──► warm-featured-regions
  scheduler 30 4 * * *    ──► cleanup
  theo sự kiện            ──► upgrade-draft, generate-user-themes, fetch-region-image
```

Module mới: `apps/backend/src/modules/recommendations/`. Cập nhật `src/modules/README.md` khi thêm module.

## Mô hình dữ liệu

Một migration mới, viết tay SQL như các migration hiện có. Kiểu danh mục dùng enum Postgres sẵn có `place_category`.

### `users` — thêm cột

```sql
ALTER TABLE "users" ADD COLUMN "interests" place_category[] NOT NULL DEFAULT '{}';
```

`users.last_seen_at` đã có nhưng chưa được cập nhật ở đâu (chỉ khai báo trong `user.entity.ts`). `GET
/recommendations` cập nhật nó, tối đa một lần mỗi giờ (`WHERE last_seen_at < now() - interval '1 hour'`).

### `itineraries` — thêm cột

```sql
ALTER TABLE "itineraries" ADD COLUMN "visit_reviewed_at" timestamptz;
```

### `visited_places`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `user_id` | uuid FK `users` ON DELETE CASCADE | PK cùng `place_id` |
| `place_id` | uuid FK `places` ON DELETE CASCADE | |
| `region_id` | uuid FK `regions` ON DELETE CASCADE | |
| `status` | text CHECK IN (`inferred`, `confirmed`, `rejected`) | |
| `itinerary_id` | uuid FK `itineraries` ON DELETE SET NULL, null được | lịch trình suy ra |
| `visited_at` | timestamptz NOT NULL | ngày kết thúc lịch trình, hoặc lúc xác nhận |

Index `(user_id, status)`. "Đã đi" khi chấm điểm = `status IN ('inferred','confirmed')`. Dòng `rejected` giữ lại để lần
suy ra sau không thêm lại.

### `user_themes`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK `users` ON DELETE CASCADE | |
| `label` | text NOT NULL | chuỗi tự do, tối đa 40 ký tự |
| `icon` | text NOT NULL | một trong các tên icon mobile có sẵn; sai → icon mặc định |
| `categories` | place_category[] NOT NULL | |
| `region_ids` | uuid[] NOT NULL | chỉ vùng có thật; ≥ 1 phần tử |
| `generated_at` | timestamptz NOT NULL | |
| `expires_at` | timestamptz NOT NULL | `generated_at + 7 ngày` |

Gợi ý vùng hiển thị ("Bến Tre, Vĩnh Long") ghép từ tên `regions` khi trả API, không lưu.

### Chủ đề cố định — trong code

`modules/recommendations/themes.ts`:

```ts
interface FixedTheme {
  key: string;                    // 'bien-vang'
  label: string;                  // 'Biển vắng hoàng hôn'
  icon: string;
  categories: PlaceCategory[];
  regionSourceKeys?: string[];    // giới hạn vùng (regions.source_key); không có = mọi vùng
}
```

Bộ khởi đầu lấy theo các chip mẫu hiện tại ("Trốn phố về rừng", "Ẩm thực miền Tây", "Biển vắng hoàng hôn", "Cà phê
hoài niệm", "Làng nghề thủ công"); `source_key` cụ thể chọn khi viết code từ `regions/seed/vietnam-admin.ts`.

Tập **vùng nổi bật** cũng ở đây (`FEATURED_REGION_SOURCE_KEYS`): 5 điểm đến MVP trong PRD §4.1 (Đà Lạt, Vũng Tàu, Phú
Quốc, Đà Nẵng – Hội An, TP.HCM) và vài vùng khác, theo `source_key` có thật trong seed.

### `itinerary_drafts` — kho bản nháp dùng chung

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `region_id` | uuid FK `regions` ON DELETE CASCADE | |
| `pool_key` | text NOT NULL, index thường (không UNIQUE) | sha256 của (region_id, categories đã sắp xếp, days_count, travel_party, pace, budget_tier, list_version). Một khóa có thể có nhiều biến thể (ví dụ tạo khi loại trừ nơi đã đi khác nhau), để còn chọn bản người dùng chưa thấy |
| `list_version` | timestamptz NOT NULL | = `region_place_lists.fetched_at` lúc tạo |
| `categories` | place_category[] NOT NULL | |
| `days_count` | smallint NOT NULL | |
| `travel_party` | text NOT NULL | giá trị của `TravelParty` |
| `pace` | text NOT NULL | `Pace` |
| `budget_tier` | text NOT NULL | `BudgetTier` |
| `input` | jsonb NOT NULL | `ItineraryInput`: `selectedPlaceIds: []`, `planningMode: 'ai'`, `allowAiSuggestions: true`, `preferredCategories` = categories, `startsAt`/`endsAt` theo ngày gốc |
| `days`, `unscheduled`, `warnings`, `tips`, `cost` | jsonb NOT NULL | cùng cấu trúc với `itineraries` |
| `place_ids` | uuid[] NOT NULL | mọi `placeId` trong `days`; index GIN |
| `planner` | text CHECK IN (`heuristic`, `ai`) | |
| `view_count`, `save_count` | integer NOT NULL DEFAULT 0 | |
| `upgraded_at` | timestamptz null | |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

**Ngày gốc:** mọi bản nháp xếp với ngày bắt đầu là thứ Bảy cố định `2026-01-03` (giờ bắt đầu và kết thúc lấy theo
thông số). Khi trả về cho người dùng, mọi `date`, `startsAt`, `endsAt`, giờ của từng mục được dời đúng số ngày từ ngày
gốc sang `starts_at` của gợi ý (hàm thuần `shiftDraftDates`). Giờ mở cửa theo thứ trong tuần được giữ đúng vì ngày gốc
và ngày thật cùng là thứ Bảy.

### `user_recommendations`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK `users` ON DELETE CASCADE | |
| `window_start` | timestamptz NOT NULL | mốc 6:00 hoặc 15:00 |
| `theme_key` | text NOT NULL | `default` · `fixed:<key>` · `user:<uuid>` |
| `slot` | smallint NOT NULL CHECK 0–2 | |
| `draft_id` | uuid FK `itinerary_drafts` ON DELETE CASCADE | bản nháp hiện tại (đổi khi xem trước với thông số khác) |
| `region_id` | uuid FK `regions` ON DELETE CASCADE | |
| `starts_at` | timestamptz NOT NULL | thứ Bảy kế tiếp |
| `reason` | jsonb NOT NULL | `{ matchedInterests: PlaceCategory[], newPlaceCount: number, revisit: boolean, savedCount: number }` |
| `score` | real NOT NULL | |
| `viewed_at` | timestamptz null | |
| `saved_itinerary_id` | uuid FK `itineraries` ON DELETE SET NULL | |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

UNIQUE `(user_id, window_start, theme_key, slot)`. Index `(user_id, created_at)`.

### `region_images`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `region_id` | uuid PK FK `regions` ON DELETE CASCADE | |
| `status` | text CHECK IN (`found`, `none`) | `none` = đã tìm, không có |
| `url`, `width`, `height` | text, int, int | null khi `none` |
| `source` | text CHECK IN (`unsplash`, `web`) | |
| `author`, `author_url`, `source_url`, `license` | text null | ghi công |
| `blocked` | boolean NOT NULL DEFAULT false | gỡ ngay khi có khiếu nại; `true` thì coi như không có ảnh |
| `fetched_at` | timestamptz NOT NULL | |

## Lập lịch không lưu: `planTrip()`

Tách phần lập lịch của `ItinerariesService.create()` thành `ItineraryPlanner.planTrip(input, options)` (file mới trong
`modules/itineraries/`, export từ `ItinerariesModule`):

```ts
planTrip(input: ItineraryInput, options?: {
  excludePlaceIds?: string[];   // không bao giờ xuất hiện trong kết quả
  forceHeuristic?: boolean;     // không gọi Gemini
}): Promise<{ days; unscheduled; warnings; tips; planner }>
```

- `create()` = kiểm tra nhóm, gọi `planTrip()`, lưu. Hành vi và mã lỗi không đổi (`INVALID_DATES`, `TRIP_TOO_LONG`,
  `TRIP_TOO_SHORT`, `UNKNOWN_PLACES`, `INVALID_ACCOMMODATION`, `NOT_ENOUGH_PLACES`).
- `poolInArea(regionId, categories, limit)` nhận thêm `excludePlaceIds` (`AND NOT (p.id = ANY($4::uuid[]))`), dùng cho
  cả pool điểm tham quan lẫn `foodPool`.
- Sở thích/chủ đề đi vào qua `preferredCategories` (`pickExtras` đã cộng 15 điểm cho danh mục ưu tiên).

## Tạo bộ gợi ý: `build-user-set(userId, windowStart, themeKey)`

1. **Suy ra nơi đã đi.** Với các lịch trình đã kết thúc (`ends_at < now()`) mà người dùng sở hữu hoặc là thành viên
   nhóm của lịch trình: thêm mọi `placeId` trong `days` vào `visited_places` với `status = 'inferred'`,
   `ON CONFLICT DO NOTHING`.
2. **Hồ sơ.** `interests`; tập đã đi (`inferred` + `confirmed`); thông số học từ `itineraries.input` của người dùng:
   giá trị hay gặp nhất của `travelParty`, `pace`, `budgetTier`, `adults`, `children`, và trung vị số ngày (giới hạn
   1–7). Chưa có lịch trình: `couple`, 2 người lớn, 0 trẻ em, `moderate`, `moderate`, 2 ngày (thứ Bảy 8:00 → Chủ nhật
   18:00).
3. **Chủ đề.** `default`: categories = `interests` (rỗng = không ưu tiên danh mục nào). Chủ đề cố định/riêng:
   categories của chủ đề ∪ `interests`; nếu có danh sách vùng thì chỉ xét vùng đó.
4. **Vùng ứng viên** = vùng nổi bật ∪ vùng có `region_place_lists.status = 'ready'` ∪ vùng của `saved_places` của
   người dùng; **chỉ giữ vùng có danh sách `ready`**. Chỉ xét `regions.type = 'destination'` và tỉnh/thành hiện hành
   (`type = 'administrative'`, `level = 'province'`, `boundary_version = 'current'`); bỏ phiên bản trước sáp nhập và
   xã/phường để không gợi ý trùng một nơi hai lần.
5. **Chấm điểm** — hàm thuần `scoreRegion` trong `scoring.ts`:
   - `newPlaces` = số địa điểm chưa đi trong 60 hạng đầu của vùng, thuộc categories của chủ đề (hoặc mọi danh mục trừ
     `stay`, `food` nếu chủ đề không có categories);
   - điểm = `newPlaces + 3 × số địa điểm "Muốn đi" chưa đi trong vùng`;
   - vùng có ít nhất một địa điểm đã đi: **× 0,3**;
   - vùng có trong 3 bộ gợi ý gần nhất của người dùng (mọi chủ đề): **× 0,5**;
   - loại vùng có `newPlaces < số điểm cần` (`targetStopsPerDay × số ngày`).
   Lấy 3 vùng điểm cao nhất (3 vùng khác nhau). Ít hơn 3 thì trả ít thẻ hơn.
6. **Bản nháp cho từng vùng.** Tính `pool_key`. Tìm `itinerary_drafts` có `pool_key` khớp và
   `NOT (place_ids && $visited)`; ưu tiên bản người này chưa từng được gợi ý, rồi bản `planner = 'ai'`, rồi bản mới
   nhất. Không có bản phù hợp → `planTrip(input, { excludePlaceIds: visited, forceHeuristic: true })` với ngày gốc và
   `INSERT` thành biến thể mới của cùng `pool_key`. Hai job chạy đồng thời có thể tạo hai biến thể giống nhau; chấp
   nhận được (chỉ thừa một dòng, `cleanup` dọn khi hết `list_version`). Bản nháp không chứa địa điểm "Muốn đi" riêng.
7. `starts_at` = thứ Bảy kế tiếp (hôm nay là thứ Bảy hoặc Chủ nhật → thứ Bảy tuần sau), 0:00 giờ Việt Nam + giờ bắt đầu
   của bản nháp.
8. Ghi 3 dòng `user_recommendations` (upsert theo khóa UNIQUE). Đẩy `fetch-region-image` cho vùng chưa có
   `region_images`.

## Khung giờ

Hàm thuần `windowFor(now)` trong `window.ts`, theo `Asia/Ho_Chi_Minh`:

- 6:00 ≤ giờ < 15:00 → `windowStart` = 6:00 hôm nay, `nextRefreshAt` = 15:00 hôm nay;
- 15:00 ≤ giờ → `windowStart` = 15:00 hôm nay, `nextRefreshAt` = 6:00 ngày mai;
- giờ < 6:00 → `windowStart` = 15:00 hôm qua, `nextRefreshAt` = 6:00 hôm nay.

## API

Mọi route cần đăng nhập (`JwtAuthGuard` toàn cục). Kiểu mới thêm vào `packages/shared-types/src/recommendation.ts`.

### `PATCH /users/me` (sửa)

`UpdateProfileDto`: `displayName` thành tùy chọn; thêm `interests?: PlaceCategory[]` (`IsArray`, `IsIn` theo enum, tối
đa 9, bỏ trùng). Phải có ít nhất một trường, nếu không 400 `EMPTY_UPDATE`. `UserProfile` thêm `interests:
PlaceCategory[]`. Khi `interests` đổi → đẩy `generate-user-themes`.

### `GET /recommendations?theme=<key>`

```ts
interface RecommendationFeed {
  status: 'ready' | 'building';
  windowStart: string;
  nextRefreshAt: string;
  theme: string;                    // key đang dùng; mặc định 'default'
  themes: RecommendationTheme[];    // 'default' đầu tiên; rồi chủ đề khớp sở thích; rồi phần còn lại
  items: RecommendationCard[];      // 0–3; rỗng khi 'building'
}
interface RecommendationTheme {
  key: string;
  label: string;                    // 'default' → "Dành cho bạn"
  icon: string;
  regionHint: string | null;
  kind: 'default' | 'fixed' | 'personal';
}
interface RecommendationCard {
  id: string;
  regionId: string;
  regionName: string;
  title: string;                    // "<regionName> · <tên chủ đề hoặc danh mục>"
  dayCount: number;
  nightCount: number;
  startsAt: string;
  endsAt: string;
  placeCount: number;
  highlights: string[];             // 2–3 tên địa điểm đầu tiên theo thứ tự trong lịch
  reason: string;                   // "Vì bạn thích Cà phê · 8 nơi bạn chưa đến"
  revisit: boolean;
  image: RegionImage | null;
  estimatedCost: null;              // placeholder đến F7
  weather: null;                    // placeholder
  savedItineraryId: string | null;
}
interface RegionImage {
  url: string;
  source: 'unsplash' | 'web';
  author: string | null;
  authorUrl: string | null;
  sourceUrl: string | null;
}
```

- `theme` không tồn tại hoặc chủ đề riêng của người khác → 400 `UNKNOWN_THEME`.
- Chưa có bộ cho (người dùng, khung giờ, chủ đề) → `queue.add('build-user-set', ..., { jobId:
  'user:<id>:<window>:<theme>', priority: 1 })` rồi trả `status: 'building'`.
- Cập nhật `last_seen_at` (tối đa một lần mỗi giờ).

### `GET /recommendations/:id`

Trả `ItineraryDraft`:

```ts
interface ItineraryDraft {
  recommendationId: string;
  draftId: string;
  regionId: string;
  regionName: string;
  input: ItineraryInput;            // ngày đã dời sang starts_at
  days: ItineraryDay[];
  unscheduled: UnscheduledPlace[];
  warnings: ItineraryWarning[];
  tips: string[];
  planner: 'heuristic' | 'ai';
  savedItineraryId: string | null;
}
```

Lần xem đầu của người dùng: ghi `viewed_at`, tăng `view_count` của bản nháp; nếu đạt ngưỡng → đẩy `upgrade-draft`.
Không phải của người gọi → 404 `RECOMMENDATION_NOT_FOUND`.

### `POST /recommendations/:id/preview`

Body `{ startsAt, endsAt, travelParty, adults, children, pace, budgetTier }` (validate như `CreateItineraryDto`).

- Cùng số ngày và cùng các thông số khác → chỉ dời ngày bản nháp hiện tại.
- Khác → tính `pool_key` mới, tìm trong kho hoặc `planTrip(..., { forceHeuristic: true })` đồng bộ (không qua hàng
  đợi), lưu vào kho, cập nhật `user_recommendations.draft_id` và `starts_at`. Trả `ItineraryDraft` với `draftId` mới.
- Lỗi: `INVALID_DATES`, `TRIP_TOO_LONG`, `TRIP_TOO_SHORT`, `NOT_ENOUGH_PLACES` (như `POST /itineraries`).

### `POST /recommendations/:id/save`

Body `{ draftId, startsAt, groupId? }`.

- `draftId` khác `user_recommendations.draft_id` → 404 `DRAFT_NOT_FOUND`.
- `groupId` → `AccessService` yêu cầu vai trò `editor`.
- Tạo dòng `itineraries` từ nội dung bản nháp đã dời ngày (`planner` giữ của bản nháp, `ai_edits_remaining = 3`),
  không trừ `ai_generations_used`. Tăng `save_count`, ghi `saved_itinerary_id`, kiểm tra ngưỡng `upgrade-draft`.
- Trả `Itinerary` (201).
- Đã lưu rồi (`saved_itinerary_id` khác null và lịch trình còn) → trả lại lịch trình đó (200), không tạo bản thứ hai.

### `GET /visits/pending`

```ts
interface PendingVisitReview {
  itineraryId: string;
  regionName: string;
  endsAt: string;
  places: { placeId: string; name: string; category: PlaceCategory }[];
}
```

Lịch trình đã kết thúc trong 60 ngày gần nhất, người dùng xem được, `visit_reviewed_at IS NULL`, có ít nhất một địa
điểm; mới nhất trước. `visit_reviewed_at` ghi trên lịch trình nên một người xác nhận là xong cho lịch trình đó; các
thành viên khác trong nhóm vẫn giữ dòng `inferred` của họ.

> Ghi chú khi viết kế hoạch: nếu cần xác nhận riêng từng thành viên, chuyển `visit_reviewed_at` sang một bảng
> `(itinerary_id, user_id)`. Lượt này giữ cột trên `itineraries` như đã chốt.

### `POST /visits/review`

Body `{ itineraryId, visitedPlaceIds: string[] }`. `AccessService`: cần quyền xem lịch trình, không thì 404. Địa điểm
trong `visitedPlaceIds` → `confirmed`; địa điểm còn lại của lịch trình → `rejected` (upsert). `visitedPlaceIds` chứa id
không thuộc lịch trình → 400 `INVALID_PLACES`. Ghi `visit_reviewed_at = now()`, đẩy `generate-user-themes`. Trả 204.

### Mã lỗi mới

| Mã | HTTP |
|---|---|
| `EMPTY_UPDATE` | 400 |
| `UNKNOWN_THEME` | 400 |
| `RECOMMENDATION_NOT_FOUND` | 404 |
| `DRAFT_NOT_FOUND` | 404 |
| `INVALID_PLACES` | 400 |

## Job nền (BullMQ)

### Hạ tầng

- Thêm `@nestjs/bullmq` và `bullmq` vào `apps/backend`.
- `RecommendationsModule`: `BullModule.forRootAsync` đọc `config.redis`; `BullModule.registerQueue({ name:
  'recommendations' })`; một `@Processor('recommendations')` kế thừa `WorkerHost`, `process(job)` phân nhánh theo
  `job.name`. Worker `concurrency: 4`.
- Lịch đăng ký trong `onModuleInit` bằng `queue.upsertJobScheduler(id, { pattern, tz: 'Asia/Ho_Chi_Minh' }, { name })`
  (lưu trong Redis, gọi lại không nhân đôi).
- `removeOnComplete: { age: 86400 }`, `removeOnFail: { age: 7 * 86400 }`.
- Biến môi trường mới (qua `loadConfig` và `.env.example`): `UNSPLASH_ACCESS_KEY` (tùy chọn),
  `RECOMMENDATIONS_ENABLED` (mặc định `true`; `false` thì không đăng ký scheduler, dùng cho test và máy không có Redis).
- Local: `pnpm infra:up` đã chạy Redis ở 6379, không cần sửa compose.

### Các job

| Job | Kích hoạt | Xử lý | Thử lại |
|---|---|---|---|
| `refresh-window` | `0 6,15 * * *` | Người dùng có `last_seen_at` trong 14 ngày → `addBulk` các `build-user-set` (theme `default`, `priority: 10`), lô 500 | 3 |
| `build-user-set` | `refresh-window`, hoặc `GET /recommendations` (`priority: 1`) | Mục "Tạo bộ gợi ý". `jobId` `user:<id>:<window>:<theme>` | 2, backoff 5 s |
| `upgrade-draft` | `view_count ≥ 5` hoặc `save_count ≥ 2`, `planner = 'heuristic'` | `planTrip(draft.input)` có Gemini, cùng `excludePlaceIds` lúc tạo (rỗng nếu là bản chung); chỉ ghi đè nếu kết quả `planner = 'ai'` và không chứa địa điểm ngoài `place_ids` cũ ∪ pool vùng. Ghi `upgraded_at`. Không đụng lịch trình đã lưu. `jobId` `upgrade:<draftId>` | 2; limiter 10/phút |
| `generate-user-themes` | `0 3 * * 1` (theo lô người dùng hoạt động); đổi sở thích; review nơi đã đi | Xem dưới. `jobId` `themes:<userId>:<ngày>` | 2; limiter 10/phút |
| `warm-featured-regions` | `0 2 * * *` | Vùng nổi bật chưa có danh sách hoặc quá hạn → `WebPlacesService.listForRegion()` lần lượt | 1 |
| `fetch-region-image` | vùng lần đầu vào gợi ý mà chưa có `region_images` | Xem dưới. `jobId` `image:<regionId>` | 2 |
| `cleanup` | `30 4 * * *` | Xóa `user_recommendations` > 30 ngày; bản nháp có `list_version` cũ hơn danh sách hiện tại của vùng mà không còn gợi ý trỏ tới; `user_themes` hết hạn | 1 |

### `generate-user-themes`

- Đầu vào gửi Gemini (structured output, `chat-models/`): sở thích; tên các vùng đã đi; **danh sách vùng đang có
  danh sách `ready`** (id + tên + 3 danh mục nhiều nhất).
- Đầu ra: tối đa 3 `{ label, icon, categories, regionIds }`.
- Kiểm tra bằng code: bỏ `regionIds` không có trong danh sách đã gửi; bỏ `categories` ngoài enum; bỏ chủ đề không còn
  vùng hoặc không còn danh mục; cắt `label` 40 ký tự; `icon` lạ → icon mặc định.
- Thay toàn bộ `user_themes` của người dùng trong một transaction.
- Gemini lỗi sau 2 lần thử → giữ chủ đề cũ (nếu còn hạn), người dùng vẫn có chủ đề cố định.

### `fetch-region-image`

1. Có `UNSPLASH_ACCESS_KEY`: Unsplash Search API, `query = "<tên vùng> Vietnam"`, `orientation=landscape`, lấy kết quả
   đầu. Lưu `urls.regular`, kích thước, `user.name`, `user.links.html`, `source = 'unsplash'`. Gọi
   `links.download_location` theo điều khoản API của Unsplash.
2. Không có: `region_places.image` (kiểu `PlaceImage`, hotlink kèm `sourceUrl`) của địa điểm hạng cao nhất có ảnh →
   `source = 'web'`, `source_url` = bài nguồn.
3. Vẫn không có: `status = 'none'`; tìm lại sau 30 ngày.

Ghi chú rủi ro: ảnh `web` là ảnh hotlink từ bài viết, ghi nguồn nhưng không có giấy phép. Người dùng đã chấp nhận rủi
ro này; `blocked = true` gỡ ảnh một vùng ngay.

### Khi job lỗi hẳn

- `build-user-set`: feed vẫn `building`; mobile sau ~30 s hiện "Chưa có gợi ý, thử lại sau" + "Thử lại".
  `GET /recommendations?retry=1` xóa job lỗi cùng `jobId` rồi đẩy lại.
- `generate-user-themes`, `fetch-region-image`, `upgrade-draft`: không ảnh hưởng người dùng (chủ đề cố định, mảng màu,
  bản heuristic).

## Mobile

### Tách component hiển thị lịch trình

Đưa `ItineraryStickyHeader`, `ItineraryViewBody`, `TimelineItemCard`, `TimelineTravelLeg`, `Warnings`, `AiTipsAccess`
từ `app/(app)/itinerary/[id].tsx` sang `src/components/itinerary-view/`. Props nhận kiểu chung
`Pick<Itinerary, 'input' | 'days' | 'unscheduled' | 'warnings' | 'tips' | 'planner'>` cùng `regionName`; nút "Bản đồ"
thành callback `onOpenDayMap(dayIndex)`. Màn lịch trình hiện tại không đổi giao diện.

### Trang chủ — `(tabs)/index.tsx`

- Xóa `MOOD_CHIPS`, `FEATURED_TRIPS`, `bookmarkedTrips`.
- Hàng chip từ `feed.themes`. Chip `personal` có dòng phụ nhỏ là `regionHint`. Chip đang chọn chỉ trong state.
- Khu vực "Gợi ý cho bạn" + dòng phụ "Làm mới lúc HH:mm" (`nextRefreshAt`). 3 thẻ dọc, giữ style thẻ hiện tại:
  - ảnh vùng; dòng ghi công nhỏ ("Ảnh: <author> / Unsplash" hoặc tên miền của `sourceUrl`), bấm mở link; không có ảnh →
    mảng màu (gradient) theo chủ đề đang chọn, ánh xạ từ icon của chủ đề (ba thẻ cùng chủ đề cùng màu);
  - nhãn vùng, tiêu đề, "N ngày M đêm", `reason`; nhãn "Quay lại" khi `revisit`;
  - ô chi phí và thời tiết ghi "Đang cập nhật";
  - không có nút bookmark; thẻ có `savedItineraryId` hiện nhãn "Đã lưu" và bấm mở `/itinerary/<id>`.
- Bỏ "Xem tất cả". Giữ banner "Lên lịch ngẫu hứng".
- Trạng thái: `building` → 3 thẻ khung xương; quá 30 s → `Notice` + "Thử lại"; rỗng → "Chọn sở thích hoặc mở vài
  điểm đến để Rong gợi ý cho bạn" + nút sang Tài khoản; lỗi mạng → `Notice` + thử lại.
- Hook `src/hooks/use-recommendations.ts`: `GET /recommendations?theme=`; hỏi lại mỗi 3 s khi `building` (theo kiểu
  `use-region-places.ts`); quay lại foreground sau `nextRefreshAt` thì tải lại.

### Màn xem trước — `app/(app)/recommendation/[id].tsx` (mới)

- `<Screen>`, nhãn "Bản nháp" trên header, dùng các component `itinerary-view` ở chế độ chỉ xem.
- Thanh dưới: **"Chỉnh thông tin"** mở bottom sheet chứa `TripParamsFields` (tách từ `itinerary/new.tsx`: ngày giờ, đối
  tượng đi, số người, nhịp độ, ngân sách; dùng `<KeyboardAvoider>`) → `POST /recommendations/:id/preview`;
  **"Lưu thành chuyến của tôi"** → `POST /recommendations/:id/save` → `router.replace('/itinerary/<id>')`.
- Đã lưu (`savedItineraryId`) → nút thành "Mở lịch trình đã lưu".
- `itinerary/day-map.tsx` nhận thêm tham số `recommendationId` (thay cho `id`) để vẽ bản đồ của bản nháp.

### Đồng bộ sở thích — `lib/preferences.ts`

- `updatePreferences({ interests })` khi đã đăng nhập: gửi `PATCH /users/me { interests }` sau 800 ms không đổi; lỗi
  thì đánh dấu `interestsDirty` và gửi lại ở lần mở app sau.
- Sau đăng nhập: server `interests` rỗng mà máy có → đẩy lên; ngược lại ghi bản server vào máy.

### Hỏi lại nơi đã đi

- `src/hooks/use-pending-visits.ts`: `GET /visits/pending`.
- Có kết quả → banner trên trang chủ, phía trên gợi ý: "Chuyến <regionName> đã kết thúc. Bạn đã đến những nơi nào?" (chỉ
  chuyến mới nhất).
- `src/components/visit-review-sheet.tsx`: danh sách địa điểm, mặc định đều tích; "Xác nhận" → `POST /visits/review` →
  tải lại feed. "Để sau" ẩn banner trong phiên.

## Kiểm thử

### Unit (`*.spec.ts`, vitest)

- `planTrip()`: `planning.spec.ts` hiện có qua không sửa; `excludePlaceIds` không lọt vào kết quả (cả điểm tham quan và
  quán ăn); `forceHeuristic` không gọi `LangchainService`.
- `scoreRegion`: × 0,3 vùng đã đi; × 0,5 vùng gần đây; loại vùng thiếu điểm; cộng "Muốn đi"; 3 vùng khác nhau.
- Học thông số từ lịch trình cũ; mặc định cho người mới.
- `poolKey`: ổn định với thứ tự danh mục; đổi `list_version` → khóa khác.
- Chọn biến thể trong kho: bỏ bản chứa nơi đã đi; ưu tiên bản chưa gợi ý cho người này.
- `windowFor`: 5:59, 6:00, 14:59, 15:00, 23:59, 0:00 theo giờ Việt Nam.
- `shiftDraftDates` và "thứ Bảy kế tiếp" (kể cả hôm nay là thứ Bảy, Chủ nhật).
- Kiểm tra đầu ra `generate-user-themes`.
- Thứ tự tìm ảnh; không có `UNSPLASH_ACCESS_KEY`.

### e2e (`test/recommendations.e2e-spec.ts`)

- Copy `beforeAll` của một spec có sẵn (prefix `api`, `ValidationPipe`). `RECOMMENDATIONS_ENABLED=false`; thay queue
  bằng bản giả chạy processor ngay trong process (`overrideProvider`), thay `LangchainService` và client Unsplash bằng
  bản giả. Không cần Redis.
- Dữ liệu: vùng có `region_place_lists` `ready` và `region_places` (fixture như `web-places.e2e-spec.ts`).
- Luồng: `GET` lần đầu `building` → lần sau `ready`, 3 thẻ; `GET /:id`; `preview` đổi thông số → `draftId` mới; `save`
  → `itineraries` có `aiEditsRemaining = 3`, `ai_generations_used` không đổi; lưu lần hai trả cùng lịch trình; hai người
  cùng thông số dùng chung bản nháp; `POST /visits/review` → bộ mới không chứa nơi `confirmed`; người khác gọi `GET
  /:id` → 404; `PATCH /users/me` với `interests`; `UNKNOWN_THEME`.
- Chạy trên DB dev (Neon). **Hỏi người dùng trước khi chạy `migration:run`.**

### Thủ công

- Redis local (`pnpm infra:up`), backend `start:dev`, gọi tay `refresh-window` (thêm job bằng script nhỏ trong
  `scripts/`) và xem bộ gợi ý được tạo.
- Mobile trên Expo: chọn chip, xem thẻ, xem trước, chỉnh thông tin, lưu, xác nhận nơi đã đi.

## Giai đoạn triển khai

Một spec, kế hoạch chia 3 giai đoạn; mỗi giai đoạn tự chạy và kiểm thử được:

1. **Nền:** tách `planTrip()` + `excludePlaceIds`; migration các bảng/cột mới; `PATCH /users/me` có `interests`;
   `GET /visits/pending`, `POST /visits/review`.
2. **Bộ gợi ý backend:** BullMQ, `RecommendationsModule`, chấm điểm, kho bản nháp, các job, API `/recommendations`,
   e2e.
3. **Mobile:** tách `itinerary-view`, đồng bộ sở thích, trang chủ, màn xem trước, `day-map`, banner + sheet xác nhận nơi
   đã đi.
