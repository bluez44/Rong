# Backend modules

Mỗi thư mục tương ứng một nhóm tính năng trong [PRD](../../../../docs/PRD-Rong.md).

| Thư mục | PRD | Trách nhiệm |
| --- | --- | --- |
| `auth/` | F11 | Đăng ký / đăng nhập email + mật khẩu, xác minh email, đăng nhập Google / Zalo (`auth/external/`), JWT guard toàn cục (`@Public()` để mở route) |
| `users/` | F11 | Hồ sơ, hạn mức lượt AI hằng tháng (FR-6.5), xóa tài khoản |
| `regions/` | F1 | Tìm vùng (tỉnh cũ/mới, điểm đến, xã/phường), bí danh, khung bao (bbox) seed sẵn, seed sáp nhập 1/7/2025 |
| `places/` | F2, F5 | Danh sách địa điểm từ bài viết (Tavily + Gemini), ghép Google Places, lưu `places.source = 'web'`; chi tiết; tìm theo tên (xem "Danh sách địa điểm của vùng", "Tìm địa điểm theo tên") |
| `open-data/` | 7.1 | **Cổng duy nhất** gọi Nominatim (giãn cách request, User-Agent) |
| `ranking/` | F3 | Điểm tổng hợp 0–100, nhãn "Đang hot" |
| `google/` | 7.4 | **Cổng duy nhất** gọi Google Places (Routes để sau) |
| `share-import/` | F4 | Nhận link mạng xã hội, trích xuất và khớp địa điểm |
| `itineraries/` | F6, F7, F8, F9 | Tạo lịch trình (AI hoặc tự sắp xếp), lưu và xem lại. Chi phí (F7), chỉnh sửa (F8) để sau |
| `groups/` | F10 | Nhóm, link mời, phân quyền, nhật ký hoạt động; trang mời `/invite/:token` và `/.well-known/assetlinks.json` (xem "Link mời mở từ Zalo/Messenger") |
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

## Đăng nhập Google / Zalo (F11)

```
POST /api/auth/google { idToken }       đăng nhập/đăng ký bằng Google (ID token, aud ∈ GOOGLE_OAUTH_CLIENT_IDS)
POST /api/auth/zalo   { accessToken }   đăng nhập/đăng ký bằng Zalo (Graph API + appsecret_proof)
```

Spec: `docs/superpowers/specs/2026-10-21-google-zalo-login-design.md`.

- `auth/external/GoogleIdTokenVerifier` kiểm chữ ký ID token bằng `jose` với khóa công khai
  `googleapis.com/oauth2/v3/certs`. **Ngoại lệ có chủ ý với quy tắc của `google/`:** đây là Google
  Identity (đăng nhập), không phải Google Maps Platform, không đọc hay lưu dữ liệu địa điểm nào.
- `auth/external/ZaloProfileClient` gọi `graph.zalo.me/v2.0/me` kèm `appsecret_proof`. Id Zalo riêng
  theo app; Zalo không trả email.
- `AuthService.loginExternal`: đã có danh tính (`provider`, `provider_account_id`) → user đó; Google
  có `email_verified` (chỉ tính với `@gmail.com` hoặc token có `hd`) và trùng email một danh tính khác
  **đã xác minh** → **gộp** vào user đó; còn lại → user mới. Không gộp vào và không xác minh hộ danh
  tính chưa xác minh: có thể là người khác đăng ký trước bằng email này. Zalo không bao giờ gộp.
- Thiếu env (`GOOGLE_OAUTH_CLIENT_IDS`, `ZALO_APP_ID`, `ZALO_APP_SECRET`) → 503 `PROVIDER_NOT_CONFIGURED`;
  token sai → 401 `EXTERNAL_TOKEN_INVALID`; nhà cung cấp lỗi/quá 5 s → 502 `PROVIDER_UNAVAILABLE`.

## Tìm điểm đến không dùng AI (S2)

