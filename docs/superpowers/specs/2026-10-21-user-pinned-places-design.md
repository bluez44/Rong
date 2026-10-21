# Địa điểm tự ghim và ghi chú riêng — thiết kế

> **Trạng thái (2026-10-21):** đã duyệt từng phần trong buổi brainstorm; chờ người dùng đọc lại bản viết trước khi viết plan.
>
> **Phụ thuộc:** làm sau khi branch `feat/saved-places-to-region` (điểm "Muốn đi" có tọa độ, mục "Muốn đi" ở đầu màn Vùng)
> đã vào `main`.

## Mục tiêu

Chia sẻ một bài TikTok về một quán nhỏ thường không khớp được địa điểm nào: Google Places bị cấm ở Việt Nam (403), còn
danh mục dòng `web` chỉ có tối đa 40 nơi cho mỗi vùng đã từng được mở. Người dùng hiện chỉ thấy "Chưa tìm được địa điểm
khớp".

Tính năng này cho người dùng:
1. **Tự ghim** địa điểm đó: chọn vùng, kéo bản đồ cho ghim nằm đúng chỗ, đặt tên và loại, lưu vào "Muốn đi".
2. **Ghi chú riêng** (mô tả, giờ mở cửa, giá mỗi người) cho **mọi** điểm "Muốn đi", không chỉ điểm tự ghim.
3. Ghi chú đi theo điểm vào lịch trình: lịch trình hiện ghi chú của người tạo, và giờ mở cửa trong ghi chú được dùng khi
   xếp giờ.

**Thành công nghĩa là:** một quán không có trong danh sách của app vẫn được lưu vào "Muốn đi", nằm đúng chỗ trên bản đồ,
và được xếp vào lịch trình đúng giờ mở cửa người dùng đã ghi.

## Quyết định đã chốt

| Chủ đề | Quyết định |
| --- | --- |
| Lối vào ghim | (1) Thẻ ứng viên "Chưa tìm được địa điểm khớp" ở màn chia sẻ; (2) màn Vùng, khi tìm theo tên không có kết quả. |
| Ai thấy điểm tự ghim | Riêng của người tạo. Không vào danh sách vùng, gợi ý trang chủ, khớp khi share hay điểm AI thêm. Chỉ người khác thấy khi điểm nằm trong một lịch trình họ xem được. |
| Ghi chú cho điểm nào | Mọi điểm, mỗi (người dùng, địa điểm) **một** ghi chú. Chỉ chủ ghi chú thấy, trừ khi qua lịch trình (dưới). |
| Ghi chú trong lịch trình | **Không chép.** Lịch trình đọc trực tiếp ghi chú của **người tạo lịch trình** mỗi lần mở; sửa ở "Muốn đi", chi tiết địa điểm hay trên mục lịch trình đều là sửa cùng một bản. Chỉ người tạo sửa; thành viên nhóm và link chia sẻ chỉ xem. |
| Giờ mở cửa | Dùng khi xếp giờ (AI, bộ đặt giờ, tính lại giờ, cảnh báo "đóng cửa"), ưu tiên hơn giờ của địa điểm. |
| Giá | Chỉ để xem; chưa cộng vào chi phí chuyến đi (F7 làm sau). |
| Cách lưu | Điểm tự ghim là dòng `places.source = 'user'` (lịch trình và "Muốn đi" dùng được ngay, FR-6.3 vẫn thỏa); ghi chú ở bảng `place_notes`. |
| Địa chỉ khi ghim | Nominatim reverse qua `OpenDataService`, hiện sau khi ghim đứng yên 1 giây. Không dùng Google. |

**Ngoài phạm vi:** chia sẻ điểm tự ghim cho cộng đồng hay kiểm duyệt; ảnh cho điểm tự ghim; cộng giá vào chi phí (F7);
nhấn giữ trên bản đồ để ghim; tự dời giờ các mục lịch trình đã xếp khi đổi giờ mở cửa.

## 1. Dữ liệu

Một migration `AddUserPlacesAndNotes` (hỏi người dùng trước khi chạy trên Neon dev).

### `places`: điểm tự ghim
- Thêm `created_by uuid NULL REFERENCES users(id) ON DELETE CASCADE`. Xóa tài khoản thì điểm tự ghim mất theo; lịch trình
  của người đó cũng đã bị xóa theo nên không có lịch trình nào trỏ vào điểm đã mất.
- `chk_place_location_source`: thêm `'user'`.
- `chk_place_source`: thêm nhánh `source = 'user' AND created_by IS NOT NULL AND location IS NOT NULL AND
  location_source = 'user' AND google_place_id IS NULL`. Các nhánh `web`/`google` giữ nguyên và yêu cầu `created_by IS NULL`.
