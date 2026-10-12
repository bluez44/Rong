# Tìm địa điểm theo tên trong một vùng

| | |
| --- | --- |
| Ngày | 12/10/2026 |
| Trạng thái | Đã duyệt thiết kế, chờ duyệt spec |
| Phạm vi | `apps/backend`, `apps/mobile`, `packages/shared-types` |
| PRD liên quan | F2 (danh sách địa điểm), F5 (chi tiết), F9 ("Muốn đi"), mục 7.4 |

## 1. Bối cảnh

Người dùng biết tên một quán hay một điểm tham quan nhưng không có cách tìm nó:
app chỉ cho xem danh sách địa điểm của vùng (OSM v1, web v2), và địa điểm ngoài
danh mục chỉ vào được dữ liệu qua share-to-app (F4). Lịch trình chỉ nhận địa
điểm có trong DB (FR-6.3).

Thiết kế này thêm ô tìm địa điểm trong màn vùng: tìm trong danh mục khi đang
gõ, tìm thêm trên Google Maps khi bấm tìm, xem trước kết quả Google, và lưu vào
"Muốn đi" bằng dòng `places` nguồn Google mà share-to-app đã dựng.

### 1.1 Ngoài phạm vi

| Hạng mục | Ghi chú |
| --- | --- |
| Tìm địa điểm toàn quốc ở màn tìm kiếm chung | Làm sau trên cùng endpoint |
| Thêm thẳng từ trang xem trước vào lịch trình | Lưu "Muốn đi" trước, rồi thêm như mọi địa điểm |
| Vùng gợi ý cho ứng viên `none` của share-to-app | "Tự tìm" của ứng viên `none` giữ hành vi cũ |
| Giới hạn tìm online dùng chung nhiều instance | Hiện triển khai một instance |
| Ghi log lượt tìm địa điểm không ra | Có thể thêm như `region_search_misses` |

## 2. Các quyết định thiết kế

### 2.1 Tìm trong phạm vi một vùng

Ô tìm nằm trong màn `region/[id]` và mọi truy vấn giới hạn trong khung bao của
vùng: tên quán trùng nhau giữa các tỉnh không lẫn vào nhau, Google Text Search
được giới hạn khu vực nên ít lượt gọi hơn, và "Muốn đi" có sẵn vùng.

### 2.2 Danh mục khi gõ, Google khi bấm tìm

Tìm danh mục không tốn tiền nên chạy theo từng lần gõ (debounce). Google Text
Search tính phí theo lượt nên chỉ chạy khi người dùng bấm nút hoặc phím Tìm, và
bị giới hạn 60 lượt mỗi người mỗi 24 giờ.

### 2.3 Tên do người dùng xác nhận

Tên Google là nội dung Google, không được lưu (PRD 7.4). Kết quả tìm và trang
xem trước hiện tên/địa chỉ Google lấy trực tiếp; khi lưu, người dùng xác nhận
một tên (điền sẵn từ khóa họ đã gõ, sửa được) và chỉ tên đó được lưu — vào
`places.name` khi tạo dòng mới, và `saved_places.display_name` của chính họ.
Trang chi tiết vẫn hiện tên Google trực tiếp như hiện nay.

### 2.4 Xem trước trước khi lưu

Chạm vào kết quả Google mở trang xem trước lấy trực tiếp theo `googlePlaceId`
(ảnh, rating, giờ mở cửa, đánh giá). Dòng `places` chỉ được tạo khi người dùng
bấm lưu, nên xem mà không lưu không để lại dòng nào.

### 2.5 Không tìm theo tên của dòng Google

Tìm danh mục chỉ xét `source = 'osm'`. Tên của dòng `places` nguồn Google do
người dùng khác đặt (share-to-app hoặc lần lưu trước), nên không đem ra khớp.
Kết quả Google trùng `google_place_id` của một dòng đã có được trả về như địa
điểm đã có `id`.

### 2.6 Không xếp hạng trên dữ liệu Google

Kết quả danh mục và kết quả Google là hai danh sách riêng. Danh sách Google giữ
nguyên thứ tự Google trả về; không trộn, không xếp lại.

## 3. Backend

### 3.1 `GET /regions/:id/places/search`

Query: `q` (1–100 ký tự), `online` (`true`/`1`, mặc định tắt).

- **Danh mục** (luôn chạy): `places` có `source = 'osm'`, tọa độ trong khung bao
  của vùng (`RegionAreaService.ensure`), so `unaccent(lower(name))` với `q` đã
  bỏ dấu, chữ thường: khớp khi `similarity ≥ 0.3` hoặc tên chứa chuỗi `q`; sắp theo
  độ giống giảm dần rồi `composite_score`; tối đa 10.