```
GET /api/regions/search?q=da lat            gợi ý khi gõ — chỉ đọc database
GET /api/regions/search?q=tam dao&online=1  khi bấm tìm — thiếu thì hỏi Nominatim rồi lưu lại
GET /api/regions/:id/places?categories=food,cafe   danh sách địa điểm của vùng (xem "Danh sách địa điểm của vùng")
GET /api/places/:id                         chi tiết (F5) + nội dung Google Maps theo thời gian thực
```

- **Tỉnh cũ/mới** được seed từ Nghị quyết 202/2025/QH15 (`regions/seed/vietnam-admin.ts`).
  Cùng file có danh sách **điểm đến** (tâm + bán kính + bí danh), gồm cả những địa danh
  không còn là đơn vị hành chính sau sáp nhập (huyện cũ như Cần Giờ, Củ Chi) để tìm ra ngay
  không cần Nominatim. Khung bao của điểm đến là khung vuông quanh tâm, nên bán kính phải đủ nhỏ
  để không phủ tâm điểm đến khác (Cần Giờ 13 km quanh rừng Sác, không lấn sang Vũng Tàu; có test).
- **Từ khóa không ra kết quả** được đếm trong `region_search_misses` (không lưu người tìm):
  `catalog_misses` khi tìm trong danh mục, `online_misses` khi đã hỏi cả Nominatim, và
  `weak_matches` khi có kết quả nhưng điểm cao nhất dưới ngưỡng khớp tốt (0.8, ví dụ
  "can gio" ra "Cần Thơ"), kèm `best_match_name`/`best_score` của lượt gần nhất. Xem
  `SELECT * FROM region_search_misses ORDER BY online_misses DESC, weak_matches DESC, catalog_misses DESC`
  để chọn điểm đến cần seed thêm. Lỗi ghi không làm hỏng lượt tìm.
- **Khu vực của một vùng là một khung bao (bbox)**, không phải polygon. Dùng để giới hạn tìm Google
  và loại tọa độ AI đoán sai:
  - tỉnh cũ và tỉnh mới không sáp nhập: sinh sẵn trong `regions/seed/province-bboxes.ts` bằng
    `scripts/generate-province-bboxes.ts` (chạy một lần, commit kết quả). Tỉnh cũ lấy từ relation OSM
    `boundary=historic` (`was:admin_level=4`, tên "X", "X cũ" hay "X (cũ)"); seeder ghi khi khởi động;
  - tỉnh mới sau sáp nhập: khung bao trọn các tỉnh cũ (seeder tính);
  - điểm đến seed: khung vuông quanh tâm theo bán kính;
  - vùng nhập từ Nominatim: `boundingbox` Nominatim trả về, lưu ngay lúc nhập;
  - còn thiếu (`regions/region-area.service.ts`): khung vuông quanh tâm, không có tâm thì hỏi Nominatim.
  Khung bao lấn sang vùng lân cận một chút ở rìa — chấp nhận được. Khung Khánh Hòa cũ gồm cả quần đảo
  Trường Sa nên rất rộng.
- Nominatim công cộng **cấm dùng cho autocomplete** và giới hạn 1 request/giây, vì vậy
  `online` chỉ bật khi người dùng bấm tìm. Production nên tự host hoặc dùng nhà cung cấp
  trả phí (đổi `NOMINATIM_URL`).

## Danh sách địa điểm của vùng (F2)

Spec `docs/superpowers/specs/2026-10-14-web-places-design.md`. `GET /api/regions/:id/places?categories=…`
(`places/web-places.service.ts`, `WebPlacesService`):

1. **Đã có danh sách còn hạn** (`region_place_lists.status = 'ready'`, `expires_at` chưa tới) → đọc
   `region_places` của vùng theo `rank`, lọc danh mục ("Tất cả" bỏ Lưu trú). Không phân trang.
2. **Quá hạn** (`WEB_PLACES_REFRESH_DAYS`, mặc định 30) → trả bản đang có, làm mới ở nền. Làm mới lỗi thì giữ
   `ready` và bản cũ.
3. **Chưa có** → chạy pipeline, chờ tối đa `WEB_PLACES_WAIT_MS` (mặc định 25 s); quá giờ trả
   `{ status: 'building', items: [] }`, pipeline chạy tiếp và client hỏi lại sau 3 s. Pipeline lỗi mà chưa có
   gì → 503 `PLACES_UNAVAILABLE` (thiếu `TAVILY_API_KEY` cũng vậy). Hai request cùng lúc cho một vùng dùng chung
   một lượt chạy (khóa trong bộ nhớ).