- Chỉ mục `idx_places_created_by ON places (created_by) WHERE source = 'user'` (đếm giới hạn, liệt kê của chính mình).
- Tên 1–120 ký tự (đã bỏ khoảng trắng đầu/cuối), loại là một `PlaceCategory`. `address` lấy từ reverse geocode lần ghim
  cuối (có thể null).

### `place_notes`: ghi chú riêng

| Cột | Kiểu | Ràng buộc |
| --- | --- | --- |
| `user_id` | uuid | FK `users`, `ON DELETE CASCADE` |
| `place_id` | uuid | FK `places`, `ON DELETE CASCADE` |
| `note` | text | ≤ 1 000 ký tự |
| `opening_hours` | text | ≤ 200 ký tự; phải đọc được bằng `parseOpeningHours` |
| `price_min`, `price_max` | int | ≥ 0, ≤ 100 000 000; cả hai có thì `price_max ≥ price_min` |
| `updated_at` | timestamptz | `now()` |

- Khóa chính `(user_id, place_id)`.
- Một dòng mà mọi trường đều null thì bị xóa thay vì giữ.
- Ghi chú độc lập với `saved_places`: bỏ lưu rồi lưu lại vẫn còn ghi chú; người tạo lịch trình ghi chú được cho điểm có
  trong lịch trình mà họ chưa lưu.

### Kiểu dùng chung (`packages/shared-types`)
- `LocationSource` thêm `'user'`.
- `PlaceNotes = { note: string | null; openingHours: string | null; priceMin: number | null; priceMax: number | null }`.
- `SavedPlace.notes: PlaceNotes | null`; `PlaceDetail.notes: PlaceNotes | null` (của người xem);
  `PlaceDetail.createdByMe: boolean`.
- `ItineraryPlaceSnapshot.notes?: PlaceNotes | null` — server điền khi trả lịch trình, **không** lưu vào JSONB.
- `ShareImportCandidate.regionHint: { id: string; name: string } | null`.

## 2. API

Tất cả cần JWT. Lỗi theo dạng `{ code, message }` như mọi nơi.

| Route | Việc |
| --- | --- |
| `POST /places/user` | Tạo điểm tự ghim và lưu vào "Muốn đi" (một transaction). |
| `PATCH /places/user/:id` | Người tạo sửa tên, loại, vị trí (vị trí mới phải trong vùng đã lưu). Người khác: 404. |
| `PATCH /places/:id/notes` | Ghi chú của **chính tôi** cho một điểm bất kỳ (kể cả `web`, `google`). Trường gửi `null` thì xóa; trường không gửi thì giữ. |
| `GET /places/reverse-geocode?lat&lng` | Một dòng địa chỉ tiếng Việt, hoặc `null`. |
| `GET /saved-places` | Mỗi mục có thêm `notes`. |
| `GET /places/:id` | Điểm `user` đọc được bởi người đã đăng nhập có id; kèm `notes` của người xem và `createdByMe`. |
| `GET /share-imports/:id` | Mỗi ứng viên có thêm `regionHint`. |

### `POST /places/user`
Nhận `{ name, category, lat, lng, regionId, address?, notes?, shareImportId? }`:
- `regionId` phải là vùng có khung bao. Điểm phải nằm trong khung bao nới ~2 km (cùng mức với tọa độ AI,
  `AI_LOCATION_PADDING_DEG`) → không thì 400 `PIN_OUTSIDE_REGION`.
- Giới hạn 30 điểm tự ghim mỗi người trong 24 giờ, 500 điểm mỗi người → 429 `PIN_LIMIT`.
- `shareImportId` phải là lượt chia sẻ của chính người gọi → dòng `saved_places` có `source = 'share'` và
  `share_import_id` (tính vào số đã lưu của lượt chia sẻ, hiện nguồn bài gốc ở "Muốn đi"). Không có thì `source = 'manual'`.
- `notes` có thì ghi luôn vào `place_notes`.
- Trả `{ placeId }`.

### `GET /places/reverse-geocode`
- `OpenDataService.reverse(lat, lng)` gọi Nominatim `/reverse?format=jsonv2&accept-language=vi&zoom=18`, đi qua cùng bộ
  giãn cách theo host (1,1 giây) và User-Agent của `searchPlaces`.
- Ghép một dòng từ `address` (số nhà, đường, phường/xã, quận/huyện, tỉnh/thành), bỏ phần trùng và "Việt Nam".
- Cache trong bộ nhớ theo tọa độ làm tròn 4 chữ số (~10 m), 24 giờ.
- Giới hạn 60 lần mỗi người mỗi giờ; quá giới hạn, Nominatim lỗi hay hết giờ (3 giây) đều trả `{ address: null }` (200), để
  app chỉ hiện tọa độ chứ không báo lỗi.

