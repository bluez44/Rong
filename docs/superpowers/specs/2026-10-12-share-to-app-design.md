# F4 — Chia sẻ vào app (Share-to-app)

| | |
| --- | --- |
| Ngày | 12/10/2026 |
| Trạng thái | Đã duyệt thiết kế, chờ duyệt spec |
| Phạm vi | `apps/backend`, `apps/mobile`, `packages/shared-types` |
| PRD liên quan | F4 (mục 6.4): FR-4.1–4.5, 4.7 (một phần), 4.8; mục 7.4 |

## 1. Bối cảnh

Người dùng thấy một quán, một điểm check-in trong video TikTok, bài Facebook,
Instagram, YouTube hay một bài báo, rồi bấm "Chia sẻ" sang Rong. App nhận link
và văn bản đi kèm, backend nhận diện các địa điểm được nhắc tới, người dùng xác
nhận, và địa điểm vào danh sách "Muốn đi" (`saved_places`) kèm nguồn.

Hiện `modules/share-import/` chỉ là thư mục trống. `saved_places` đã có
(`PUT/DELETE /saved-places/:placeId`) nhưng chỉ trỏ được tới dòng `places` lấy
từ OSM: `osm_type`, `osm_id`, `location` đều `NOT NULL`.

### 1.1 Ngoài phạm vi

| Hạng mục | PRD | Ghi chú |
| --- | --- | --- |
| Thông báo đẩy khi xử lý > 5 giây | FR-4.7 | Chưa có hạ tầng push; client tự hỏi lại và có mục "Đang nhận diện" |
| Tín hiệu cộng đồng | FR-4.6 | Khi làm `ranking/` |
| Chia sẻ file ảnh / video | — | Chỉ nhận URL và văn bản |
| Hàng đợi bền (BullMQ) | §8 | Chạy nền trong process; đổi khi cần tách worker |
| Thẻ nhúng phát được video | FR-4.5 | Bản đầu chỉ hiện thẻ nguồn (ảnh thu nhỏ, tiêu đề, nền tảng) và mở link gốc |

### 1.2 Sai khác có chủ ý so với PRD

- **Địa điểm Google được lưu thành dòng `places`.** PRD chỉ nói "chỉ lưu
  place_id". Dòng này giữ `google_place_id`, tên lấy từ nội dung người dùng
  chia sẻ (không phải tên Google), loại do AI phân từ chính nội dung đó, và tọa
  độ Google có hạn 30 ngày. Không trường nào khác của Google được lưu.

## 2. Các quyết định thiết kế

### 2.1 Bảng `places` có hai nguồn

Một địa điểm nhắc trong video thường chưa có trong danh mục OSM (quán mới, quán
nhỏ). Để vẫn lưu được vào "Muốn đi", `places` nhận thêm dòng `source = 'google'`.

