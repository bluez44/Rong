# Mobile: nhóm và mời bạn bè bằng link (F10, phần 1)

Ngày: 2026-10-19 · Trạng thái: chờ duyệt · Nhánh: `feat/mobile-groups` (tách từ `feat/mobile-floating-tabs`)

## Vì sao

Backend S8 (`modules/groups`, spec `2026-10-02-backend-s8-groups-design.md`) đã có nhóm, vai trò, link mời, nhưng
app mobile chưa gọi API nào trong số đó: nút "chia sẻ" của lịch trình hiện chỉ gửi một đoạn chữ. Mục tiêu của lượt
này, theo lời người dùng: **tạo nhóm và mời bạn bè bằng link trước**. Người được mời bấm link trong Zalo/Messenger và
vào được nhóm, kể cả khi chưa cài app.

## Mục tiêu

1. Tab **Nhóm** (tab thứ tư của thanh tab nổi): danh sách nhóm của tôi, tạo nhóm.
2. Màn **chi tiết nhóm**: thành viên, lịch trình của nhóm, nút **Mời bạn bè**.
3. **Link mời https** `https://www.rongthongdong.name.vn/invite/<token>`:
   - đã cài app (Android) → mở thẳng màn chấp nhận lời mời trong app;
   - chưa cài → trang web nhỏ do backend phục vụ, có nút tải APK.
4. Màn **chấp nhận lời mời** trong app.

## Không làm trong lượt này

- Danh sách địa điểm chung của nhóm (FR-10.9), nhật ký hoạt động (FR-10.5), real-time (FR-10.5/10.6), thông báo đẩy
  (FR-10.8).
- Màn quản lý / thu hồi các link mời đã tạo (FR-10.7, phần link). Link tự hết hạn sau 7 ngày (`INVITE_TTL_MS`).
- Ảnh bìa nhóm (FR-10.1): backend chưa có.
- Trang web xem lịch trình không cần app (FR-10.3) và link chia sẻ công khai `share-links`.
- iOS Universal Links: chưa có bản iOS. Trang web ghi "iPhone: chưa có bản cài đặt".

## Điều không được xảy ra

- Thanh tab nổi che nội dung (quy tắc trong `apps/mobile/CLAUDE.md`, mục "Thanh tab nổi").
- Link mời mất khi người nhận chưa đăng nhập: sau khi đăng nhập/đăng ký phải quay lại đúng màn chấp nhận lời mời.
- Trang web dự phòng chèn tên nhóm/tên người mời chưa escape (XSS): đây là nội dung người dùng đặt.
- Giao diện lệch design system của app.

## Thiết kế giao diện (đã chốt với người dùng)

Theo bộ token **Stitch** mà các màn vừa thiết kế lại đang dùng (`trips.tsx`, `account.tsx`): tiêu đề
`PlayfairDisplay_700Bold`, chữ `PlusJakartaSans_*`, màu hành động `Palette.forest900`, nền `parchment50`, thẻ trắng
viền `parchment200` bo `Radius.lg`, nhãn vai trò `terracotta100`/`terracotta700`, chấm nhấn `turmeric500`, nút viên
thuốc. Mockup: `.superpowers/brainstorm/1058-1792394536/content/` (`invite-flow-v2.html`, `groups-tab.html`,
`group-detail.html`; không commit).

### Tab Nhóm — `src/app/(app)/(tabs)/groups.tsx`

- Thêm `TabTrigger name="groups" href="/groups"` vào `(tabs)/_layout.tsx`, giữa "Chuyến đi" và "Tài khoản", nhãn
  "Nhóm". Thêm icon `group` vào `icon.tsx` (iOS `person.2`, Android/web `group`).
- `<Screen edges={['top']}>` + `FlatList` với `paddingBottom: useTabBarInset()`, kéo để tải lại (như `trips.tsx`).
- Đầu trang: tiêu đề "Nhóm", phụ đề "Cùng bạn bè lên lịch trình", nút viên thuốc "+ Tạo nhóm" (giống nút tạo của
  `trips.tsx`).
