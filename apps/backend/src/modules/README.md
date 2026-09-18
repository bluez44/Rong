# Backend modules

Mỗi thư mục tương ứng một nhóm tính năng trong [PRD](../../../../docs/PRD-Rong.md).

| Thư mục | PRD | Trách nhiệm |
| --- | --- | --- |
| `auth/` | F11 | Đăng nhập Google / Apple / OTP, access + refresh token |
| `users/` | F11 | Hồ sơ, hạn mức lượt AI hằng tháng (FR-6.5), xóa tài khoản |
| `regions/` | F1 | Polygon PostGIS, bí danh, địa giới cũ/mới (FR-1.9), tìm kiếm không dấu |
| `places/` | F2, F5 | Danh mục địa điểm riêng, lọc theo polygon, bộ lọc và sắp xếp |
| `ranking/` | F3 | Điểm tổng hợp 0–100, nhãn "Đang hot" |
| `google/` | 7.4 | **Cổng duy nhất** gọi Google Places + Routes |
| `share-import/` | F4 | Nhận link mạng xã hội, trích xuất và khớp địa điểm |
| `itineraries/` | F6, F7, F8, F9 | Tạo lịch trình, ước tính chi phí, chỉnh sửa |
| `groups/` | F10 | Nhóm, link mời, phân quyền, nhật ký hoạt động |
| `realtime/` | FR-10.5 | WebSocket gateway + Redis adapter |
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