### Cách ly điểm `user`
Mọi nơi liệt kê, gợi ý hay khớp địa điểm đã chỉ đọc dòng `web` / `region_places` (`matchCatalog`, `listForRegion`,
`PlaceSearchService`, gợi ý trang chủ, điểm AI thêm khi xếp lịch). Không đổi gì ở đó; e2e khẳng định điểm `user` không lọt
vào các luồng này.

## 3. Mobile

### Màn `place/pin` (mới)
Params: `regionId?`, `regionName?`, `name?`, `category?`, `shareImportId?`, `candidateKey?`, `hintRegionId?`,
`hintRegionName?`, `editPlaceId?`. Không dùng `<Screen>` (bản đồ tràn mép): tự chừa vùng an toàn, ô nhập bọc
`<KeyboardAvoider>` (theo `apps/mobile/CLAUDE.md`).

1. **Chọn vùng** — bỏ qua khi đã có `regionId` hoặc `editPlaceId`.
   - Ô tìm vùng dùng `useRegionSearch` (tỉnh, điểm đến, xã/phường). Có `hintRegion` thì hiện sẵn ở đầu: "Gợi ý từ bài:
     <tên>".
2. **Ghim.**
   - Bản đồ toàn màn hình mở theo khung bao vùng (sửa thì theo vị trí cũ). Ghim cố định giữa màn hình (đầu nhọn đúng tâm);
     người dùng kéo bản đồ. Nút "Vị trí của tôi" (quyền vị trí khi đang dùng app, đã có).
   - **Thẻ địa chỉ ở đáy màn hình:** đang kéo thì "Đang di chuyển…"; ghim đứng yên **1 giây** (tính từ
     `onRegionChangeComplete`, kéo tiếp thì đếm lại) thì gọi `reverse-geocode` và hiện địa chỉ, kèm tọa độ chữ nhỏ.
     Không có địa chỉ thì chỉ tọa độ. Phản hồi của lần cũ về muộn thì bỏ.
   - Tâm bản đồ ngoài khung bao (nới 2 km): thẻ báo "Ngoài <tên vùng>", nút "Ghim ở đây" tắt.
   - Nút "Ghim ở đây" nằm trong thẻ.
3. **Thông tin** — form `PlaceNotesForm`, dùng chung với việc sửa ghi chú.
   - Tên (điền sẵn), loại (chip, chọn sẵn loại AI đoán) — chỉ ở màn ghim.
   - Mô tả / ghi chú (nhiều dòng).
   - Giờ mở cửa: mặc định "Không rõ". Bật lên: giờ mở, giờ đóng (đóng sớm hơn mở = qua đêm), các ngày mở trong tuần (mặc
     định cả tuần). Sinh chuỗi `opening_hours` (`Mo-Su 07:00-22:00`, `Mo,We-Fr 08:00-17:00`…). Ghi chú cũ có chuỗi mà form
     không biểu diễn được thì hiện chuỗi đó, chỉ cho "Xóa giờ" hoặc nhập lại.
   - Giá mỗi người: từ–đến (VND, bàn phím số, hiện dạng "50.000 đ"). Chip nhanh "Miễn phí", "< 50k", "50–150k",
     "150–300k", "> 300k" điền sẵn hai ô.
   - "Lưu vào Muốn đi" (sửa thì "Lưu").
   - Xong: từ màn chia sẻ thì quay về đó; từ màn Vùng thì quay về màn Vùng (điểm mới hiện trong mục "Muốn đi" và có marker).

### Lối vào
- **Màn chia sẻ** (`share-import/[id].tsx`): thẻ ứng viên `confidence = 'none'` có thêm nút "Ghim vị trí" cạnh "Tự tìm".
  Ghim xong, thẻ hiện "Đã ghim ✓" (theo `candidateKey`, giữ trong phiên màn hình) và không được chọn lại.
- **Màn Vùng**: kết quả tìm theo tên rỗng (cả danh mục lẫn Google) thì có nút "Thêm địa điểm của riêng bạn" → `place/pin`
  với vùng hiện tại và chữ đang gõ.

### Chi tiết địa điểm
- Điểm đã lưu, hoặc đang có ghi chú: thẻ **"Ghi chú của bạn"** (mô tả, giờ, giá) với nút "Sửa"; không có thì "Thêm ghi chú".
  Mở `PlaceNotesForm` trong bottom sheet. Lưu gọi `PATCH /places/:id/notes`.
- Nếu điểm nằm trong lịch trình nào của người dùng và giờ mở cửa vừa đổi: nhắc "Giờ mới áp dụng cho lịch trình khi bạn
  chỉnh lịch lần tới".
- Điểm tự ghim: nhãn "Vị trí bạn ghim" thay cho "Vị trí gần đúng"; người tạo có "Sửa tên, loại, vị trí" → `place/pin` ở
  chế độ sửa (bắt đầu từ bước 2).
