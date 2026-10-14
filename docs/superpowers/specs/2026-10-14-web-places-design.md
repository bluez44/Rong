# Danh sách địa điểm từ bài viết, định vị bằng Google, bỏ OSM

| | |
| --- | --- |
| Ngày | 14/10/2026 |
| Trạng thái | Đã chốt hướng, chờ duyệt spec |
| Phạm vi | `apps/backend`, `apps/mobile`, `packages/shared-types`, `docs/PRD-Rong.md` |
| PRD liên quan | F1, F2, F5, F6, F8, F9, mục 7.1, 7.4, 7.5 |

## 1. Bối cảnh

Lập lịch trình trên mobile không dùng được:

- Danh mục OSM (v1) phụ thuộc Overpass. Ngày 14/10/2026 cả ba mirror trả 504; DB dev có **0** dòng `places`.
- Khi đó `GET /regions/:id/places` trả dự phòng Gemini + Google (`source: 'ai_google_maps'`), mọi mục `id: null`.
  Mobile vẫn bật nút "Lập lịch trình" (`canPlan` chỉ đếm số mục), nhưng không mục nào có nút "+", và
  `POST /itineraries` trả 422 `NOT_ENOUGH_PLACES`.
- Pipeline v2 (Tavily + Gemini) cho danh sách tốt hơn nhưng không lưu gì vào DB, nên cũng không có `id` để lập lịch.

Quyết định (14/10/2026): **bỏ OSM cho địa điểm**. Danh sách địa điểm của một vùng lấy từ bài viết trên web
(Tavily + Gemini, như v2), mỗi địa điểm được ghép với Google Places để lấy `place_id` và tọa độ, rồi **lưu vào
`places`** để chọn và lập lịch được. Đã cân nhắc và loại phương án lấy danh sách thẳng từ Google Nearby Search:
vi phạm ToS 3.2.3(d)(iii) (dịch vụ danh bạ), không lưu được tên, không cache được nên tốn tiền theo từng người dùng.

### 1.1 Các quyết định đã chốt

| # | Quyết định |
| --- | --- |
| Q1 | Bỏ OSM cho địa điểm: Overpass, Wikidata, điểm tổng hợp OSM, warmer, dự phòng `ai_google_maps`. |
| Q2 | Địa điểm không ghép được với Google vẫn giữ, với tọa độ AI ước đoán, kèm ghi chú cho người dùng biết vị trí là gần đúng. |
| Q3 | Không dựng sẵn danh sách (không warmup). Người đầu tiên mở một vùng chờ pipeline chạy; kết quả được lưu cho người sau. |
| Q4 | Giữ Nominatim để tìm vùng (kể cả điểm đến chưa seed). Bỏ Overpass khỏi việc tính khung bao. |
| Q5 | Người dùng tìm thêm địa điểm (Google, theo tên) được cả trong form tạo lịch trình và khi sửa lịch trình. |

### 1.2 Ngoài phạm vi

| Hạng mục | Ghi chú |
| --- | --- |
| Lấy giờ mở cửa Google lúc lập lịch | Giữ cách hiện tại: AI tra, rồi giờ thông thường theo danh mục |
| Google Routes cho thời gian di chuyển | Vẫn ước tính (`planning/travel.ts`) |
| Dựng sẵn danh sách cho điểm đến đã seed | Q3 |
| Xóa dòng `osm` đã có | Giữ lại vì `saved_places` / lịch trình tham chiếu; chỉ ngừng liệt kê (mục 4.6) |

## 2. Thuật ngữ

- **Ghép (match)**: từ tên địa điểm AI trích từ bài viết, tìm đúng địa điểm đó trên Google Places, lấy `place_id`
  và tọa độ.
- **Không ghép được**: Google không trả kết quả trong vùng, hoặc trả một nơi khác (tên giống dưới ngưỡng, sai loại),
  hoặc tên quá chung / không phải một điểm ("chợ đêm", "đèo Prenn"). Khi đó dùng tọa độ AI (Q2).

## 3. Luồng tổng thể