Hệ quả bắt buộc theo PRD §7.4 ("không xếp hạng, sắp xếp dựa trên dữ liệu
Google"): dòng Google **không bao giờ** xuất hiện ở
- danh sách địa điểm vùng v1 (`places.service.ts`), kể cả fallback và phân trang;
- khớp danh mục của v2 (`places-v2.service.ts` `matchCatalog`);
- địa điểm "extras" tự thêm khi lập lịch trình và gợi ý thay thế
  (`itineraries.service.ts`);
- danh sách địa điểm được warm (`places-warmer.ts`).

Mọi truy vấn đó thêm `AND p.source = 'osm'`.

### 2.2 Địa điểm Google dùng được trong lịch trình nếu người dùng tự chọn

Khi người dùng chọn một địa điểm Google (từ "Muốn đi") để lập lịch trình, nó
được phân cụm và tính quãng đường bằng tọa độ đã cache. Tọa độ hết hạn thì gọi
lại Google trước khi phân cụm; gọi không được thì bỏ địa điểm đó ra và báo trong
cảnh báo của lịch trình. Lý do: người dùng tự chọn, hệ thống không xếp hạng.

### 2.3 Xử lý nền bằng bảng job, client hỏi lại

`POST /share-imports` ghi một dòng `pending` và trả `202` ngay; công việc chạy
nền trong process NestJS (không `await` trong request). Client gọi
`GET /share-imports/:id` mỗi 1,5 giây. Kết quả nằm trong DB nên thoát app vẫn
không mất. Khi boot, job `pending` tạo trước hơn 2 phút được đánh dấu `failed`
với `error_code = 'INTERRUPTED'`.

### 2.4 Dòng Google chỉ được tạo khi người dùng lưu

Bước nhận diện chỉ ghi ứng viên vào `share_imports.candidates`. Dòng `places`
nguồn Google được tạo (hoặc dùng lại theo `google_place_id`) ở
`POST /share-imports/:id/save`, nên ứng viên bị bỏ qua không để lại dòng rác.

## 3. Dữ liệu

### 3.1 Migration `places`

```sql
ALTER TABLE places
  ADD COLUMN source text NOT NULL DEFAULT 'osm',
  ADD COLUMN location_expires_at timestamptz,
  ALTER COLUMN osm_type DROP NOT NULL,
  ALTER COLUMN osm_id DROP NOT NULL,
  ALTER COLUMN location DROP NOT NULL,
  ADD CONSTRAINT chk_place_source CHECK (
    (source = 'osm' AND osm_type IS NOT NULL AND osm_id IS NOT NULL AND location IS NOT NULL)
    OR (source = 'google' AND google_place_id IS NOT NULL)
  );
CREATE UNIQUE INDEX uq_place_google ON places (google_place_id) WHERE source = 'google';
```

- `composite_score` của dòng Google là `0` (cột vẫn `NOT NULL`, không bao giờ
  được dùng để xếp).
- `location` của dòng Google là tọa độ Google, `location_expires_at = now() + 30 ngày`.
  Tác vụ dọn `GoogleLocationJanitor` (chạy mỗi 6 giờ, độc lập với
  `PLACES_WARMUP`) đặt `location = NULL, location_expires_at = NULL` cho dòng
  đã quá hạn, và đặt `candidates = '[]'` cho `share_imports` quá 30 ngày (ứng
  viên có tọa độ Google; `metadata` giữ lại cho thẻ nguồn). Ai cần tọa độ thì gọi `PlaceLocationService.ensure(ids)`
  (mục 4.5).
- `uq_place_osm (osm_type, osm_id)` giữ nguyên; Postgres coi `NULL` là khác
  nhau nên dòng Google không đụng ràng buộc này.

### 3.2 Bảng `share_imports`

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| `id` | uuid PK | |
| `user_id` | uuid FK users, `ON DELETE CASCADE` | |
| `url` | text null | URL đã chuẩn hóa (sau khi theo redirect) |
| `shared_text` | text null | Văn bản người dùng gửi, cắt ở 5 000 ký tự |
| `status` | text | `pending` / `done` / `failed` |
| `platform` | text null | `tiktok` / `youtube` / `facebook` / `instagram` / `web` |
| `metadata` | jsonb null | `{ title, authorName, thumbnailUrl }` — chỉ để hiện thẻ nguồn |
| `candidates` | jsonb | Mảng `StoredCandidate` (mục 4.4), mặc định `[]` |
| `error_code` | text null | |
| `created_at` | timestamptz | |
| `finished_at` | timestamptz null | |

Index `(user_id, created_at DESC)`.

### 3.3 Migration `saved_places`

```sql
ALTER TABLE saved_places
  ADD COLUMN source text NOT NULL DEFAULT 'manual',   -- 'manual' | 'share'
  ADD COLUMN share_import_id uuid REFERENCES share_imports(id) ON DELETE SET NULL;
```

`SavedPlacesService.save` nhận thêm `source` và `shareImportId` (mặc định
`'manual'`, `null`). `MAX_SAVED_PLACES` áp dụng như cũ.

## 4. Backend — module `share-import`

```
modules/share-import/
  share-import.module.ts
  share-imports.controller.ts
  share-imports.service.ts      # điều phối job, lưu
  link-metadata.service.ts      # gateway: oEmbed / Open Graph, chống SSRF
  share-url.ts                  # tách & chuẩn hóa URL, nhận diện nền tảng (thuần)
  place-extraction.ts           # Gemini structured output + grounding
  place-resolver.ts             # catalog → Google, độ tin cậy (thuần với deps tiêm vào)
  region-assign.ts              # chọn vùng theo bbox nhỏ nhất (SQL)
  dto/
```

### 4.1 `share-url.ts`

- Tách URL http(s) đầu tiên trong `text` nếu `url` không có.
- Nhận diện nền tảng theo host: `tiktok.com`, `vm.tiktok.com`, `youtube.com`,
  `youtu.be`, `facebook.com`, `fb.watch`, `instagram.com`; còn lại là `web`.
- Bỏ tham số theo dõi (`utm_*`, `igsh`, `si`, `fbclid`).

### 4.2 `LinkMetadataService` (gateway)

- **Chống SSRF:** chỉ `http`/`https`, cổng 80/443; phân giải DNS và từ chối IP
  loopback, private, link-local, CGNAT, IPv6 ULA; theo tối đa 5 redirect và
  kiểm tra lại mỗi bước. Timeout 5 giây, đọc tối đa 1 MB, chỉ `text/html` hoặc
  JSON.
- **oEmbed:** TikTok (`https://www.tiktok.com/oembed`), YouTube
  (`https://www.youtube.com/oembed`). Facebook/Instagram dùng Graph oEmbed khi
  có `META_OEMBED_TOKEN`.
- **Open Graph:** còn lại, hoặc khi oEmbed lỗi: `og:title`, `og:description`,
  `og:image`, `<title>`, `meta[name=description]`.
- Trả `{ platform, finalUrl, title, description, authorName, thumbnailUrl } | null`.
  Không bao giờ ném lỗi vì nền tảng chặn; trả `null`.
- User-Agent dạng trình duyệt có ghi `Rong` và email liên hệ
  (`OPEN_DATA_CONTACT_EMAIL`).

### 4.3 `place-extraction.ts`

- Đầu vào: `title`, `description`, `authorName`, `shared_text`.
- Một lần gọi Gemini qua `src/chat-models/` (structured output,
  `thinkingLevel: 'LOW'`), trả tối đa 15 mục
  `{ name, category: PlaceCategory, regionHint: string | null, address: string | null, quote }`.
- Grounding: tái dùng `web-grounding.ts` để chỉ giữ mục mà `name` thực sự xuất
  hiện trong văn bản đầu vào (so khớp đã bỏ dấu). Phần so khớp tên dùng chung
  được tách ra nếu cần, không nhân bản.
- Gộp trùng theo tên đã bỏ dấu.

### 4.4 `place-resolver.ts`

Với mỗi tên đã grounding:

1. **Vùng gợi ý:** `regionHint` → tìm vùng bằng `RegionsService` (searchKey,
   không gọi Nominatim). Không có thì `null`.
2. **Catalog OSM:** cùng truy vấn `similarity` / tỉ lệ độ dài như v2, chỉ
   `source = 'osm'`, trong bbox vùng gợi ý; không có vùng thì toàn quốc với
   `CATALOG_MIN_SIMILARITY + 0.15`. Khớp → `confidence: 'high'`, một lựa chọn
   `{ kind: 'catalog', placeId }`.
3. **Google Text Search** (`GooglePlacesService.searchPlaces`, mới): `textQuery`
   = tên + địa chỉ + tên vùng, `regionCode: 'VN'`, `locationBias` theo bbox vùng
   nếu có, `fieldMask: places.id,places.location`, `pageSize: 3`.
   - Kết quả đầu nằm trong bbox vùng gợi ý → `high`, một lựa chọn.
   - Ngược lại → `low`, tối đa 3 lựa chọn.
   - Google tắt / lỗi → bỏ bước này (log một dòng gộp như v2).
4. Không có lựa chọn nào → ứng viên `confidence: 'none'` (app chỉ cho "Tự tìm").

Mỗi lựa chọn được gán vùng (`region-assign.ts`): vùng có bbox chứa tọa độ, nếu
nhiều thì bbox diện tích nhỏ nhất; không có vùng nào chứa thì bỏ lựa chọn đó.

`StoredCandidate` lưu trong `share_imports.candidates`:

```ts
{
  key: string;                // 'c1', 'c2', …
  name: string;               // tên AI trích từ nội dung người dùng
  category: PlaceCategory;
  quote: string;              // trích đoạn ngắn ≤ 200 ký tự
  confidence: 'high' | 'low' | 'none';
  options: Array<
    | { kind: 'catalog'; placeId: string; regionId: string }
    | { kind: 'google'; googlePlaceId: string; lat: number; lng: number; regionId: string }
  >;
}
```

Tọa độ Google trong `candidates` theo cùng hạn 30 ngày: job quá 30 ngày thì
`/save` từ chối lựa chọn Google với `SHARE_IMPORT_EXPIRED`.

### 4.5 `PlaceLocationService` (trong `modules/places`)

`ensure(placeIds)`: với dòng Google có `location IS NULL`, gọi
`GooglePlacesService.locate(googlePlaceId)` (Place Details, `fieldMask: location`),
ghi lại tọa độ và hạn mới. Trả danh sách id không lấy được tọa độ.
Dùng ở: lập lịch trình (mục 5.2), `PUT /itineraries/:id` (retime).

### 4.6 API

Mọi route cần đăng nhập. Job không thuộc người gọi → `404 SHARE_IMPORT_NOT_FOUND`.

| Route | Thân / trả về |
| --- | --- |
| `POST /share-imports` | `{ url?: string; text?: string }` (ít nhất một, `url` ≤ 2 048, `text` ≤ 5 000) → `202 { id }` |
| `GET /share-imports` | 20 lượt gần nhất trong 7 ngày → `ShareImportSummary[]` |
| `GET /share-imports/:id` | → `ShareImport` |
| `POST /share-imports/:id/save` | `{ selections: { candidateKey; option: ShareImportOptionRef }[] }` (1–15) → `{ saved: number }` |

`POST` kiểm tra: URL tách được phải hợp lệ (`400 INVALID_SHARE_URL`, gồm cả URL
trỏ vào IP nội bộ — kiểm tra lại trong job); tối đa 30 lượt / người / 24 giờ
(`429 SHARE_IMPORT_LIMIT`).

`/save` kiểm tra: job `done`; mỗi `candidateKey` có thật và `option` khớp một
lựa chọn đã lưu của ứng viên đó (`400 INVALID_SELECTION`). Với lựa chọn Google:
`INSERT … ON CONFLICT (google_place_id) WHERE source='google' DO UPDATE SET
location, location_expires_at` rồi lấy id. Sau đó gọi
`SavedPlacesService.save(userId, placeId, regionId, 'share', jobId)` trong cùng
transaction. Lưu lại cùng lựa chọn là idempotent.

`GET /share-imports/:id` với ứng viên `low`: lấy trực tiếp tên và địa chỉ Google
của các lựa chọn (Place Details, `displayName,formattedAddress`, song song,
timeout 3 giây) để người dùng phân biệt; không lưu, lỗi thì để trống. Lựa chọn
catalog trả tên từ `places`.

### 4.7 Job nền

```
pending
  → share-url + LinkMetadataService           (lỗi: tiếp tục với shared_text)
  → không có metadata và không có text         → failed METADATA_UNAVAILABLE
  → place-extraction                           (Gemini lỗi → failed AI_UNAVAILABLE)
  → place-resolver
  → done (candidates có thể rỗng)
```

Tổng thời gian tối đa 30 giây; quá thì `failed TIMEOUT`. Mỗi job log một dòng
thời gian từng bước (như `timing` của v2), không log nội dung Google.

### 4.8 Cấu hình

`configuration.ts` và `.env.example`: `META_OEMBED_TOKEN` (tùy chọn),
`SHARE_IMPORT_DAILY_LIMIT` (mặc định 30).

## 5. Thay đổi ở module khác

### 5.1 Places

- `places.service.ts`, `places-v2.service.ts`, `places-warmer.ts`: lọc
  `source = 'osm'`.
- `GET /places/:id` với dòng Google: tên từ `places`, mọi thứ khác (ảnh, rating,
  đánh giá, giờ mở cửa, địa chỉ) lấy trực tiếp qua `GooglePlacesService.details`.
  Không có `osm`/`wikidata`.

### 5.2 Itineraries

- "Extras" và `GET /itineraries/:id/alternatives`: lọc `source = 'osm'`.
- Tạo lịch trình: trước khi phân cụm, gọi `PlaceLocationService.ensure` cho các
  địa điểm người dùng chọn; id không lấy được tọa độ bị bỏ và thêm cảnh báo
  `PLACE_LOCATION_UNAVAILABLE`.
- `retime` khi sửa: tương tự.

### 5.3 Saved places

`SavedPlace` trả thêm `source` và, nếu từ share,
`shareSource: { platform, title, url }` (JOIN `share_imports`).

### 5.4 Groups

`group-places` không đổi hành vi: thêm địa điểm Google vào danh sách nhóm được
vì người dùng tự chọn.

### 5.5 Shared types

Thêm `ShareImport`, `ShareImportSummary`, `ShareImportCandidate`,
`ShareImportOption`, `ShareImportOptionRef`, `SharePlatform`; mở rộng
`SavedPlace`. Ứng viên trả về client:

```ts
interface ShareImportCandidate {
  key: string;
  name: string;
  category: PlaceCategory;
  quote: string;
  confidence: 'high' | 'low' | 'none';
  options: Array<{
    ref: ShareImportOptionRef;   // { kind: 'catalog', placeId } | { kind: 'google', googlePlaceId }
    name: string | null;         // catalog: tên trong places; google: tên Google lấy trực tiếp
    address: string | null;
    regionId: string;
    regionName: string;
  }>;
}
```

### 5.6 Tài liệu

Cập nhật `src/modules/README.md` (module mới, `places.source`, sai khác 1.2).

## 6. Mobile

- **Nhận nội dung:** thư viện `expo-share-intent` (config plugin) trong
  `app.config.ts`: iOS Share Extension với App Group `group.vn.rong.app`,
  Android intent filter `SEND` `text/plain`. Cần dev build mới và build EAS lại.
  Bước đầu của kế hoạch là xác nhận thư viện hỗ trợ Expo SDK 57; không hỗ trợ
  thì viết config plugin riêng, Android trước.
- **Điều hướng:** `useShareIntent` trong `(app)/_layout.tsx` (đã đăng nhập).
  Nhận share khi chưa đăng nhập → giữ intent, xử lý sau khi đăng nhập. Có share
  → `POST /share-imports` → `router.push('/share-import/<id>')`, rồi
  `resetShareIntent()`.
- **Màn `(app)/share-import/[id].tsx`** (bọc `<Screen>`, ô nhập dùng
  `<KeyboardAvoider>`):
  - Hỏi lại mỗi 1,5 giây tới khi `done`/`failed`; trong lúc chờ hiện thẻ nguồn
    (nếu đã có) và trạng thái "Đang tìm địa điểm…".
  - Ứng viên `high` tick sẵn; `low` hiện tối đa 3 lựa chọn dạng radio, kèm
    địa chỉ và tên vùng; `none` và mọi ứng viên có nút "Tự tìm" mở ô tìm địa
    điểm trong catalog (dùng API tìm sẵn có) — chọn xong lưu bằng
    `PUT /saved-places/:placeId` với `source` thủ công.
  - Nút "Lưu N địa điểm" → `/save` → sang tab Muốn đi.
  - `failed` hoặc không có ứng viên: ô "Dán mô tả" → tạo job mới chỉ có `text`
    (FR-4.8).
- **Tab `saved.tsx`:** mục "Đang nhận diện" (`GET /share-imports`, lượt
  `pending` và lượt `done` chưa lưu gì), nhãn "Từ TikTok/YouTube/…" cho địa
  điểm có `shareSource`, chạm vào mở link gốc.

## 7. Lỗi

| Mã | HTTP | Khi |
| --- | --- | --- |
| `INVALID_SHARE_URL` | 400 | Không có URL/text hợp lệ, scheme lạ, IP nội bộ |
| `SHARE_IMPORT_LIMIT` | 429 | Quá giới hạn 24 giờ |
| `SHARE_IMPORT_NOT_FOUND` | 404 | Không có hoặc không thuộc người gọi |
| `SHARE_IMPORT_NOT_READY` | 409 | `/save` khi job chưa `done` |
| `INVALID_SELECTION` | 400 | Lựa chọn không có trong ứng viên |
| `SHARE_IMPORT_EXPIRED` | 400 | Lựa chọn Google của job quá 30 ngày |
| `SAVED_LIMIT` | 400 | Như `saved-places` |

`error_code` của job: `METADATA_UNAVAILABLE`, `AI_UNAVAILABLE`, `TIMEOUT`,
`INTERRUPTED`.

## 8. Kiểm thử

**Unit (vitest):**
- `share-url`: tách URL khỏi caption, nhận diện nền tảng, bỏ tham số theo dõi.
- `LinkMetadataService`: từ chối IP nội bộ, redirect sang IP nội bộ, quá 1 MB,
  sai content-type; đọc oEmbed TikTok/YouTube; đọc Open Graph; nền tảng chặn →
  `null`.
- `place-extraction`: grounding loại tên bịa, gộp trùng (Gemini giả).
- `place-resolver`: catalog → `high`; Google trong vùng → `high`; ngoài vùng →
  `low` ≤ 3; Google tắt → chỉ catalog; không gì → `none`.
- `region-assign`: chọn bbox nhỏ nhất.

**e2e (`test/share-imports.e2e-spec.ts`,** Gemini, metadata và Google giả qua
`overrideProvider`):
- POST → GET hỏi lại tới `done` → save; `saved_places.source = 'share'`.
- Lưu lựa chọn Google tạo đúng một dòng `places`; hai người lưu cùng
  `googlePlaceId` dùng chung dòng.
- `INVALID_SELECTION`, `SHARE_IMPORT_NOT_READY`, 404 với job của người khác,
  `SHARE_IMPORT_LIMIT`.
- Job `pending` cũ bị đánh `INTERRUPTED` khi boot.
- **Dòng Google không xuất hiện** trong `GET /regions/:id/places`, v2, extras
  của lịch trình và alternatives.
- Lịch trình với địa điểm Google đã hết hạn tọa độ gọi `locate`; `locate` lỗi →
  cảnh báo `PLACE_LOCATION_UNAVAILABLE`.

**Live (`test/share-import.live-spec.ts`,** gọi thật, tốn tiền, chạy tay): bộ
link thật trong `test/fixtures/share-links.json`, in tỉ lệ link nhận diện đúng
≥ 1 địa điểm (mục tiêu PRD ≥ 70%).

**Mobile:** typecheck, lint; thử tay trên Android dev build với link TikTok,
YouTube, Facebook và một bài báo.