- Mở từ một lịch trình của người khác: hiện ghi chú của người tạo lịch trình, chỉ đọc (truyền qua params từ mục lịch trình).

### "Muốn đi" và bản đồ
- Dòng trong "Muốn đi" có ghi chú thì thêm một dòng tóm tắt, ví dụ "07:00–22:00 · 50–150k".
- Marker điểm tự ghim vẽ như marker thường (icon theo loại), không viền nét đứt.

## 4. Lịch trình

- **Đọc ghi chú khi trả lịch trình.** `GET /itineraries/:id`, danh sách lịch trình nhóm và trang công khai
  `public/itineraries/:token` điền `item.place.notes` từ `place_notes` của **người tạo lịch trình** (một truy vấn cho cả
  lịch trình). Không lưu vào JSONB.
- **Giờ mở cửa khi xếp.** Thứ tự ưu tiên giờ của một điểm: `place_notes.opening_hours` của người tạo → `opening_hours` của
  địa điểm → giờ điển hình theo loại (`planning/rules.ts`). Áp dụng cho:
  - `itinerary-planner.ts` khi nạp ứng viên (`loadPlaces`) → gợi ý giờ gửi Gemini (`ai-planner.ts`) và bộ đặt giờ
    (`scheduler.ts`);
  - `retime.ts` khi sửa (`PUT /itineraries/:id`), gồm cảnh báo "đóng cửa".
- **Đổi giờ không tự dời lịch.** Cảnh báo được tính lại ở lần sửa lịch trình tiếp theo, như mọi cảnh báo hiện nay.
- **Sửa ghi chú từ lịch trình.** Mục lịch trình (chế độ xem và chế độ sửa) có "Sửa ghi chú" khi người xem là người tạo;
  gọi cùng `PATCH /places/:id/notes`, rồi tải lại lịch trình.
- **Hiển thị.** App (`itinerary-view`) và web (`/t/:token`): dòng ghi chú ngắn dưới tên điểm; phần mở rộng của mục có
  "Giờ mở cửa (ghi chú)" và giá.

## 5. Lỗi và biên

| Tình huống | Xử lý |
| --- | --- |
| Ghim ngoài vùng | App khóa nút; server 400 `PIN_OUTSIDE_REGION`. |
| Quá giới hạn ghim | 429 `PIN_LIMIT`, app báo bằng Notice. |
| Reverse geocode lỗi / quá giới hạn | `{ address: null }`, app chỉ hiện tọa độ; vẫn ghim được. |
| `opening_hours` không đọc được | 400 `INVALID_OPENING_HOURS` (form chỉ sinh chuỗi hợp lệ). |
| `price_max < price_min` | 400 `INVALID_PRICE`. |
| Sửa điểm tự ghim của người khác | 404 (không lộ là có). |
| `shareImportId` của người khác | 404 `SHARE_IMPORT_NOT_FOUND`. |
| Người tạo lịch trình xóa ghi chú | Lịch trình không còn ghi chú; giờ quay về giờ của địa điểm ở lần sửa tới. |

## 6. Kiểm thử

- **Unit (backend):** ưu tiên giờ ghi chú trong `retime` và bộ đặt giờ; ghép dòng địa chỉ từ kết quả Nominatim; kiểm tra
  nằm trong khung bao nới 2 km.
- **e2e:**
  - `POST /places/user`: đúng vùng → có trong "Muốn đi" (`source` đúng, tính vào lượt chia sẻ khi có `shareImportId`);
    ngoài vùng 400; quá giới hạn 429; `PATCH` của người khác 404.
  - Cách ly: điểm `user` không có trong `GET /regions/:id/places`, tìm theo tên trong vùng, khớp khi share, gợi ý trang chủ.
  - `place_notes`: sửa từng trường, `null` xóa, dòng rỗng bị xóa; `GET /saved-places` và `GET /places/:id` có ghi chú của
    người xem.
  - Lịch trình: thành viên nhóm và link công khai thấy ghi chú của người tạo; người tạo sửa ghi chú → lần đọc sau thấy
    ngay; giờ trong ghi chú làm `PUT` sinh cảnh báo "đóng cửa".
  - Reverse geocode: trả địa chỉ (Nominatim giả), lỗi → `null`, quá giới hạn → `null`.
- **Jest (mobile):** `PlaceNotesForm` (sinh chuỗi giờ, qua đêm, chip giá, chuỗi lạ); thẻ địa chỉ chỉ gọi reverse sau 1 giây
  đứng yên và bỏ phản hồi cũ; nút "Ghim vị trí" chỉ ở thẻ `none`; "Đã ghim ✓".

## 7. Tài liệu cần cập nhật

`CLAUDE.md` (places: dòng `user`; bảng gateway: Nominatim reverse), `apps/backend/src/modules/README.md` (`places.source`,
`place_notes`, các route mới), `apps/web` nếu trang công khai đổi.