```text
GET /api/regions/:id/places?categories=…
  ├─ danh sách của vùng còn hạn         → đọc DB, trả ngay
  ├─ quá hạn                            → trả bản trong DB, làm mới ở nền
  └─ chưa có                            → chạy pipeline (chờ, tối đa WEB_PLACES_WAIT_MS), lưu, trả
                                          quá giờ: 202-kiểu "đang tạo" → client hỏi lại (mục 4.3)

Pipeline của một vùng
  1. Tavily: các truy vấn cố định theo nhóm (tham quan, ăn uống, cà phê, lưu trú) — song song
  2. Gemini structured output: trích địa điểm + danh mục + mô tả + vị trí ước đoán
     (ít bài quá thì agent LangChain tự tìm thêm, như v2)
  3. Đối chiếu: tên phải xuất hiện trong bài đã đọc (web-grounding.ts) — giữ nguyên
  4. Ghép Google: Places Text Search trong khung bao vùng → place_id + location
     kiểm tra độ giống tên và loại; không đạt → tọa độ AI (nếu nằm trong vùng nới ~2 km), không thì bỏ
  5. Lưu: upsert `places` (source 'web') + danh sách của vùng `region_places` (thứ hạng, bài viết)
```

## 4. Backend

### 4.1 Dữ liệu

Migration mới `…-AddWebPlaces`:

- `places.source`: thêm giá trị `'web'`. Dòng `web` có:
  - `name`, `category`, `description`: từ bài viết qua Gemini (nội dung của mình, lưu được).
  - `google_place_id`: khi ghép được (lưu vô thời hạn, PRD 7.4).
  - `location` + `location_expires_at`: tọa độ Google hạn 30 ngày; **hoặc** tọa độ AI, không hết hạn.
  - `location_source text NOT NULL DEFAULT 'osm'` — `'google' | 'ai' | 'osm'`. Thay cho `locationSource` chỉ có ở response v2.
  - `composite_score` = 0 (không dùng nữa cho dòng web).
- Mỗi `google_place_id` chỉ một dòng, bất kể nguồn: đổi unique index `… WHERE source = 'google'` thành
  `… WHERE google_place_id IS NOT NULL AND source IN ('google', 'web')`. Pipeline gặp `place_id` đã có dòng
  (người dùng đã lưu từ tìm kiếm / chia sẻ) thì dùng lại dòng đó, không đổi tên.
- Bảng `region_place_lists`: `region_id` (PK, FK), `status` (`ready | building | failed`), `fetched_at`,
  `expires_at`, `error_code`, `sources jsonb` (bài viết tổng, để ghi nguồn).
- Bảng `region_places`: `region_id`, `place_id`, `rank smallint`, `articles jsonb` (tiêu đề, uri, ngày đăng),
  PK `(region_id, place_id)`. Thứ hạng là tín hiệu của mình: số bài nhắc tới, rồi thứ tự Gemini trả.
- Hạn danh sách: `WEB_PLACES_REFRESH_DAYS` (mặc định 30, khớp hạn tọa độ Google).

### 4.2 Ghép Google (`google/`)

- Thêm `GooglePlacesService.findPlace(name, bbox, hint)`:
  Text Search (New), `textQuery` = tên + tên vùng, `locationRestriction` = khung bao vùng,
  field mask `places.id,places.location,places.displayName,places.primaryType`, `pageSize` 3.
  `displayName` / `primaryType` chỉ dùng để kiểm tra trong request, **không lưu** (PRD 7.4).
- Chấp nhận kết quả đầu tiên có độ giống tên (bỏ dấu, `searchKey`) ≥ ngưỡng (bắt đầu 0.5, chỉnh theo bench) và
  loại Google không mâu thuẫn danh mục AI (`google-category.ts`; ví dụ AI nói `food`, Google ra `lodging` → loại).
- Thay Geocoding trong v2. Timeout mỗi lượt 4 s, chạy song song có giới hạn (5).
- Google tắt hoặc lỗi → mọi địa điểm dùng tọa độ AI (Q2), danh sách vẫn lưu; lần làm mới sau thử ghép lại
  các dòng `location_source = 'ai'`.

### 4.3 API danh sách

`GET /api/regions/:id/places?categories=food,cafe` (thay cả v1 và v2; xóa `/v2/regions/:id/places`):

