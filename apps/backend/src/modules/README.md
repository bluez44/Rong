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
- Chỉ vùng **chưa từng tải** mới bắt request chờ Overpass; vùng đã quá hạn thì trả dữ
  liệu đã lưu và làm mới ở nền. Bật `PLACES_WARMUP=true` thì `places/places-warmer.ts`
  dựng sẵn danh mục cho các điểm đến và tỉnh đã seed (30 giây sau khi khởi động, rồi
  mỗi 6 giờ), đúng tinh thần FR-1.10 "danh mục tổng hợp sẵn".
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

## Chia sẻ vào app (F4)

`share-import/` nhận link (hoặc đoạn văn bản chia sẻ) từ TikTok, YouTube, Facebook, Instagram hay bài báo,
nhận diện địa điểm trong đó và cho người dùng chọn lưu vào "Muốn đi".

```
POST /api/share-imports            tạo job, trả 202 { id }; nhận diện chạy nền
GET  /api/share-imports            lượt gần đây (20 lượt / 7 ngày)
GET  /api/share-imports/:id        trạng thái + ứng viên (client hỏi lại tới khi done | failed)
POST /api/share-imports/:id/save   lưu các lựa chọn vào saved_places
```

Luồng của một job (`share-imports.service.ts`):

1. **Nhận vào** — `share-url.ts` rút URL từ văn bản, chỉ http/https, `url` ≤ 2 048 ký tự, `shared_text` cắt ở
   5 000 ký tự. Hạn mức `SHARE_IMPORT_DAILY_LIMIT` (mặc định 30 lượt / người / 24 giờ).
2. **Metadata** — `LinkMetadataService` lấy oEmbed / Open Graph của link (tiêu đề, tác giả, ảnh đại diện).
   Chỉ lưu metadata công khai để ghi nguồn, không sao chép nội dung (FR-4.5).
3. **Trích xuất** — một lần gọi Gemini có cấu trúc (`place-extraction.ts`), tối đa 15 địa điểm mỗi lượt.
4. **Khớp** — `place-resolver.ts` khớp từng ứng viên với danh mục OSM theo độ giống tên (trong vùng gợi ý,
   hoặc toàn quốc với ngưỡng cao hơn), không khớp thì hỏi Google qua `GooglePlacesService`, tối đa 3 lựa chọn
   Google mỗi ứng viên.
5. **Kết thúc** — `done`, hoặc `failed` với `error_code`: `METADATA_UNAVAILABLE`, `AI_UNAVAILABLE`, `TIMEOUT`
   (job quá 30 giây), `INTERRUPTED`.

`share_imports` (migration `1759100000000-AddShareImports`): `id`, `user_id`, `url`, `shared_text`, `status`
(`pending | done | failed`), `platform`, `metadata` (jsonb), `candidates` (jsonb), `error_code`, `created_at`,
`finished_at`. `saved_places` thêm `source` (`manual | share`) và `share_import_id`.

Độ bền của job:
- Tắt server: `onModuleDestroy` đánh các job đang chạy là `failed` / `INTERRUPTED`.
- Tiến trình chết đột ngột: một vòng quét mỗi 60 giây đánh `INTERRUPTED` cho job `pending` quá 2 phút.
- `candidates` có tọa độ Google quá 30 ngày bị xóa: vòng quét chạy 60 giây sau khi khởi động rồi mỗi 6 giờ
  (deploy thường xuyên thì chu kỳ 6 giờ có thể không bao giờ tới).

### Cổng `LinkMetadataService`

Cổng duy nhất tải link do người dùng đưa vào, nên là bề mặt SSRF; các giới hạn:
- Chỉ http/https, cổng 80/443 (hoặc mặc định); chặn IP không công khai ở **mọi** redirect; tối đa 5 redirect,
  timeout 5 giây, đọc tối đa 1 MB.
- Kết nối được ghim vào IP công khai đã kiểm tra bằng `undici` `Agent` (`lookup` ghim), nên không bị DNS
  rebinding giữa lúc kiểm tra và lúc kết nối.
- `META_OEMBED_TOKEN` (tùy chọn) bật oEmbed của Facebook / Instagram.

## `places.source` và dòng Google

Từ F4, `places` có hai loại dòng, phân biệt bằng cột `source`:

- `osm` — danh mục như trước; chỉ loại này được liệt kê, xếp hạng, gợi ý hay chấm điểm. **Mọi truy vấn danh
  mục để liệt kê / xếp hạng / gợi ý phải có `p.source = 'osm'`.**
- `google` — chỉ tạo khi người dùng chọn một địa điểm Google từ kết quả chia sẻ. Lưu `google_place_id` (vô
  thời hạn), tên và loại lấy từ nội dung người dùng chia sẻ, và tọa độ Google có hạn `location_expires_at`.
  Không bao giờ được xếp hạng (PRD 7.4).

Tọa độ Google hết hạn đúng 30 ngày sau `created_at` của job (không phải lúc lưu), và dữ liệu cũ không bao giờ
kéo dài hạn đó. Hai thành phần giữ quy tắc này:

- `places/google-location-janitor.ts` — `GoogleLocationJanitor` đặt `location` và `location_expires_at` về
  NULL cho dòng Google quá hạn, 60 giây sau khi khởi động rồi mỗi 6 giờ (chạy cả khi tắt `PLACES_WARMUP`).
- `places/place-location.service.ts` — `PlaceLocationService.ensure(ids)` lấy lại tọa độ qua Google cho dòng
  đã hết hạn trước khi lập lịch trình hay mở chi tiết; trả các id vẫn không lấy được.

Khi `ensure` không lấy lại được tọa độ, `PUT /itineraries/:id` (cũng như
`GET /places/:id`) trả 503 `PLACE_LOCATION_UNAVAILABLE`.

Lịch trình (`itineraries.days` JSONB) không lưu tọa độ Google: ảnh chụp địa điểm nguồn Google ghi
`coordinates: null` (`itineraries/planning/snapshot.ts`), và mọi đường đọc (GET/POST/PUT lịch trình, trang xem
công khai) điền tọa độ hiện tại từ `places.location` qua `itineraries/google-coordinates.ts` — null khi đã hết hạn.

Dòng Google dùng chung theo `google_place_id`, nên `places.name` là tên của người chia sẻ đầu tiên. Mỗi lượt lưu
từ chia sẻ ghi tên theo nội dung của chính người đó vào `saved_places.display_name`; "Muốn đi" trả
`COALESCE(display_name, places.name)`. `GET /places/:id` của dòng Google hiện tên Google trực tiếp (không lưu)
khi có nội dung Google.

## Khác với PRD (F4)

Xem spec `docs/superpowers/specs/2026-10-12-share-to-app-design.md` §1.2. Tóm tắt:
- Dòng `places` nguồn Google được lưu (kèm tọa độ 30 ngày) để lịch trình tham chiếu được, trong khi PRD
  7.4 chỉ cho cache tọa độ; ràng buộc 30 ngày và không-xếp-hạng được giữ nguyên bằng janitor và `ensure`.
- Update lịch trình không lấy được tọa độ cho địa điểm Google thì trả 503 `PLACE_LOCATION_UNAVAILABLE`
  thay vì lưu một lịch trình thiếu vị trí.
- Bộ link kiểm thử nhận diện (`test/fixtures/share-links.json`, chạy bằng `pnpm bench:share`, tốn tiền) mới có
  2 link mẫu công khai về Đà Lạt; bộ đủ 200 link của PRD (mục tiêu ≥ 70% nhận diện đúng) được bổ sung dần.
