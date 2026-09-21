# S1 — Nền tảng backend & Xác thực

| | |
| --- | --- |
| Ngày | 21/09/2026 |
| Trạng thái | Đã duyệt thiết kế, sẵn sàng lập kế hoạch thực thi |
| Phạm vi | `apps/backend`, `packages/shared-types` |
| PRD liên quan | F11 (mục 6.11), FR-6.5, US-15 |

## 1. Bối cảnh

Backend của Rong gồm khoảng mười hệ thống con tương đối độc lập. Tài liệu này
đặc tả **lát cắt đầu tiên**: lớp nền dùng chung cho mọi lát sau, cộng với xác
thực người dùng.

Lộ trình các lát cắt đã chốt:

| # | Lát cắt | PRD | Phụ thuộc |
| --- | --- | --- | --- |
| **S1** | **Nền tảng + Auth** | F11 | — |
| S2 | Vùng & tìm kiếm điểm đến | F1 | S1 |
| S3 | Danh mục địa điểm & khám phá | F2, F9.1 | S2 |
| S4 | Cổng Google | 7.4, F5 | S3 |
| S5 | Xếp hạng & analytics | F3, §11 | S3 |
| S6 | Lịch trình: tạo & chi phí | F6, F7 | S3, S4 |
| S7 | Lịch trình: chỉnh sửa | F8, F9 | S6 |
| S8 | Nhóm & chia sẻ | F10 | S6 |
| S9 | Realtime | FR-10.5 | S8 |
| S10 | Share-to-app | F4 | S3 |
| S11 | Pipeline dữ liệu + curation | 7.5 | S3 |

### 1.1 Sai khác có chủ ý so với PRD

PRD mục 6.11 quy định đăng nhập bằng Google, Apple và số điện thoại (OTP), và
**không có** mật khẩu. Chủ sản phẩm quyết định đổi cho MVP: dùng email + mật
khẩu trước, thêm Google OAuth sau.

Hệ quả phải xử lý trong thiết kế:

- Có mật khẩu thì phải có đường khôi phục, mà việc đó cần kênh email.
- Đăng nhập bằng mật khẩu có thể bị dò, nên cần chặn theo tần suất — thứ mà
  OAuth và OTP vốn được nhà cung cấp lo hộ.
- Mô hình dữ liệu phải sẵn sàng cho việc thêm nhà cung cấp sau, không đòi hỏi
  migration phá vỡ dữ liệu đã có.

## 2. Các quyết định thiết kế

### 2.1 Tách danh tính khỏi người dùng

`users` giữ con người; `auth_identities` giữ cách người đó chứng minh mình là
ai. Một `user` có nhiều `auth_identity`.

Thêm Google sau này vì vậy chỉ là chèn thêm một dòng `auth_identities` trỏ về
cùng `user_id`. Người đã đăng ký bằng mật khẩu rồi bấm "Đăng nhập với Google"
bằng cùng email sẽ vào đúng tài khoản cũ, thay vì tạo ra tài khoản trùng.

Nếu nhét `email` và `password_hash` thẳng vào `users`, việc thêm nhà cung cấp
thứ hai sẽ buộc phải migration và viết lại luồng đăng nhập.

### 2.2 Quản lý phiên: JWT ngắn hạn + refresh token lưu trong database

Đã cân nhắc ba phương án:

| Phương án | Ưu | Nhược | Kết luận |
| --- | --- | --- | --- |
| Access JWT + refresh lưu DB, có xoay vòng | Đường đọc không chạm DB; thu hồi được | Cần một bảng | **Chọn** |
| Access JWT + refresh cũng stateless | Không cần bảng | **Không thu hồi được** | Loại |
| Session opaque, tra DB mỗi request | Thu hồi tốt nhất | Mỗi request một truy vấn | Loại |

Phương án thứ hai bị loại vì PRD F11 yêu cầu "xóa tài khoản và toàn bộ dữ liệu
ngay trong app". Xóa xong mà token cũ vẫn gọi được API thì lời hứa đó là giả.

**Vòng đời token:** access token sống 15 phút, refresh token sống 60 ngày. App
di động ít khi mở lại sau nhiều tháng, nhưng cũng không nên bắt người dùng đăng
nhập lại mỗi tuần.

### 2.3 Chỉ lưu hash của refresh token

Bảng lưu SHA-256 của token, không lưu token gốc. Nếu database bị lộ, kẻ tấn
công vẫn không có token dùng được.

Dùng SHA-256 chứ không phải argon2 ở đây là cố ý: refresh token là chuỗi ngẫu
nhiên 256 bit do máy sinh, không phải mật khẩu do người đặt, nên không có không
gian tìm kiếm nhỏ để mà dò. Băm chậm ở đây chỉ làm chậm mọi lần refresh.