- Mỗi nhóm (`GET /groups` → `GroupSummary[]`) là một thẻ: dải trên cùng ghi vai trò của tôi ("Chủ nhóm" nền
  `forest900`, "Chỉnh sửa" nền `forest700`, "Chỉ xem" nền `charcoalMuted`), tên nhóm (Playfair), "N thành viên · M lịch
  trình". Bấm → `/group/[id]`. `GroupSummary` không có tên thành viên, nên **không** vẽ hàng ảnh đại diện như mockup
  (mockup chỉ minh họa).
- Rỗng: "Chưa có nhóm nào", một câu giới thiệu, nút "Tạo nhóm đầu tiên".
- Lỗi mạng: `Notice` + thử lại, như các màn khác.

### Tạo nhóm

Bottom sheet (BottomSheet portal hiện có, `components/ui/sheet-portal`) với một `TextField` "Tên nhóm" và nút "Tạo
nhóm". `POST /groups` `{ name }` → `GroupDetail`, đóng sheet, `router.push('/group/[id]')`. Ràng buộc độ dài tên lấy
theo DTO backend (`GroupNameDto`); lỗi hiện dưới ô nhập.

### Chi tiết nhóm — `src/app/(app)/group/[id].tsx`

Màn đẩy lên ở Stack `(app)` (che thanh tab), đăng ký trong `(app)/_layout.tsx`. Dữ liệu: `GET /groups/:id` →
`GroupDetail` (thành viên đã sắp sẵn, `itineraries: ItinerarySummary[]`, `myRole`).

- Đầu màn: nút quay lại, nút "⋯"; dòng nhãn "Bạn là chủ nhóm" / "Bạn có quyền chỉnh sửa" / "Bạn chỉ xem"; tên nhóm;
  "Tạo ngày … · N thành viên".
- **Lịch trình**: thẻ giống thẻ của `trips.tsx` (tách thành component dùng chung nếu tiện). Bấm → `/itinerary/[id]`.
  Nút "+ Thêm" (hiện với `myRole` ≠ `viewer`): action sheet/bottom sheet liệt kê lịch trình **cá nhân do tôi tạo**
  (`GET /itineraries`, lọc `myRole === 'creator' && groupId === null`); chọn → `PATCH /itineraries/:id/group`
  `{ groupId }`, rồi tải lại nhóm. Không có lịch trình nào để thêm thì sheet ghi rõ và có nút "Tạo lịch trình".
  Nhóm chưa có lịch trình: khung viền đứt "Chưa có lịch trình".
- **Thành viên**: thẻ trắng, mỗi dòng ảnh đại diện chữ cái đầu, tên (`displayName ?? 'Người dùng'`, thêm "(bạn)" cho
  chính mình), nhãn vai trò. Chủ nhóm thấy "⋯" ở từng người khác: "Cho quyền chỉnh sửa" / "Chỉ cho xem"
  (`PATCH /groups/:id/members/:userId` `{ role }`), "Xoá khỏi nhóm" (`DELETE …/members/:userId`, xác nhận trước).
- **"⋯" trên cùng**: chủ nhóm — "Đổi tên nhóm" (`PATCH /groups/:id`), "Xoá nhóm" (`DELETE /groups/:id`, xác nhận,
  xong quay về tab Nhóm); người khác — "Rời nhóm" (`DELETE /groups/:id/members/<mình>`, xác nhận, quay về tab Nhóm).
- **Nút "Mời bạn bè"**: nút chính cố định ở đáy (trong vùng an toàn), **chỉ chủ nhóm** (backend chỉ cho owner tạo
  link). Người khác thấy một dòng "Chỉ chủ nhóm gửi được lời mời." ở cuối danh sách.
- 404 (`GROUP_NOT_FOUND`, bị xoá khỏi nhóm, nhóm đã xoá): thông báo và nút về tab Nhóm.

### Sheet "Mời bạn bè"