Pipeline (`refresh`): Tavily (4 truy vấn cố định: tham quan, ăn uống, cà phê, lưu trú) + một lượt Gemini có cấu
trúc (`langchain/place-search.service.ts`, ít bài quá thì agent tự tìm thêm) → chỉ giữ địa điểm có tên trong bài
(`web-grounding.ts`) → ghép Google bằng `GooglePlacesService.findPlace` trong khung bao vùng (`web-place-match.ts`:
tên giống ≥ `MATCH_MIN_SIMILARITY` và loại không mâu thuẫn) → không ghép được thì giữ tọa độ AI nếu nằm trong
vùng (nới ~2 km), không thì bỏ → lưu bằng `RegionPlaceStore`.

Bước ghép Google chỉ chạy khi `WEB_PLACES_GOOGLE_MATCH=true`, và **mặc định tắt**: Việt Nam nằm trong
[Prohibited Territories](https://cloud.google.com/maps-platform/terms/maps-prohibited-territories) của Google Maps
Platform, Places trả 403. Khi tắt, mọi địa điểm mới dùng tọa độ AI ("Vị trí gần đúng"). Các dòng đã ghép từ trước giữ
`location_source = 'google'`; khi tọa độ của chúng hết hạn mà không lấy lại được qua Google thì danh sách vùng tạm
ẩn chúng, cho tới lần làm mới danh sách.

Dữ liệu:
- `region_place_lists` (`status`, `fetched_at`, `expires_at`, `error_code`, `sources` = các bài viết) và
  `region_places` (`rank`, `articles` của từng địa điểm).
- Dòng `places.source = 'web'`: tên, loại, mô tả lấy từ bài viết (nội dung của mình). `location_source`:
  `google` (tọa độ Google, hạn 30 ngày như dòng `google`) hoặc `ai` (ước đoán, không hết hạn). Mỗi
  `google_place_id` chỉ một dòng: trùng với dòng người dùng đã lưu thì dùng lại, không đổi tên; làm mới thì dòng
  AI cùng tên được dùng lại (và nâng cấp nếu lần này ghép được).
- Mục `locationSource: 'ai'` được app đánh dấu **"Vị trí gần đúng"**; thời gian di chuyển tới đó chỉ là ước tính.

## Chi tiết địa điểm và Google (F5)

- Rating, đánh giá, giờ mở cửa và ảnh của Google **chỉ** có ở `GET /places/:id`,
  gọi Places API (New) mỗi lần mở, không lưu, không cache (PRD 7.4, FR-2.9).
- Chỉ dòng có `google_place_id` mới gọi Google; dòng tọa độ AI và dòng OSM cũ trả `googleStatus: 'not_found'`.
  Không còn ghép `place_id` theo tên.
- Dòng `web`/`google` có `sourceUrl` là link Google Maps; `locationSource` cho biết tọa độ từ đâu.
- `places.address` lưu địa chỉ lấy từ bài viết (nguồn riêng của Rong), không lưu địa chỉ Google. Chỉ giữ địa chỉ Gemini trả về khi phần số nhà + đường có trong một bài đã nhắc địa điểm (`groundedAddress` trong `web-grounding.ts`), không thì `NULL`. Dòng Google-only giữ `address = NULL`; chi tiết Google vẫn lấy trực tiếp ở mỗi lần mở.
- `region_places.image` lưu một ảnh `{ url, sourceUrl }` lấy từ bài viết (hotlink, không tải về). `searchWeb` tách
  ảnh `![alt](url)` kèm tiêu đề mục khỏi markdown Tavily trước khi cắt bài (`extractImages` trong
  `langchain/web-search.ts`); `groundedImage` (`web-grounding.ts`) chọn ảnh có alt, rồi tiêu đề mục, chứa tên địa
  điểm trong các bài đã nhắc nó. Không khớp thì `NULL`, client hiện icon danh mục. Danh sách cũ có ảnh khi tự làm
  mới.
- Client phải hiển thị "Google Maps", tách phần Google khỏi dữ liệu của app, và ghi
  tên tác giả ảnh/đánh giá kèm link (`author.uri`, `googleMapsUri`).

## Tìm địa điểm theo tên

```
GET  /api/regions/:id/places/search?q=…            gõ tới đâu khớp danh mục tới đó — chỉ đọc database
GET  /api/regions/:id/places/search?q=…&online=1   khi bấm tìm — thêm Google Places Text Search
GET  /api/places/google/:googlePlaceId             xem trước một kết quả Google (nội dung Google trực tiếp)
POST /api/places/google                            lưu kết quả Google vào "Muốn đi"
```

`places/place-search.service.ts` (`PlaceSearchService`):

- **`catalog` chỉ có dòng `web`** (danh sách tổng hợp của các vùng) trong khung bao của vùng, khớp theo tên
  (bỏ dấu, pg_trgm), tối đa 10. Dòng Google không bao giờ vào `catalog`.
- **Google chỉ khi bấm tìm** (`online=1` và Google đã bật), tối đa 5 kết quả trong khung bao của vùng. `q` sau
  khi cắt khoảng trắng phải có 1-100 ký tự, rỗng thì 400. Google lỗi thì `google: null` (danh mục vẫn trả).
- **Hạn mức** `PLACE_SEARCH_DAILY_LIMIT` (mặc định 60 lượt / người / 24 giờ, `place-search-limiter.ts`, trong
  bộ nhớ). Chỉ tính khi thật sự gọi Google: gõ tìm trong danh mục hay Google chưa bật không tốn lượt. Hết hạn
  mức thì 429 `PLACE_SEARCH_LIMIT`. Google lỗi (`google: null`) thì trả lại lượt.
- **Hạn mức xem/lưu** `PLACE_DETAILS_DAILY_LIMIT` (mặc định 150 lượt / người / 24 giờ, đếm riêng). Chỉ tính
  khi phải gọi Google: xem trước một `place_id` chưa có trong DB, hoặc lưu khi phải lấy tọa độ (`locate`).
  Hết hạn mức thì 429 `PLACE_DETAILS_LIMIT`. Hai hạn mức phải là số nguyên ≥ 1, sai thì app dừng khi khởi động.
- **Kết quả Google trùng `place_id` đã có trong `places`** được trả ở `existing` (là địa điểm có sẵn, có `id`),
  không nằm trong `google`: dòng `web` thì hiện tên trong danh sách; dòng nguồn Google thì hiện tên Google trực tiếp
  (tên trong DB do người khác đặt nên không lộ ra). Dòng nguồn Google mà Google không trả tên thì để lại trong
  `google`, không kèm id.
- **Xem trước** (`GET /places/google/:googlePlaceId`): `place_id` đã có dòng `web` (hoặc dòng Google)
  thì chỉ trả `{ placeId }` để client mở chi tiết thường. Chưa có thì trả nội dung Google lấy trực tiếp
  (tên, địa chỉ, tọa độ, loại gợi ý, rating/ảnh…), không ghi database (PRD 7.4). 400 `INVALID_GOOGLE_PLACE_ID`,
  404 `PLACE_NOT_FOUND`, 429 `PLACE_DETAILS_LIMIT`, 503 `GOOGLE_UNAVAILABLE`.
- **Lưu** (`POST /places/google`, body `googlePlaceId`, `name`, `category`, `regionId`, `addToSaved?`): `place_id`
  đã có dòng `web` thì dùng dòng đó, không tạo dòng mới. `addToSaved: false` chỉ trả id (để đưa vào lịch trình
  khi lập lịch), không thêm vào "Muốn đi". Chưa có thì tạo dòng `source = 'google'` qua
  `GooglePlaceRowsService.upsert` (cùng một transaction với lượt lưu). **Tên lưu là tên người dùng xác nhận**
  (`saved_places.display_name`), không bao giờ là tên Google; `places.name` của dòng Google là tên của người
  đầu tiên lưu. Vùng được kiểm tra trước khi gọi Google (404 `REGION_NOT_FOUND`).
- `places/google-place-rows.service.ts` (`GooglePlaceRowsService`) là nơi duy nhất ghi dòng Google, dùng chung
  với chia sẻ vào app (F4): tên do người dùng đặt, tọa độ Google hạn 30 ngày.
- **"Muốn đi"** (`saved_places.source`: `manual | share | search`): lưu từ tìm kiếm ghi `search`. Khi một địa
  điểm được lưu lại bằng nguồn khác, nguồn ưu tiên là **share > search > manual** (không bị hạ cấp).

## Lịch trình (F6)

```
POST   /api/itineraries          tạo (planningMode "ai" | "manual")
GET    /api/itineraries          danh sách của tôi
GET    /api/itineraries/:id
DELETE /api/itineraries/:id
GET    /api/itineraries/:id/share-link   link xem đang hiệu lực (quyền xem, kể cả viewer) hoặc { link: null }
PUT    /api/itineraries/:id/share-link   lấy hoặc tạo, không thu hồi link đã gửi (quyền sửa) — app dùng khi chia sẻ
POST   /api/itineraries/:id/share-link   tạo link mới, thu hồi link cũ (quyền sửa)
DELETE /api/itineraries/:id/share-link   thu hồi (quyền sửa)
GET    /api/public/itineraries/:token    trang chỉ xem, không cần đăng nhập (apps/web /t/:token)
```

Token link xem = HMAC(`SHARE_LINK_SECRET`, hoặc `JWT_SECRET` nếu trống, id link) — `itineraries/share-link-token.ts`.
Database chỉ lưu SHA-256 của token, nhưng server tính lại được token nên chia sẻ lại không đổi link.

Quy trình AI (`itineraries/`):

1. **Ứng viên** — điểm người dùng chọn (bắt buộc) + điểm bổ sung từ danh sách của vùng
   (`region_places`, điểm suy từ thứ hạng) nếu bật `allowAiSuggestions` (`planning/clustering.ts#pickExtras`: hợp đối tượng, sở
   thích, ≤ 90 phút từ nơi ở, không để một danh mục áp đảo).
2. **Gom cụm theo ngày** — k-means theo tọa độ, theo sức chứa mỗi ngày (đối tượng × nhịp độ).
3. **Gemini + Google Maps** sắp thứ tự, thời lượng, lý do, tra giờ mở cửa còn thiếu
   (`ai-planner.ts`). Chỉ được dùng id được gửi; kết quả được kiểm tra lại toàn bộ. Gemini
   lỗi → xếp bằng thuật toán (`planner: "heuristic"`).
4. **Xếp giờ bằng code** (`planning/scheduler.ts`) — thời gian di chuyển ước tính
   (`planning/travel.ts`, chưa dùng Google Routes), giờ mở cửa (giờ trong bài viết →
   AI → giờ thông thường theo danh mục), bữa ăn theo khung giờ từ quán "Ăn uống" gần lộ trình, nghỉ trưa
   theo đối tượng. Không vừa → "Chưa xếp được" kèm lý do.

Quy tắc theo đối tượng, khung bữa ăn, thời lượng mặc định, giờ thông thường: `planning/rules.ts`.

## Nơi đã đi (`visits/`)

Nơi người dùng đã đi: suy ra từ lịch trình đã kết thúc (`inferred`), người dùng xác nhận lại sau chuyến đi
(`confirmed`/`rejected`). Bộ gợi ý trang chủ bỏ các nơi `inferred` + `confirmed`.

## Gợi ý trang chủ (`recommendations/`)

Spec `docs/superpowers/specs/2026-10-19-home-recommendations-design.md`. `GET /api/recommendations` trả bảng tin
gợi ý: 3 bản nháp lịch trình cho mỗi (người dùng, khung giờ 6:00/15:00, chủ đề), lấy từ kho bản nháp chung
`itinerary_drafts` dùng lại giữa nhiều người dùng (theo `pool_key`). Bản nháp sinh bằng thuật toán (`heuristic`),
chỉ nâng cấp bằng Gemini (`upgrade-draft`) khi được xem nhiều (`view_count ≥ 5`) hoặc lưu nhiều (`save_count ≥ 2`).

- Bộ gợi ý chỉ chọn vùng có danh sách địa điểm **`ready`** (`region_place_lists.status`); không vùng nào khác được
  tự tạo danh sách khi đang tính gợi ý. Chỉ job theo lịch `warm-featured-regions` được gọi
  `WebPlacesService.listForRegion()` để tạo trước danh sách cho các vùng nổi bật.
- Hàng đợi BullMQ: `recommendations` (job thường) và `recommendations-ai` (job gọi Gemini, có limiter riêng để
  không bị job thường chặn). Tắt bằng `RECOMMENDATIONS_ENABLED=false`, tự động tắt khi `NODE_ENV=test`
  (e2e), và với `NODE_ENV=production` chỉ bật khi có `REDIS_HOST`: job chạy ngay trong process (`RecommendationsQueue`), không có lịch chạy theo cron
  (`RecommendationScheduler`, 4 lịch: làm mới 6:00/15:00, sinh chủ đề thứ Hai 3:00, làm nóng vùng nổi bật 2:00,
  dọn dữ liệu cũ 4:30, múi giờ `Asia/Ho_Chi_Minh`). Hàng đợi bật mà Redis không tới được thì app vẫn khởi động
  (lịch chạy đăng ký nền), lệnh hàng đợi trên đường request lỗi sau 3 giây và bị bỏ qua có log: trang chủ trả
  `building`, lưu hồ sơ / xác nhận nơi đã đi vẫn thành công.
- Bản nháp xếp trên thứ Bảy neo rồi dời sang ngày đi thật; khác thứ trong tuần thì `ItinerariesService.retimePlan`
  tính lại cảnh báo (đóng cửa, giờ mở cửa…) theo ngày thật, giữ nguyên giờ. `save` lưu bản dời ngày này (tọa độ ảnh
  chụp), không lưu bản trả về API đã điền tọa độ Google còn hạn. Hai lần lưu cùng lúc: chỉ lần gắn được
  `saved_itinerary_id` thắng, lần kia xóa lịch trình vừa tạo và trả lịch trình thắng (200).
- `POST /visits/review` xóa thẻ chưa lưu của khung giờ hiện tại (mọi chủ đề) và job dựng của chúng, để lần mở trang
  chủ sau dựng lại không có nơi vừa xác nhận.
- Ảnh cho thẻ gợi ý (`region-images.ts`): Unsplash (`UNSPLASH_ACCESS_KEY`, tùy chọn) → ảnh hạng cao nhất của vùng
  lấy từ bài viết (có nguồn) → không có ảnh. Lưu vào `region_images`; cột `blocked` dùng để gỡ một ảnh mà không bị
  job làm mới ghi đè lại.
- Script `scripts/enqueue-recommendation-job.ts` đẩy tay một job vào hàng đợi để kiểm tra (`npx tsx
  scripts/enqueue-recommendation-job.ts refresh-window`), cần Redis chạy (`pnpm infra:up`).

**Lệch PRD:** bản nháp gợi ý không trừ lượt dùng AI của người dùng (FR-6.5) — kho bản nháp dùng chung giữa nhiều
người nên không gắn được vào hạn mức của riêng ai.

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
4. **Khớp** — `place-resolver.ts` khớp từng ứng viên với dòng `web` theo độ giống tên (trong vùng gợi ý,
   hoặc toàn quốc với ngưỡng cao hơn), không khớp thì hỏi Google qua `GooglePlacesService`, tối đa 3 lựa chọn
   Google mỗi ứng viên.
5. **Kết thúc** — `done`, hoặc `failed` với `error_code`: `METADATA_UNAVAILABLE`, `AI_UNAVAILABLE`, `TIMEOUT`
   (job quá 30 giây), `INTERRUPTED`.

`share_imports` (migration `1759100000000-AddShareImports`): `id`, `user_id`, `url`, `shared_text`, `status`
(`pending | done | failed`), `platform`, `metadata` (jsonb), `candidates` (jsonb), `error_code`, `created_at`,
`finished_at`. `saved_places` thêm `source` (`manual | share`, về sau thêm `search`) và `share_import_id`.

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

## Link mời mở từ Zalo/Messenger (F10)

App chia sẻ link `https://<domain>/invite/<token>` (spec `2026-10-19-mobile-groups-invite-design.md`). Hai route
đứng **ngoài** prefix `api` (`src/global-prefix.ts`; e2e tests dựng prefix bằng cùng hằng số), không cần đăng nhập:

- `GET /invite/:token` (`invite-page.controller.ts`): trang HTML dựng bằng `invite-page.ts` từ
  `InvitesService.preview` — tên nhóm, người mời, quyền, hạn, nút tải APK
  (`github.com/bluez44/Rong/releases/latest`), nút `rong://invite/<token>`. Tên nhóm/người mời được escape. Link
  hết hạn/thu hồi (410) hay không có (404) vẫn trả HTML với đúng status đó.
- `GET /.well-known/assetlinks.json`: Digital Asset Links cho `vn.rong.app`, fingerprint lấy từ
  `ANDROID_APP_LINK_SHA256` (cách nhau dấu phẩy). Máy đã cài app và Android xác minh được thì link mở thẳng app.

## `places.source` và dòng Google

`places` có hai loại dòng, phân biệt bằng cột `source`:

- `web` — danh sách địa điểm tổng hợp từ bài viết (xem "Danh sách địa điểm của vùng"). Chỉ loại này được liệt
  kê, gợi ý hay dùng làm điểm bổ sung khi lập lịch, **qua `region_places` của vùng**; không truy vấn danh sách
  nào được lọc theo khung bao trên `places` nữa.
- `google` — chỉ tạo khi người dùng chọn một địa điểm Google (chia sẻ vào app, tìm kiếm). Lưu `google_place_id`
  (vô thời hạn), tên do người dùng đặt, và tọa độ Google có hạn `location_expires_at`. Không bao giờ được xếp
  hạng (PRD 7.4).

Dòng `osm` của danh mục OSM/Wikidata cũ đã bỏ hẳn (migration `DropUnusedPlaceColumns`, cùng các cột `osm_type`,
`osm_id`, `wikidata_id`, `sitelinks`, `composite_score`, `google_matched_at`). Migration dừng lại nếu DB còn dòng
OSM, vì xóa chúng sẽ xóa theo "Muốn đi" và địa điểm nhóm trỏ tới.

Mỗi `google_place_id` chỉ có một dòng `web` hoặc `google` (`uq_place_google`). Tọa độ Google (dòng `google`, và
dòng `web` có `location_source = 'google'`) hết hạn sau 30 ngày; với dòng từ chia sẻ là 30 ngày sau `created_at`
của job (không phải lúc lưu), và dữ liệu cũ không bao giờ kéo dài hạn đó. Hai thành phần giữ quy tắc này:

- `places/google-location-janitor.ts` — `GoogleLocationJanitor` đặt `location` và `location_expires_at` về
  NULL cho tọa độ Google quá hạn, 60 giây sau khi khởi động rồi mỗi 6 giờ.
- `places/place-location.service.ts` — `PlaceLocationService.ensure(ids)` lấy lại tọa độ qua Google cho dòng
  đã hết hạn trước khi lập lịch trình hay hiện danh sách của vùng; trả các id vẫn không lấy được.

Khi `ensure` không lấy lại được tọa độ, `PUT /itineraries/:id` trả 503 `PLACE_LOCATION_UNAVAILABLE`.
`GET /places/:id` không gọi `ensure`: dòng đã ghép Google trả `googlePlaceId` để client chỉ đường bằng
place_id (không cần tọa độ), tọa độ Google đã hết hạn thì `coordinates: null`; dòng AI/OSM luôn có tọa độ riêng.

Lịch trình (`itineraries.days` JSONB) không lưu tọa độ Google hoặc địa chỉ Google. Ảnh chụp địa điểm nguồn Google ghi
`coordinates: null` (`itineraries/planning/snapshot.ts`); các đường đọc (GET/POST/PUT lịch trình, trang xem công khai)
điền tọa độ Google còn hạn và địa chỉ riêng của Rong từ `places` qua `itineraries/itinerary-place-data.ts`.

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