- Đọc `region_places` của vùng, lọc danh mục, sắp theo `rank`. Không phân trang (≤ ~80 điểm / vùng).
  Mặc định ("Tất cả") bỏ `stay` như hiện nay.
- Chưa có danh sách: chạy pipeline, chờ tối đa `WEB_PLACES_WAIT_MS` (mặc định 25 s). Quá giờ trả
  `{ status: 'building', items: [] }` và pipeline chạy tiếp; client hỏi lại sau 3 s. Hai request cùng lúc cho
  một vùng dùng chung một lượt chạy (khóa trong bộ nhớ, như cache v2).
- Pipeline lỗi (Tavily/Gemini) và chưa có gì: 503 `PLACES_UNAVAILABLE`. Thiếu `TAVILY_API_KEY`: 503 như v2.
- Mỗi mục: `id` (luôn có), `name`, `category`, `coordinates`, `description`, `articles`, `locationSource`,
  `googlePlaceId?`. Dòng có tọa độ Google đã hết hạn: gọi `PlaceLocationService.ensure` trước khi trả; không lấy
  lại được thì trả `coordinates: null`.

### 4.4 Lập lịch trình

`itineraries.service.ts`:

- `poolInArea` (gợi ý thêm của AI, quán ăn cho bữa): đọc `region_places` của vùng thay vì `source = 'osm'`
  trong khung bao, sắp theo `rank`. Dòng `location_source = 'ai'` vẫn dùng được.
- `alternatives` (FR-8.3): cùng danh mục trong `region_places` của vùng, gần điểm đang thay, theo `rank`.
- `pickExtras` (`planning/clustering.ts`): thay `score` (điểm OSM) bằng điểm suy từ `rank`.
- Giờ mở cửa: không còn tag OSM; giữ thứ tự AI → giờ thông thường theo danh mục.
- Ảnh chụp lịch trình (`planning/snapshot.ts`) thêm `locationSource` để mobile hiện ghi chú vị trí gần đúng.

### 4.5 Tìm địa điểm và các module khác

- `place-search.service.ts`: phần "khớp khi đang gõ" tìm trong `region_places` của vùng thay vì `source = 'osm'`.
  Phần Google khi bấm tìm, xem trước và lưu giữ nguyên (hạn mức giữ nguyên).
- `share-import/place-resolver.ts`: khớp tên với dòng `web` (trong vùng gợi ý), không thì Google như cũ.
- `GET /places/:id`: dòng `web` có `google_place_id` thì lấy nội dung Google trực tiếp (như hiện nay);
  dòng `location_source = 'ai'` chỉ có dữ liệu của mình + bài viết nguồn.
- `RegionAreaService`: bỏ Overpass.
  - Tỉnh cũ: ghi sẵn khung bao vào `regions/seed/vietnam-admin.ts` (sinh một lần bằng script, commit kết quả).
  - Điểm đến seed: khung vuông quanh tâm (như nay). Vùng nhập từ Nominatim: `boundingbox` (như nay).

### 4.6 Gỡ bỏ

- `places/`: phần Overpass của `places.service.ts`, `places-warmer.ts`, `place-scoring.ts`, `osm-place-mapping.ts`,
  `ai-fallback.ts`, `catalog-match.ts`, `cursor.*`, phần OSM của `opening-hours.ts`; `places-v2.*` gộp vào service mới.
- `open-data/`: bỏ Overpass và Wikidata; còn Nominatim.
- Ghép `place_id` cho dòng OSM (`matchPlaceId`) bỏ.
- Env: bỏ `OVERPASS_URL`, `PLACES_WARMUP`, `PLACES_REFRESH_DAYS`; thêm `WEB_PLACES_REFRESH_DAYS`, `WEB_PLACES_WAIT_MS`.
  `TAVILY_API_KEY` và `GEMINI_API_KEY` thành bắt buộc cho tính năng địa điểm.
- Dòng `osm` đã có trong DB: giữ (được tham chiếu), không liệt kê, không gợi ý. Không viết migration xóa.

## 5. Shared types

- `PlacesPage`: `source: 'web'`, thêm `status: 'ready' | 'building'`, bỏ `nextCursor`, `attribution` (ODbL),
  `groundingSources` đổi thành `sources`.