### 2.4 Xoay vòng token và phát hiện đánh cắp

Mỗi lần refresh thành công: token cũ được đánh dấu `revoked_at` và trỏ
`replaced_by` sang token mới.

Nếu có ai trình ra một refresh token **đã bị thu hồi**, đó là dấu hiệu token bị
sao chép — người dùng thật và kẻ tấn công đang dùng cùng một chuỗi. Khi đó thu
hồi **toàn bộ** refresh token của người dùng, buộc đăng nhập lại.

### 2.5 Chặn theo tần suất, không khóa tài khoản

Khóa tài khoản sau N lần sai nghe có vẻ an toàn hơn, nhưng nó biến việc biết
email của một người thành khả năng khóa tài khoản người đó. Vì vậy chỉ chặn
theo tần suất.

### 2.6 Băm mật khẩu bằng argon2id

Dùng `@node-rs/argon2`: có sẵn binary biên dịch trước cho mọi nền tảng, nên
không cần toolchain native trên máy dev hay CI. Tham số theo khuyến nghị OWASP:
`memoryCost` 19 MiB, `timeCost` 2, `parallelism` 1.

### 2.7 Chuẩn hóa email ở tầng ứng dụng

Email được hạ về chữ thường và cắt khoảng trắng trước khi ghi, kèm unique index
thông thường. Không dùng extension `citext`: một quy tắc chuẩn hóa nằm trong
code dễ đọc và dễ test hơn một hành vi ẩn trong kiểu dữ liệu.

## 3. Mô hình dữ liệu

### 3.1 `users`

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| `id` | `uuid` PK | `gen_random_uuid()` |
| `display_name` | `text` NULL | Guest chưa có tên |
| `is_guest` | `boolean` NOT NULL DEFAULT `false` | |
| `ai_generations_used` | `int` NOT NULL DEFAULT `0` | FR-6.5, **chưa dùng ở S1** |
| `ai_quota_period_start` | `date` NULL | FR-6.5, **chưa dùng ở S1** |
| `last_seen_at` | `timestamptz` NOT NULL | Dùng cho việc dọn guest |
| `created_at` / `updated_at` | `timestamptz` NOT NULL | |

Index: `(is_guest, last_seen_at)` phục vụ tác vụ dọn dẹp.

Hai cột `ai_*` được đặt trước dù S1 không đụng tới, vì thêm cột lúc bảng còn
rỗng rẻ hơn migration khi đã có người dùng thật. Việc thực thi hạn mức thuộc S6.

### 3.2 `auth_identities`

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` NOT NULL | FK → `users(id)` ON DELETE CASCADE |
| `provider` | `auth_provider` enum | `'password' \| 'google' \| 'apple'` |
| `provider_account_id` | `text` NOT NULL | Email đã chuẩn hóa với `password`; `sub` với OAuth |
| `email` | `text` NULL | Đã chuẩn hóa |
| `email_verified_at` | `timestamptz` NULL | Luôn NULL ở S1 |
| `password_hash` | `text` NULL | Chỉ với `provider='password'` |
| `created_at` | `timestamptz` NOT NULL | |

Ràng buộc:

- `UNIQUE (provider, provider_account_id)`
- `CHECK (provider <> 'password' OR password_hash IS NOT NULL)`
- Index thường (không unique) trên `email`, phục vụ việc tra cứu khi gắn danh
  tính OAuth vào tài khoản sẵn có.

**Không** đặt unique trên riêng `email`. Một người dùng hoàn toàn có thể có hai
danh tính cùng email — một `password`, một `google` — và đó chính là cơ chế gắn
tài khoản mô tả ở mục 2.1. Ràng buộc "mỗi email chỉ có một tài khoản mật khẩu"
đã được `UNIQUE (provider, provider_account_id)` lo, vì với `provider='password'`
thì `provider_account_id` chính là email đã chuẩn hóa.

Enum khai báo sẵn cả ba giá trị ngay từ migration đầu, để thêm Google sau này
không phải `ALTER TYPE`.

### 3.3 `refresh_tokens`

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` NOT NULL | FK → `users(id)` ON DELETE CASCADE |
| `token_hash` | `text` NOT NULL UNIQUE | SHA-256 của token |
| `expires_at` | `timestamptz` NOT NULL | |
| `revoked_at` | `timestamptz` NULL | |
| `replaced_by` | `uuid` NULL | FK → `refresh_tokens(id)` |
| `created_at` | `timestamptz` NOT NULL | |

Index: `(user_id, revoked_at)` để thu hồi hàng loạt và liệt kê phiên.

### 3.4 Xóa tài khoản

`DELETE /api/users/me` xóa cứng dòng `users`; mọi bảng con cascade theo. Đây là
cách duy nhất trung thực với câu "xóa toàn bộ dữ liệu" trong PRD.

