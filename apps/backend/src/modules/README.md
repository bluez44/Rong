# Backend modules

Mỗi thư mục tương ứng một nhóm tính năng trong [PRD](../../../../docs/PRD-Rong.md).

| Thư mục | PRD | Trách nhiệm |
| --- | --- | --- |
| `auth/` | F11 | Đăng ký / đăng nhập email + mật khẩu, xác minh email, JWT guard toàn cục (`@Public()` để mở route). Sẵn chỗ cho Google / Apple qua `auth_identities` |
| `users/` | F11 | Hồ sơ, hạn mức lượt AI hằng tháng (FR-6.5), xóa tài khoản |
| `regions/` | F1 | Tìm vùng (tỉnh cũ/mới, điểm đến, xã/phường), bí danh, khung bao (bbox) lấy từ OSM, seed sáp nhập 1/7/2025 |
| `places/` | F2, F5 | Danh mục địa điểm riêng từ OSM + Wikidata, lọc theo khung bao của vùng, điểm tổng hợp, phân trang con trỏ |
| `open-data/` | 7.1 | **Cổng duy nhất** gọi OSM Nominatim, Overpass, Wikidata (giãn cách request, User-Agent) |
| `ranking/` | F3 | Điểm tổng hợp 0–100, nhãn "Đang hot" |
| `google/` | 7.4 | **Cổng duy nhất** gọi Google Places + Routes |
| `share-import/` | F4 | Nhận link mạng xã hội, trích xuất và khớp địa điểm |
| `itineraries/` | F6, F7, F8, F9 | Tạo lịch trình (AI hoặc tự sắp xếp), lưu và xem lại. Chi phí (F7), chỉnh sửa (F8) để sau |
| `groups/` | F10 | Nhóm, link mời, phân quyền, nhật ký hoạt động |
| `realtime/` | FR-10.5 | WebSocket gateway + Redis adapter |
| `mail/` | — | Gửi email qua SMTP (chưa cấu hình thì ghi ra log) |
| `health/` | — | Kiểm tra sức khỏe service và kết nối PostGIS |

## Vì sao `google/` đứng riêng

Mục 7.4 của PRD ràng buộc rất chặt cách sản phẩm được phép dùng dữ liệu Google:
chỉ lưu `place_id` (vô thời hạn) và tọa độ (cache tối đa 30 ngày), mọi thứ khác
phải gọi theo thời gian thực; điểm tổng hợp và mọi cách sắp xếp không được đụng
tới dữ liệu Google; dữ liệu Google chỉ được đưa vào AI cho đúng một mục đích là
sắp xếp lịch trình.

Nếu lời gọi Google nằm rải rác khắp codebase thì sáu tháng nữa sẽ không ai chứng
minh được là mình còn tuân thủ. Gom hết vào một module biến ràng buộc pháp lý
thành thứ review được trong code và test được tự động.

**Quy tắc:** không module nào ngoài `google/` được phép import SDK hay gọi
endpoint của Google. Các module khác đi qua service mà `google/` cung cấp.

## Tìm điểm đến không dùng AI (S2)

```
GET /api/regions/search?q=da lat            gợi ý khi gõ — chỉ đọc database
GET /api/regions/search?q=tam dao&online=1  khi bấm tìm — thiếu thì hỏi Nominatim rồi lưu lại
GET /api/regions/:id/places?categories=food,cafe&cursor=…   địa điểm trong khung bao (kèm giờ mở cửa hôm nay)
GET /api/places/:id                         chi tiết (F5) + nội dung Google Maps theo thời gian thực
```

- **Tỉnh cũ/mới** được seed từ Nghị quyết 202/2025/QH15 (`regions/seed/vietnam-admin.ts`).
- **Khu vực của một vùng là một khung bao (bbox)**, không phải polygon
  (`regions/region-area.service.ts`), tính lần đầu khi lấy địa điểm của vùng:
  - tỉnh cũ, thành phố cấp huyện đã bị bỏ (Đà Lạt, Vũng Tàu…): khung bao của relation
    OSM *tại ngày 30/6/2025* (Overpass `[date:…]`, `out tags bb`);
  - tỉnh mới sau sáp nhập: khung bao trọn các tỉnh cũ;
  - vùng nhập từ Nominatim: `boundingbox` Nominatim trả về, lưu ngay lúc nhập;
  - chỉ có một điểm: khung vuông quanh điểm theo bán kính (phương án dự phòng).
  Khung bao lấn sang vùng lân cận một chút ở rìa — chấp nhận được cho danh sách gợi ý.