- Chọn quyền: hai lựa chọn "Chỉ xem" (mặc định, FR-10.4) / "Chỉnh sửa", dạng segmented viên thuốc.
- Nút "Tạo link và chia sẻ": `POST /groups/:id/invites` `{ role }` → `CreatedGroupInvite`; dựng URL
  `${INVITE_BASE_URL}/invite/${token}`; mở `Share.share({ message: 'Linh mời bạn vào nhóm "…" trên Rong: <url>' })`.
  Share sheet của hệ điều hành lo Zalo/Messenger/sao chép, không tích hợp SDK riêng.
- Sau khi tạo, sheet hiện link (chọn và sao chép được) và "Hết hạn sau 7 ngày". Đổi quyền thì tạo link mới (token chỉ
  trả một lần).
- Lỗi `INVITE_LIMIT` (quá số link còn hiệu lực): hiện message của backend.

### Chấp nhận lời mời — `src/app/(app)/invite/[token].tsx`

- `GET /invites/:token` → `InvitePreview` (không cần đăng nhập). Hiện: khối chữ cái đầu tên nhóm, "«tên người mời» mời
  bạn vào nhóm", tên nhóm, "N thành viên · bạn sẽ có quyền Chỉ xem/Chỉnh sửa".
- "Tham gia nhóm": `POST /invites/:token/accept` → `GroupDetail`; `router.replace('/group/[id]')`. Đã là thành viên
  thì backend vẫn trả nhóm (chỉ nâng quyền, không hạ: `roleAfterAccept`) → cũng đi tới nhóm.
- "Để sau": về tab Nhóm.
- `INVITE_EXPIRED` / `INVITE_NOT_FOUND`: hiện message của backend và nút về trang chủ.
- `GROUP_FULL` (nhóm đủ thành viên) và giới hạn số nhóm mỗi người (cũng có thể gặp ở `POST /groups`): hiện message
  của backend, ở lại màn.

Chủ nhóm không rời nhóm được (`OWNER_CANNOT_LEAVE`), nên menu "⋯" của chủ nhóm không có "Rời nhóm".

## Link, deep link và trang web dự phòng

### URL

`INVITE_BASE_URL = https://www.rongthongdong.name.vn` (domain hiện do backend NestJS trên Render phục vụ toàn bộ).
Mobile đọc từ `EXPO_PUBLIC_API_BASE_URL` (đã là domain này) hoặc thêm `EXPO_PUBLIC_WEB_BASE_URL` — builder chọn,
nhưng không viết cứng domain trong code màn hình.

### Mobile nhận link

- `app.config.ts`, Android: `intentFilters` với `autoVerify: true`, `scheme: 'https'`,
  `host: 'www.rongthongdong.name.vn'`, `pathPrefix: '/invite/'`, category `BROWSABLE` + `DEFAULT`. Scheme `rong://`
  hiện có vẫn giữ (`rong://invite/<token>` cũng mở được, tiện thử nghiệm).
- expo-router tự ánh xạ path `/invite/<token>` vào `(app)/invite/[token]`. `+native-intent.tsx` hiện chỉ xử lý URL
  của share-intent; giữ nguyên, chỉ thêm nếu cần.
- **Chưa đăng nhập / chưa onboarding**: `Stack.Protected` ở `_layout.tsx` chặn `(app)`, link sẽ mất. Cần: khi app nhận
  một URL `/invite/<token>` lúc chưa vào được `(app)`, lưu token (bộ nhớ hoặc SecureStore qua `lib/preferences`/một
  module nhỏ), và ngay khi `signedIn` (sau đăng nhập, đăng ký + xác minh, hoặc onboarding rồi đăng nhập) điều hướng
  tới `/invite/[token]`. Cách móc vào luồng là việc của builder.

### Backend phục vụ trang và file xác minh

Trong `modules/groups` (hoặc một module nhỏ `invite-page`), ngoài prefix `api` (dùng
`setGlobalPrefix('api', { exclude: [...] })` ở `main.ts`; e2e tests tự dựng lại prefix nên cũng phải thêm `exclude`
giống vậy):