- **Google** (chỉ khi `online` và Google bật): `GooglePlacesService.searchByName(q,
  bbox, 5)` — Text Search với `locationRestriction` là khung bao vùng,
  `fieldMask: places.id,places.displayName,places.formattedAddress`. Mỗi kết quả
  có `google_place_id` trùng một dòng `places` đã có thì chuyển sang danh sách
  `existing` (kèm `id`, tên trong DB); còn lại trả trong `google`.
- **Giới hạn**: lượt có `online` đếm theo người dùng trong cửa sổ trượt 24 giờ,
  tối đa `PLACE_SEARCH_DAILY_LIMIT` (mặc định 60, cấu hình qua env). Vượt →
  `429 PLACE_SEARCH_LIMIT`. Bộ đếm trong bộ nhớ (`PlaceSearchLimiter`).
- Google lỗi hoặc chưa cấu hình → vẫn trả danh mục, `google: null`.

Response `PlaceSearchResponse`:

```ts
{
  catalog: PlaceSearchHit[];          // { id, name, category, coordinates }
  existing: PlaceSearchHit[];         // dòng Google đã có, khớp theo place_id
  google: GooglePlaceHit[] | null;    // { googlePlaceId, name, address } — lấy trực tiếp
}
```

### 3.2 `GET /places/google/:googlePlaceId`

- `googlePlaceId` phải khớp `^[A-Za-z0-9_-]{1,300}$`, sai → `400 INVALID_GOOGLE_PLACE_ID`.
- Có dòng `places` với `google_place_id` này → `{ placeId }`.
- Chưa có → `GooglePlacePreview`, lấy trực tiếp, không lưu gì:
  `{ googlePlaceId, name, address, coordinates, suggestedCategory, google: GooglePlaceContent }`.
  Dùng `GooglePlacesService.details` (thêm `location` và `primaryType` vào field
  mask). `suggestedCategory` ánh xạ từ `primaryType` (mục 3.4).
- Google báo không còn → `404 PLACE_NOT_FOUND`; Google lỗi/chưa cấu hình →
  `503 GOOGLE_UNAVAILABLE`.

### 3.3 `POST /places/google`

Body `SaveGooglePlaceRequest`: `{ googlePlaceId, name (1–120, trim), category:
PlaceCategory, regionId }`.

1. Kiểm tra `googlePlaceId` như 3.2.
2. `GooglePlacesService.locate` lấy tọa độ; không có → `404 PLACE_NOT_FOUND`;
   Google lỗi → `503 GOOGLE_UNAVAILABLE`.
3. `GooglePlaceRowsService.upsert({ googlePlaceId, name, category, lat, lng,
   expiresAt: now + 30 ngày })` — tạo hoặc dùng lại dòng nguồn Google; không ghi
   đè tọa độ còn hạn lâu hơn; không đổi `name`/`category` của dòng đã có.
4. `SavedPlacesService.save(userId, placeId, regionId, { source: 'search',
   shareImportId: null, displayName: name })`.
5. Trả `{ placeId }`. Lưu lại cùng địa điểm là idempotent.

### 3.4 Ánh xạ loại gợi ý

`suggestedCategory` từ `primaryType` của Google, chỉ để điền sẵn; người dùng
xác nhận và chỉ giá trị enum của Rong được lưu.

| `primaryType` chứa | Loại |
| --- | --- |
| `cafe`, `coffee_shop`, `tea_house` | `cafe` |
| `restaurant`, `food`, `bakery`, `meal_takeaway`, `*_restaurant` | `food` |
| `bar`, `night_club`, `pub` | `nightlife` |
| `lodging`, `hotel`, `hostel`, `resort_hotel`, `guest_house` | `stay` |
| `amusement_park`, `zoo`, `aquarium`, `water_park`, `playground` | `kids` |
| `museum`, `place_of_worship`, `church`, `hindu_temple`, `buddhist_temple`, `historical_landmark`, `cultural_landmark` | `culture` |
| `park`, `national_park`, `natural_feature`, `beach`, `hiking_area`, `garden` | `nature` |
| còn lại / không có | `check_in` |

### 3.5 Dùng chung với share-to-app

`upsertGooglePlace` trong `share-imports.service.ts` chuyển sang
`modules/places/google-place-rows.service.ts` (`GooglePlaceRowsService.upsert`),
nhận `expiresAt` từ caller: share-to-app truyền `created_at` của job + 30 ngày
như hiện nay, tìm địa điểm truyền `now() + 30 ngày`. Hành vi share-to-app không
đổi.

### 3.6 Dữ liệu

Migration mới: `saved_places.source` cho thêm giá trị `'search'` (cập nhật CHECK
`chk_saved_place_source`). Không có bảng mới.