Khi S8 đưa nhóm vào, lịch trình do chủ nhóm tạo mà cả nhóm đang dùng sẽ cần một
chính sách riêng. Đó là câu hỏi sản phẩm, sẽ nêu lại ở S8, không giải ở đây.

### 3.5 Dọn tài khoản guest

`POST /auth/guest` tạo một dòng `users` mỗi lần gọi, nên bảng sẽ phình vô hạn
nếu không dọn.

Một tác vụ theo lịch chạy hằng ngày xóa các `users` có `is_guest = true` và
`last_seen_at` cũ hơn **30 ngày**. Guest vẫn đang dùng app thì `last_seen_at`
được cập nhật nên không bị đụng tới.

## 4. API

Mọi endpoint nằm dưới tiền tố `/api`.

### 4.1 Xác thực

| Method | Path | Auth | Thân yêu cầu | Trả về |
| --- | --- | --- | --- | --- |
| POST | `/auth/register` | — | `email`, `password`, `displayName?` | `AuthTokens` |
| POST | `/auth/login` | — | `email`, `password` | `AuthTokens` |
| POST | `/auth/guest` | — | — | `AuthTokens` |
| POST | `/auth/upgrade` | Bearer (guest) | `email`, `password`, `displayName?` | `AuthTokens` |
| POST | `/auth/refresh` | — | `refreshToken` | `AuthTokens` |
| POST | `/auth/logout` | — | `refreshToken` | `204` |

### 4.2 Người dùng

| Method | Path | Auth | Việc |
| --- | --- | --- | --- |
| GET | `/users/me` | Bearer | Hồ sơ hiện tại |
| PATCH | `/users/me` | Bearer | Đổi `displayName` |
| DELETE | `/users/me` | Bearer | Xóa tài khoản và toàn bộ dữ liệu |

### 4.3 Kiểu dữ liệu trả về

Bổ sung vào `@rong/shared-types`:

```ts
interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;   // giây, của accessToken
  user: UserProfile;
}

interface UserProfile {
  id: string;
  displayName: string | null;
  email: string | null;   // null với guest
  isGuest: boolean;
  createdAt: string;
}
```

### 4.4 Nội dung JWT

```
sub      user id
isGuest  boolean
iat, exp
```

Không nhét email hay tên vào token: chúng có thể đổi, mà token thì sống tiếp
tới khi hết hạn.

### 4.5 Quy tắc mã lỗi

| Tình huống | HTTP | `code` |
| --- | --- | --- |
| Email đã tồn tại | 409 | `EMAIL_TAKEN` |
| Sai email hoặc mật khẩu | 401 | `INVALID_CREDENTIALS` |
| Refresh token sai, hết hạn hoặc đã thu hồi | 401 | `INVALID_REFRESH_TOKEN` |
| Gọi `/auth/upgrade` bằng tài khoản không phải guest | 409 | `NOT_A_GUEST` |
| Vượt hạn mức tần suất | 429 | `RATE_LIMITED` |
| Dữ liệu vào không hợp lệ | 400 | `VALIDATION_FAILED` |

Đăng nhập sai luôn trả về `INVALID_CREDENTIALS` bất kể email có tồn tại hay
không — phân biệt hai trường hợp sẽ biến form đăng nhập thành công cụ dò xem ai
đã có tài khoản.

## 5. Luồng guest và nâng cấp

```
POST /auth/guest
  → INSERT users(is_guest = true)
  → cấp cặp token

… người dùng tìm kiếm, lưu địa điểm, tạo một lịch trình …

POST /auth/upgrade   (kèm access token của guest)
  → kiểm tra users.is_guest = true, nếu không thì 409 NOT_A_GUEST
  → kiểm tra email chưa bị dùng, nếu rồi thì 409 EMAIL_TAKEN
  → INSERT auth_identities(provider='password', user_id = <chính user đó>)
  → UPDATE users SET is_guest = false, display_name = …
  → thu hồi toàn bộ refresh token cũ, cấp cặp token mới
  → user_id KHÔNG đổi
```

Vì `user_id` giữ nguyên, mọi dữ liệu guest đã tạo tự nhiên thuộc về tài khoản
mới. Không có bước chuyển dữ liệu nào, nên cũng không có bước nào để hỏng.

Thu hồi token cũ tại thời điểm nâng cấp là có chủ ý: quyền hạn của tài khoản đã
đổi, nên phiên cũ nên được cấp lại.

## 6. Lớp nền dùng chung

S1 đặt những quy ước mà S2–S11 sẽ dựa vào.

### 6.1 Khuôn lỗi thống nhất

Một `ExceptionFilter` toàn cục biến mọi lỗi thành:

```json
{
  "statusCode": 409,
  "code": "EMAIL_TAKEN",
  "message": "Email này đã được đăng ký.",
  "requestId": "01J…"
}
```