- `PlaceListItem`: `id: string` (không còn null), `locationSource: 'google' | 'ai'` bắt buộc, `articles` bắt buộc,
  thêm `googlePlaceId?`, bỏ `compositeScore`, `wikidataId`, `sourceUrl`.
- `ItineraryItem.place`: thêm `locationSource`.

## 6. Mobile

- **Màn vùng** (`region/[id].tsx`): một danh sách duy nhất (bỏ tab "Danh mục" / "Từ bài viết"); trạng thái
  `building` hiện "Đang tổng hợp địa điểm từ bài viết… lần đầu mất 10–30 giây" và hỏi lại; `canPlan` = có ít nhất
  một mục. Bỏ dòng ghi công OSM.
- **Ghi chú vị trí gần đúng** (Q2): mục `locationSource = 'ai'` có nhãn "Vị trí gần đúng" kèm giải thích khi chạm
  ("Chưa tìm thấy trên Google Maps; vị trí do AI ước đoán từ bài viết, có thể lệch"). Hiện ở `PlaceRow`, marker bản
  đồ (kiểu khác), màn chi tiết, và mục trong lịch trình (thời gian di chuyển tới điểm này là ước tính).
- **Form tạo lịch trình** (`itinerary/new.tsx`): thêm "Tìm thêm địa điểm" (dùng lại `usePlaceSearch` +
  `PlaceSearchResults`), kết quả thêm thẳng vào bản nháp; `StayPicker` đọc danh sách `stay` mới.
- **Sửa lịch trình** (`itinerary-editor.tsx` › `AddPlace`): tab "Trong vùng" đọc danh sách mới và có ô tìm như trên.
- **Thêm từ kết quả Google** vào bản nháp hay lịch trình: gọi `POST /places/google` để có `id` (luồng lưu sẵn có),
  nhưng không bắt buộc thêm vào "Muốn đi" — thêm cờ `save: false` cho endpoint, hoặc endpoint
  `POST /places/google/resolve` chỉ trả `id`. Chốt ở plan.
- `use-region-places.ts`: bỏ tham số `api` và phân trang.

## 7. Kiểm thử

- Unit: ghép Google (ngưỡng tên, loại mâu thuẫn, Google lỗi → AI), thứ hạng, upsert trùng `place_id`.
- e2e (fake Tavily / Gemini / Google): vùng mới → `building` rồi `ready`; vùng quá hạn trả bản cũ và làm mới;
  hai request song song chỉ chạy một pipeline; lập lịch AI chỉ với danh sách web (có cả mục tọa độ AI);
  alternatives; tìm địa điểm khớp dòng web.
- Viết lại / xóa: `places-source`, `places-speed`, `places-v2.service.spec`, `places-warmer.spec`, `cursor.spec`.
- Bench thật (`pnpm bench:places`): đo tỉ lệ ghép được và thời gian lần đầu cho 5 vùng (Đà Lạt, Hội An, Sa Pa,
  Cần Giờ, một xã nhỏ). Dùng kết quả để chỉnh ngưỡng tên ở 4.2.

## 8. Tài liệu

- PRD: sửa 7.1, 7.4 (nguyên tắc 3: danh mục riêng có tên từ bài viết, tọa độ Google ≤ 30 ngày hoặc AI), 7.5, FR-1.10.
- `modules/README.md`, `CLAUDE.md` (mục "Places: two pipelines").

## 9. Rủi ro

| Rủi ro | Giảm thiểu |
| --- | --- |
| Lần đầu mở vùng chậm (10–30 s) | Trạng thái `building` + hỏi lại; kết quả dùng chung cho mọi người |
| Vùng ít bài viết → ít địa điểm | Agent tự tìm thêm (như v2); người dùng tìm thêm bằng Google |
| Ghép nhầm địa điểm | Ngưỡng tên + kiểm tra loại; bench để chỉnh |
| Tọa độ AI lệch | Ghi chú rõ; lần làm mới thử ghép lại |
| Chi phí Tavily / Gemini / Text Search | Theo vùng, không theo người dùng; làm mới 30 ngày |