- `GET /invite/:token` (public, `@Public()`): HTML. Gọi lại logic của `InvitesService.preview`.
  - Hợp lệ: logo chữ "Rong", "Lên lịch trình du lịch cùng nhau", khối `forest900` "Lời mời từ «tên người mời»", tên nhóm,
    "N thành viên · quyền … · hết hạn dd/mm", nút **"Tải app cho Android"** →
    `https://github.com/bluez44/Rong/releases/latest` (luôn là bản APK mới nhất), dòng "Bản mới nhất trên GitHub
    Releases (.apk)", nút phụ **"Đã cài app? Mở trong app"** → `rong://invite/<token>`, dòng "iPhone: chưa có bản cài
    đặt."
  - Hết hạn / không có: cùng khung, thông báo "Link mời đã hết hạn hoặc không hợp lệ. Xin link mới từ chủ nhóm." và
    vẫn có nút tải app. HTTP 404/410 tương ứng nhưng vẫn trả HTML.
  - Thẻ `<meta property="og:title|og:description">` ("Linh mời bạn vào nhóm Đà Lạt cuối tuần" / "Mở bằng app Rong")
    để Zalo/Messenger hiện xem trước. `noindex`. Không có `og:image` trong lượt này.
  - Mọi chuỗi từ người dùng (tên nhóm, tên người mời) phải escape HTML. CSS inline; font Playfair Display + Plus
    Jakarta Sans qua Google Fonts; màu đúng token ở trên; trang hiển thị tốt trên màn hình điện thoại.
  - Template là chuỗi TypeScript trong backend (không thêm template engine).
- `GET /.well-known/assetlinks.json` (public): Digital Asset Links cho package `vn.rong.app`, fingerprint SHA-256
  từ env mới `ANDROID_APP_LINK_SHA256` (danh sách, phân tách dấu phẩy; khai báo trong `configuration.ts` và
  `.env.example`; rỗng → trả mảng rỗng). Giá trị cho APK phát hành trên GitHub Releases (workflow
  `release-apk.yml`, `eas build --profile release --local`, ký bằng keystore EAS; đọc từ chữ ký v2 của
  `rong-v1.5.0.apk` và `rong-v1.6.1.apk`, hai bản trùng nhau):
  `0F:E4:75:E1:89:95:40:90:D6:C9:77:98:B3:1E:06:C9:C7:75:D1:92:3D:E3:84:AC:DB:F9:01:71:2E:C6:DE:34`.
  Đặt nó vào env của Render. Bản debug ký bằng keystore khác: muốn App Links chạy với bản debug thì thêm fingerprint
  của nó vào danh sách. Thiếu fingerprint thì App Links không xác minh được và Android mở trang web (vẫn vào app được
  nhờ nút "Đã cài app? Mở trong app").

## Sửa kèm: màn lịch trình với người chỉ xem

`Itinerary.myRole` (`'creator' | 'owner' | 'editor' | 'viewer'`) có sẵn nhưng mobile chưa dùng: người chỉ xem mở
lịch trình của nhóm vẫn thấy chế độ sửa, và lưu sẽ bị backend từ chối. Trong lượt này:

- `myRole === 'viewer'`: ẩn mọi điều khiển sửa trong `itinerary/[id].tsx` / `itinerary-editor.tsx`, không tự lưu.
- Xoá lịch trình chỉ hiện với `creator` và `owner` (theo `groups/access.ts`).

## Kiểm thử

- Backend: e2e cho `GET /invite/:token` (hợp lệ, hết hạn, không có, escape tên chứa `<script>`), và
  `GET /.well-known/assetlinks.json` (có/không env). Unit cho hàm dựng HTML nếu tách riêng.
- Mobile: typecheck, lint, bundle Android build được. Chạy tay trên Android: tạo nhóm → mời → mở link trên máy khác
  (đã cài / chưa cài / chưa đăng nhập) → tham gia → thấy nhóm; đổi quyền, xoá thành viên, rời nhóm; người chỉ xem
  không sửa được lịch trình.

## Việc của builder

Cấu trúc hook/fetch (theo mẫu `hooks/use-itineraries.ts`), tách component dùng chung, câu chữ phụ, hiệu ứng, cách lưu
token mời chờ đăng nhập, tên module backend cho trang mời.