- **Địa điểm** lấy từ Overpass theo khung bao của vùng, phân loại bằng tag OSM
  (`places/osm-place-mapping.ts`), chấm điểm tất định (`places/place-scoring.ts`), lưu
  lại và làm mới sau `PLACES_REFRESH_DAYS` ngày. Địa điểm thuộc vùng nào tính bằng
  khung bao lúc truy vấn, nên dùng chung cho vùng cũ và mới.
- Nominatim công cộng **cấm dùng cho autocomplete** và giới hạn 1 request/giây, vì vậy
  `online` chỉ bật khi người dùng bấm tìm. Production nên tự host hoặc dùng nhà cung cấp
  trả phí (đổi `NOMINATIM_URL`, `OVERPASS_URL`).
- Luôn hiển thị dòng `attribution` trả về (ODbL bắt buộc ghi công OpenStreetMap).

## Chi tiết địa điểm và Google (F5)

- Danh sách chỉ dùng dữ liệu riêng. Giờ mở cửa trong danh sách tính từ tag
  `opening_hours` của OSM theo giờ Việt Nam (`places/opening-hours.ts`).
- Rating, đánh giá, giờ mở cửa và ảnh của Google **chỉ** có ở `GET /places/:id`,
  gọi Places API (New) mỗi lần mở, không lưu, không cache (PRD 7.4, FR-2.9).
- `place_id` được ghép một lần bằng Text Search dạng IDs Only (miễn phí) trong khung
  ~250 m quanh tọa độ OSM, rồi lưu lại — trường Google duy nhất được lưu. Không ghép
  được thì 30 ngày sau mới thử lại.
- Client phải hiển thị "Google Maps", tách phần Google khỏi dữ liệu của app, và ghi
  tên tác giả ảnh/đánh giá kèm link (`author.uri`, `googleMapsUri`).

## Dự phòng khi nguồn dữ liệu mở lỗi

`GET /regions/:id/places` khi OSM (Overpass/Nominatim) không dùng được:

1. Đã có địa điểm lưu cho khu vực đó → trả dữ liệu lưu (`source: "catalog"`), bỏ qua lần làm mới.
2. Chưa có gì → hỏi Gemini có công cụ Google Maps (`LangchainService.findPlaces`) và trả
   `source: "ai_google_maps"`: một trang, `id: null` (không có màn hình chi tiết), không
   lưu vào danh mục, kèm `groundingSources`. Client phải hiển thị "Google Maps" và các nguồn.
3. Gemini cũng lỗi → 503 `PLACES_UNAVAILABLE`.

Lưu ý: bước 2 lệch với PRD 7.4 nguyên tắc 5 (dữ liệu Google chỉ đưa vào AI để sắp xếp
lịch trình) — là quyết định có chủ ý, chỉ dùng khi dữ liệu mở không có.

## Lịch trình (F6)

```
POST   /api/itineraries          tạo (planningMode "ai" | "manual")
GET    /api/itineraries          danh sách của tôi
GET    /api/itineraries/:id
DELETE /api/itineraries/:id
```

Quy trình AI (`itineraries/`):

1. **Ứng viên** — điểm người dùng chọn (bắt buộc) + điểm bổ sung từ danh mục của vùng
   nếu bật `allowAiSuggestions` (`planning/clustering.ts#pickExtras`: hợp đối tượng, sở
   thích, ≤ 90 phút từ nơi ở, không để một danh mục áp đảo).
2. **Gom cụm theo ngày** — k-means theo tọa độ, theo sức chứa mỗi ngày (đối tượng × nhịp độ).
3. **Gemini + Google Maps** sắp thứ tự, thời lượng, lý do, tra giờ mở cửa còn thiếu
   (`ai-planner.ts`). Chỉ được dùng id được gửi; kết quả được kiểm tra lại toàn bộ. Gemini
   lỗi → xếp bằng thuật toán (`planner: "heuristic"`).
4. **Xếp giờ bằng code** (`planning/scheduler.ts`) — thời gian di chuyển ước tính
   (`planning/travel.ts`, chưa dùng Google Routes), giờ mở cửa (OSM → AI → giờ thông
   thường theo danh mục), bữa ăn theo khung giờ từ quán "Ăn uống" gần lộ trình, nghỉ trưa
   theo đối tượng. Không vừa → "Chưa xếp được" kèm lý do.

Quy tắc theo đối tượng, khung bữa ăn, thời lượng mặc định, giờ thông thường: `planning/rules.ts`.
