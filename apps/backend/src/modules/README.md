# Backend modules

Mỗi thư mục tương ứng một nhóm tính năng trong [PRD](../../../../docs/PRD-Rong.md).

| Thư mục | PRD | Trách nhiệm |
| --- | --- | --- |
| `auth/` | F11 | Đăng ký / đăng nhập email + mật khẩu, xác minh email, JWT guard toàn cục (`@Public()` để mở route). Sẵn chỗ cho Google / Apple qua `auth_identities` |
| `users/` | F11 | Hồ sơ, hạn mức lượt AI hằng tháng (FR-6.5), xóa tài khoản |
| `regions/` | F1 | Tìm vùng (tỉnh cũ/mới, điểm đến, xã/phường), bí danh, ranh giới PostGIS lấy từ OSM, seed sáp nhập 1/7/2025 |
| `places/` | F2, F5 | Danh mục địa điểm riêng từ OSM + Wikidata, lọc theo polygon, điểm tổng hợp, phân trang con trỏ |
| `open-data/` | 7.1 | **Cổng duy nhất** gọi OSM Nominatim, Overpass, Wikidata (giãn cách request, User-Agent) |
| `ranking/` | F3 | Điểm tổng hợp 0–100, nhãn "Đang hot" |
| `google/` | 7.4 | **Cổng duy nhất** gọi Google Places + Routes |
| `share-import/` | F4 | Nhận link mạng xã hội, trích xuất và khớp địa điểm |
| `itineraries/` | F6, F7, F8, F9 | Tạo lịch trình, ước tính chi phí, chỉnh sửa |
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
GET /api/regions/:id                        chi tiết + ranh giới GeoJSON (tải từ OSM lần đầu)
GET /api/regions/:id/places?categories=food,cafe&cursor=…   địa điểm trong polygon
```

- **Tỉnh cũ/mới** được seed từ Nghị quyết 202/2025/QH15 (`regions/seed/vietnam-admin.ts`).
  Ranh giới tỉnh cũ và thành phố cấp huyện đã bị bỏ (Đà Lạt, Vũng Tàu…) lấy từ OSM
  *tại ngày 30/6/2025* (Overpass `[date:…]`); tỉnh mới là hợp các tỉnh cũ (`ST_Union`).
- **Địa điểm** lấy từ Overpass theo khung bao của vùng, phân loại bằng tag OSM
  (`places/osm-place-mapping.ts`), chấm điểm tất định (`places/place-scoring.ts`), lưu
  lại và làm mới sau `PLACES_REFRESH_DAYS` ngày. Địa điểm thuộc vùng nào tính bằng
  `ST_Covers` lúc truy vấn, nên dùng chung cho vùng cũ và mới.
- Nominatim công cộng **cấm dùng cho autocomplete** và giới hạn 1 request/giây, vì vậy
  `online` chỉ bật khi người dùng bấm tìm. Production nên tự host hoặc dùng nhà cung cấp
  trả phí (đổi `NOMINATIM_URL`, `OVERPASS_URL`).
- Luôn hiển thị dòng `attribution` trả về (ODbL bắt buộc ghi công OpenStreetMap).