`SavedPlacesService.save` nhận thêm `displayName` trong origin; câu upsert giữ
`COALESCE(EXCLUDED.display_name, saved_places.display_name)` như hiện nay.

### 3.7 Cấu hình

`PLACE_SEARCH_DAILY_LIMIT` (mặc định 60) trong `configuration.ts` và `.env.example`.

## 4. Mobile

### 4.1 Ô tìm trong màn vùng

- Đầu `PlaceSheet` có ô "Tìm quán, điểm tham quan ở <vùng>".
- Có chữ: ẩn danh sách theo loại, hiện kết quả:
  - **Trong Rong**: `catalog` + `existing`, cập nhật khi gõ (debounce), chạm →
    `place/[id]` (truyền `regionId`, `regionName` như hiện nay).
  - Nút **"Tìm trên Google Maps"** (cũng chạy khi bấm phím Tìm); là nút chính khi
    không có kết quả danh mục nào.
  - **Từ Google Maps**: tên, địa chỉ, ghi nguồn "Google Maps"; chạm →
    `place/google/[googlePlaceId]` (truyền `regionId`, `regionName`, `q`).
- Danh sách cuộn lấy từ `react-native-gesture-handler`; ô nhập không bị bàn phím
  che (`apps/mobile/CLAUDE.md`).

### 4.2 Màn xem trước `place/google/[googlePlaceId]`

- API trả `{ placeId }` → `router.replace` sang `place/[id]`.
- Còn lại: tên Google, địa chỉ, ghim bản đồ nhỏ, nhãn "Chưa có trong Rong", phần
  Google dùng lại `GooglePlaceContent`.
- Nút chính **"Lưu vào Muốn đi"** mở sheet: ô **Tên** điền sẵn `q` (kèm "Tên trên
  Google: …"), chip **Loại** chọn sẵn `suggestedCategory`. Lưu → `POST
  /places/google` → tải lại "Muốn đi" → `router.replace` sang `place/[id]`.
- Lỗi: 404 → "Địa điểm này không còn trên Google Maps"; 503 → thông báo + "Thử lại".

### 4.3 "Tự tìm" trong màn share

Ứng viên có ít nhất một lựa chọn → mở `region/[id]` của lựa chọn đầu, ô tìm điền
sẵn tên ứng viên. Ứng viên `none` → giữ `/search`.

### 4.4 Shared types

`PlaceSearchHit`, `GooglePlaceHit`, `PlaceSearchResponse`, `GooglePlacePreview`,
`GooglePlacePreviewResponse = { placeId: string } | GooglePlacePreview`,
`SaveGooglePlaceRequest`; `SavedPlace.source` thêm `'search'`.

## 5. Lỗi

| Mã | HTTP | Khi |
| --- | --- | --- |
| `REGION_NOT_FOUND` | 404 | Vùng không có |
| `PLACE_SEARCH_LIMIT` | 429 | Quá giới hạn tìm online 24 giờ |
| `INVALID_GOOGLE_PLACE_ID` | 400 | Sai định dạng |
| `PLACE_NOT_FOUND` | 404 | Google không còn địa điểm |
| `GOOGLE_UNAVAILABLE` | 503 | Xem trước / lưu khi Google lỗi hoặc chưa cấu hình |
| `SAVED_LIMIT`, `UNKNOWN_REGION` | 400 | Như `saved-places` |

## 6. Kiểm thử

**Unit**: ánh xạ `primaryType` → loại; `PlaceSearchLimiter` (cửa sổ trượt, từng
người); kiểm tra định dạng `googlePlaceId`; `GooglePlacesService.searchByName`
(field mask, `locationRestriction`) và các trường thêm vào `details`.

**e2e** (`test/place-search.e2e-spec.ts`, `GooglePlacesService` giả):
- Danh mục: tìm không dấu ra địa điểm OSM trong vùng; không trả dòng Google;
  không trả địa điểm ngoài khung bao.
- Online: kết quả trùng dòng đã có nằm ở `existing` với `id`; thứ tự `google`
  giữ nguyên thứ tự Google; Google lỗi → `google: null`, vẫn có `catalog`.
- Tìm và xem trước không ghi dòng `places` nào (đếm trước/sau).
- Xem trước khi dòng đã có → `{ placeId }`.
- Lưu: tạo đúng một dòng; tên lưu là tên gửi lên, không phải tên Google; lưu lại
  idempotent; `saved_places.source = 'search'`, `display_name` đúng.
- 429 khi quá giới hạn; 400 khi sai định dạng.
- Các e2e share-to-app có sẵn vẫn qua sau khi tách `GooglePlaceRowsService`.

**Mobile**: typecheck, lint; thử tay: tìm danh mục, tìm Google, xem trước, lưu,
mở chi tiết, "Tự tìm" từ màn share.