Lỗi không lường trước được ghi log kèm `requestId` và trả về `message` chung,
không lộ chi tiết nội bộ ra ngoài.

### 6.2 Request id và log có cấu trúc

Middleware gán mỗi request một id (ULID), đưa vào context để log kèm, và trả
lại trong header `x-request-id`.

### 6.3 Quy ước phân trang con trỏ

F2 cần cuộn vô hạn 10 mục mỗi lần. Phân trang theo con trỏ chứ không theo số
trang, vì danh sách địa điểm được sắp theo điểm tổng hợp — điểm này thay đổi
theo thời gian, nên `OFFSET` sẽ làm mục bị lặp hoặc bị nhảy cóc.

```ts
interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}
```

Định nghĩa trong `@rong/shared-types`, dùng chung cho mọi danh sách về sau.

### 6.4 Chặn tần suất

`@nestjs/throttler` với Redis làm nơi lưu đếm, để nhiều instance backend dùng
chung hạn mức.

| Endpoint | Hạn mức | Khóa đếm |
| --- | --- | --- |
| `/auth/login` | 10 lần / 15 phút | **email** |
| `/auth/login` | 100 lần / 15 phút | IP |
| `/auth/register` | 30 lần / giờ | IP |
| `/auth/guest` | 60 lần / giờ | IP |
| `/auth/refresh` | 300 lần / giờ | IP |
| Mặc định | 100 lần / phút | IP |

**Vì sao hạn mức theo IP lại rộng đến vậy.** Người dùng Việt Nam vào app chủ
yếu qua mạng di động, mà các nhà mạng đều dùng CGNAT — hàng nghìn thuê bao chia
nhau một địa chỉ IP công cộng. Đặt hạn mức chặt theo IP sẽ chặn nhầm người dùng
thật vào giờ cao điểm, mà lại không cản được kẻ tấn công có trong tay một dải
IP. Vì vậy:

- Tuyến phòng thủ **chính** cho đăng nhập là hạn mức theo **email**, vốn không
  bị CGNAT ảnh hưởng: dò mật khẩu của một tài khoản cụ thể thì dù đổi IP bao
  nhiêu lần cũng vẫn đụng cùng một bộ đếm.
- Hạn mức theo IP chỉ để chặn kịch bản quét tự động thô, nên đặt rộng.
- `/auth/refresh` gần như không cần chặn: refresh token là chuỗi ngẫu nhiên 256
  bit, không có không gian nào để dò. Hạn mức ở đây chỉ là van an toàn chống
  client lỗi gọi lặp vô hạn.

Hạn mức cho `/auth/guest` không nhằm chống dò mật khẩu mà chống việc mỗi lần
gọi lại sinh một dòng trong bảng `users`.

## 7. Kiểm thử

### 7.1 Unit test — chạy được mà không cần database

- Dịch vụ băm mật khẩu: băm rồi xác minh đúng; mật khẩu sai thì trượt; hai lần
  băm cùng một mật khẩu cho ra hai chuỗi khác nhau.
- Dịch vụ token: token sinh ra giải mã được; token hết hạn bị từ chối; token
  bị sửa chữ ký bị từ chối.
- Logic chuẩn hóa email.
- `AuthService` với repository giả lập: đăng ký trùng email, đăng nhập sai,
  refresh bằng token đã thu hồi.

### 7.2 E2E — chạy trên database thật (`pnpm infra:up`)

Kịch bản chính, đi đúng đường người dùng thật:

```
guest → tạo dữ liệu → upgrade → đăng nhập lại → refresh → xóa tài khoản
```

Các khẳng định phải có:

- Sau `upgrade`, `user_id` không đổi và dữ liệu guest tạo ra vẫn còn.
- Sau `refresh`, refresh token cũ không dùng lại được.
- Dùng lại refresh token đã thu hồi thì **mọi** phiên của người đó bị thu hồi.
- Sau `DELETE /users/me`, access token cũ bị từ chối và các dòng liên quan
  trong `auth_identities`, `refresh_tokens` đã biến mất.

## 8. Ngoài phạm vi S1

| Hạng mục | Vì sao hoãn |
| --- | --- |
| Quên mật khẩu, xác minh email | Kéo theo nhà cung cấp email, template, token đặt lại. Tách thành lát riêng |
| Google / Apple OAuth | Mô hình dữ liệu đã sẵn sàng; luồng để sau |
| Thực thi hạn mức AI | Cột đã có; logic thuộc S6 |
| Chính sách xóa tài khoản khi có nhóm | Chưa có nhóm; nêu lại ở S8 |
| Onboarding, hỏi sở thích | Thuộc phía client |
| Đăng nhập bằng số điện thoại (OTP) | PRD có, nhưng chủ sản phẩm hoãn lại |
