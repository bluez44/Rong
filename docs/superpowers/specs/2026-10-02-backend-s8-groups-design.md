# S8 — Nhóm & chia sẻ

| | |
| --- | --- |
| Ngày | 02/10/2026 |
| Trạng thái | Đã duyệt thiết kế, chờ duyệt spec |
| Phạm vi | `apps/backend`, `packages/shared-types` |
| PRD liên quan | F10 (mục 6.10): FR-10.1–10.4, 10.7, 10.9; FR-6.8 |

## 1. Bối cảnh

Hiện mỗi lịch trình chỉ chủ sở hữu xem và sửa được: mọi truy vấn trong
`ItinerariesService` đi qua `findOwned(ownerId, id)`. Lát S8 thêm nhóm, link
mời, phân quyền và link xem lịch trình trên web, theo lộ trình đã chốt ở spec
S1 (S8 Nhóm & chia sẻ → S9 Realtime).

### 1.1 Ngoài phạm vi

| Hạng mục | PRD | Làm ở |
| --- | --- | --- |
| Đồng bộ real-time ≤ 2 giây | FR-10.5 | S9 |
| Xung đột theo từng mục lịch trình | FR-10.6 | S9 |
| Thông báo đẩy | FR-10.8 | Sau S9 |
| Ảnh bìa nhóm | FR-10.1 | Khi có nơi lưu file |
| Chuyển quyền chủ nhóm | — | Sau |
| Trang web `/t/[token]`, màn hình mobile | FR-10.2, 10.3 | Lượt sau, dùng API của lát này |

### 1.2 Sai khác có chủ ý so với PRD

- **Hai loại link.** PRD mô tả một link mời vừa để tham gia nhóm vừa để xem trên
  web. Thiết kế này tách thành *link mời nhóm* (tham gia trong app, mang vai
  trò, có hạn dùng) và *link xem lịch trình* (chỉ đọc trên web, theo từng lịch
  trình, không cần nhóm). Lịch trình cá nhân vì vậy cũng chia sẻ được lên web,
  và việc lộ một link xem không cho ai quyền vào nhóm.
- **Không có ảnh bìa nhóm** cho tới khi backend có nơi lưu file.

## 2. Các quyết định thiết kế

### 2.1 Mỗi lịch trình thuộc tối đa một nhóm

`itineraries.group_id` cho phép trống. Một nhóm có nhiều lịch trình (FR-10.1).
Lịch trình tạo trong nhóm tự thuộc nhóm (FR-6.8); lịch trình cá nhân chuyển
vào nhóm được. Quyền trên lịch trình suy ra từ vai trò trong nhóm, không có bảng
quyền riêng cho từng lịch trình.

Lịch trình vẫn thuộc người tạo (`owner_id`). Xóa nhóm thì `group_id` về trống
và lịch trình trở thành lịch trình cá nhân của người tạo, không mất dữ liệu.

Phương án nhiều-nhiều (một lịch trình ở nhiều nhóm) bị loại: cùng một lịch
trình mang vai trò khác nhau ở mỗi nhóm làm quyền khó hiểu, mà PRD không cần.

### 2.2 Kiểm tra quyền tập trung ở `AccessService`

Module `groups/` cung cấp `AccessService`:

```ts
groupRole(userId, groupId): Promise<GroupRole | null>
itineraryAccess(userId, itineraryId): Promise<ItineraryAccess | null>
// ItineraryAccess = { isCreator: boolean; groupRole: GroupRole | null }
```

`ItinerariesService` thay `findOwned` bằng
`findAccessible(userId, id, action)` với
`action ∈ 'view' | 'edit' | 'delete' | 'move'`, dựa trên hàm thuần
`can(access, action)` (bảng ở mục 4.6). Hàm thuần này là nơi duy nhất định
nghĩa quy tắc, được unit test đủ mọi ô của bảng.

Đã cân nhắc và loại:

- *Guard + decorator của Nest:* guard phải query DB rồi service query lại, quy
  tắc rải rác trên route, lệch cách code hiện tại (kiểm tra trong service).
- *Row-Level Security của Postgres:* phải đặt user vào session DB mỗi request,
  khó test, lệch xa cách làm hiện tại.

### 2.3 Token chỉ lưu bản băm

Token link mời và link xem: 32 byte ngẫu nhiên, mã hóa base64url (43 ký tự).
Database chỉ lưu SHA-256 của token, giống `one_time_tokens`. Token thô chỉ trả
về đúng một lần, trong phản hồi tạo link. Lộ database không lộ link dùng được.

Hệ quả: `GET /groups/:id/invites` không trả lại token. Muốn chia sẻ lại thì tạo
link mới.

### 2.4 Không lộ sự tồn tại

Người không có quyền xem một nhóm hoặc lịch trình nhận **404**, không phải 403.
Người có quyền xem nhưng thiếu quyền thao tác nhận **403** `FORBIDDEN_ROLE`.

## 3. Mô hình dữ liệu

Một migration mới `CreateGroups`.

### 3.1 `groups`

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| `id` | uuid PK | |
| `name` | text NOT NULL | 1–60 ký tự (kiểm tra ở DTO) |
| `owner_id` | uuid NOT NULL | → `users` ON DELETE CASCADE |
| `created_at`, `updated_at` | timestamptz | |

### 3.2 `group_members`

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| `group_id` | uuid | → `groups` ON DELETE CASCADE |
| `user_id` | uuid | → `users` ON DELETE CASCADE |
| `role` | text | CHECK `owner`, `editor`, `viewer` |
| `joined_at` | timestamptz | |

PK `(group_id, user_id)`. Index `(user_id)`. Chủ nhóm cũng là một dòng
`role = 'owner'`, để "nhóm tôi tham gia" là một truy vấn duy nhất.

### 3.3 `group_invites`

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| `id` | uuid PK | |
| `group_id` | uuid | → `groups` ON DELETE CASCADE |
| `token_hash` | text UNIQUE | SHA-256 hex |
| `role` | text | CHECK `editor`, `viewer` |
| `created_by` | uuid NULL | → `users` ON DELETE SET NULL |
| `expires_at` | timestamptz | mặc định now + 7 ngày |
| `revoked_at` | timestamptz NULL | |
| `created_at` | timestamptz | |

### 3.4 `itinerary_share_links`

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| `id` | uuid PK | |
| `itinerary_id` | uuid | → `itineraries` ON DELETE CASCADE |
| `token_hash` | text UNIQUE | |
| `created_by` | uuid NULL | → `users` ON DELETE SET NULL |
| `revoked_at` | timestamptz NULL | |
| `created_at` | timestamptz | |

Partial unique index `(itinerary_id) WHERE revoked_at IS NULL`: mỗi lịch trình
có tối đa một link còn hiệu lực. Link xem không hết hạn; chỉ thu hồi.

### 3.5 `group_places` (FR-10.9)

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| `group_id` | uuid | → `groups` ON DELETE CASCADE |
| `place_id` | uuid | → `places` ON DELETE CASCADE |
| `region_id` | uuid | → `regions` ON DELETE CASCADE |
| `added_by` | uuid NULL | → `users` ON DELETE SET NULL |
| `created_at` | timestamptz | |

PK `(group_id, place_id)`. Tối đa 200 địa điểm mỗi nhóm.

### 3.6 `group_activities`

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| `id` | uuid PK | |
| `group_id` | uuid | → `groups` ON DELETE CASCADE |
| `actor_id` | uuid NULL | → `users` ON DELETE SET NULL |
| `type` | text | xem mục 5 |
| `payload` | jsonb | tên tại thời điểm xảy ra |
| `created_at` | timestamptz | |

Index `(group_id, created_at DESC, id DESC)`.

### 3.7 `itineraries`

Thêm `group_id uuid NULL → groups ON DELETE SET NULL`, index `(group_id)`.

## 4. API

Mọi route cần access token, trừ route ghi **[công khai]** (dùng `@Public()`).
Lỗi theo dạng `{ code, message }` hiện có.

### 4.1 Nhóm

| Route | Quyền | Mô tả |
| --- | --- | --- |
| `POST /groups` `{name}` | đăng nhập | Tạo nhóm, người tạo là owner. Tối đa 20 nhóm mỗi người (`GROUP_LIMIT`) |
| `GET /groups` | đăng nhập | Nhóm tôi tham gia: `id, name, myRole, memberCount, itineraryCount, createdAt` |
| `GET /groups/:id` | viewer+ | Nhóm, thành viên (`userId, displayName, role, joinedAt`), lịch trình (dạng `ItinerarySummary`) |
| `PATCH /groups/:id` `{name}` | owner | Đổi tên |
| `DELETE /groups/:id` | owner | Xóa nhóm; lịch trình trở thành cá nhân |
| `PATCH /groups/:id/members/:userId` `{role}` | owner | `role ∈ editor, viewer`; không đổi được vai trò owner |
| `DELETE /groups/:id/members/:userId` | owner, hoặc chính mình | Xóa thành viên / tự rời. Owner không tự rời được (`OWNER_CANNOT_LEAVE`) |
| `GET /groups/:id/activity?cursor=` | viewer+ | 20 mục mỗi trang, mới nhất trước, phân trang con trỏ |

Thành viên không lộ email, chỉ `displayName`.

### 4.2 Link mời nhóm

| Route | Quyền | Mô tả |
| --- | --- | --- |
| `POST /groups/:id/invites` `{role}` | owner | Trả `{id, token, role, expiresAt}`. Tối đa 10 link còn hiệu lực (`INVITE_LIMIT`) |
| `GET /groups/:id/invites` | owner | Link còn hiệu lực, không kèm token |
| `DELETE /groups/:id/invites/:inviteId` | owner | Thu hồi (FR-10.7) |
| `GET /invites/:token` | **[công khai]** | Xem trước: `groupName, inviterName, role, memberCount, expiresAt` |
| `POST /invites/:token/accept` | đăng nhập | Tham gia, trả `GroupDetail` |

Quy tắc khi chấp nhận:

- Token không tồn tại → 404 `INVITE_NOT_FOUND`.
- Hết hạn hoặc đã thu hồi → 410 `INVITE_EXPIRED`.
- Đã là thành viên: giữ vai trò hiện tại; nâng lên nếu link cho vai trò cao hơn;
  không bao giờ hạ. Owner giữ owner.
- Nhóm đã đủ 50 thành viên → 409 `GROUP_FULL`.
- Ghi `member_joined` (hoặc `role_changed` khi được nâng).

### 4.3 Lịch trình trong nhóm

- `POST /itineraries` thêm trường tùy chọn `groupId`. Người tạo phải là owner
  hoặc editor của nhóm; nếu không thì 404 (không thấy nhóm) hoặc 403
  `FORBIDDEN_ROLE` (là viewer). Ghi `itinerary_added`.
- `PATCH /itineraries/:id/group` `{groupId: string | null}`: chỉ người tạo lịch
  trình; nếu chuyển vào nhóm thì phải là editor trở lên của nhóm đích. Ghi
  `itinerary_removed` ở nhóm cũ và `itinerary_added` ở nhóm mới.
- `GET /itineraries`: lịch trình tôi tạo **và** lịch trình thuộc nhóm tôi tham
  gia. `ItinerarySummary` thêm `groupId`, `groupName`, `myRole`
  (`'creator' | GroupRole`).
- `Itinerary` (chi tiết) thêm `groupId`, `groupName`, `myRole`.
- `GET /itineraries/:id`, `GET /itineraries/:id/alternatives`: quyền `view`.
- `PUT /itineraries/:id`: quyền `edit`. Ghi `itinerary_updated` nếu thuộc nhóm.
- `DELETE /itineraries/:id`: quyền `delete`. Ghi `itinerary_removed` nếu thuộc nhóm.

### 4.4 Link xem lịch trình trên web

| Route | Quyền | Mô tả |
| --- | --- | --- |
| `POST /itineraries/:id/share-link` | `edit` | Thu hồi link cũ (nếu có), tạo link mới, trả `{token, createdAt}` |
| `DELETE /itineraries/:id/share-link` | `edit` | Thu hồi; không có link thì vẫn 204 |
| `GET /public/itineraries/:token` | **[công khai]** | `PublicItinerary`; token sai hoặc đã thu hồi → 404 `SHARE_LINK_NOT_FOUND` |

`PublicItinerary` gồm: tên vùng, thời gian bắt đầu/kết thúc, đối tượng, số
người, các ngày và mục (giờ, thời lượng, lý do, nhãn AI gợi ý), địa điểm của
mỗi mục (`id, name, category, lat, lng`), danh sách "Chưa xếp", cảnh báo.
**Không** gồm: id hay email người dùng, `aiEditsRemaining`, `notes` của người
dùng, `groupId`, bất kỳ nội dung Google nào (PRD 7.4 — trang web tự gọi Google
qua Maps JavaScript API nếu cần).

### 4.5 Địa điểm chung của nhóm (FR-10.9)

| Route | Quyền | Mô tả |
| --- | --- | --- |
| `GET /groups/:id/places` | viewer+ | Cùng dạng `SavedPlace` của "Muốn đi", kèm `addedByName` |
| `PUT /groups/:id/places/:placeId` `{regionId}` | editor+ | Thêm; đã có thì 204 không đổi. Ghi `place_added` |
| `DELETE /groups/:id/places/:placeId` | editor+ | Xóa. Ghi `place_removed` |

### 4.6 Bảng quyền trên lịch trình

| Thao tác (`action`) | Người tạo | Owner nhóm | Editor | Viewer | Không liên quan |
| --- | --- | --- | --- | --- | --- |
| `view` | ✓ | ✓ | ✓ | ✓ | 404 |
| `edit` (sửa, link xem) | ✓ | ✓ | ✓ | 403 | 404 |
| `delete` | ✓ | ✓ | 403 | 403 | 404 |
| `move` (chuyển nhóm) | ✓ | 403 | 403 | 403 | 404 |

Người tạo đã bị xóa khỏi nhóm vẫn có toàn quyền trên lịch trình mình tạo (vì là
người tạo), và lịch trình vẫn nằm trong nhóm.

### 4.7 Giới hạn

| Giới hạn | Giá trị | Mã lỗi |
| --- | --- | --- |
| Nhóm mỗi người (tham gia + sở hữu) | 20 | 409 `GROUP_LIMIT` |
| Thành viên mỗi nhóm | 50 | 409 `GROUP_FULL` |
| Link mời còn hiệu lực mỗi nhóm | 10 | 409 `INVITE_LIMIT` |
| Địa điểm chung mỗi nhóm | 200 | 409 `GROUP_PLACES_LIMIT` |

## 5. Nhật ký hoạt động

Ghi trong cùng transaction với thao tác gây ra nó, qua
`ActivityService.record(manager, groupId, actorId, type, payload)`.

| `type` | `payload` |
| --- | --- |
| `member_joined` | `{userName, role}` |
| `member_left` | `{userName}` |
| `member_removed` | `{userName}` |
| `role_changed` | `{userName, from, to}` |
| `group_renamed` | `{from, to}` |
| `itinerary_added` | `{itineraryId, regionName}` |
| `itinerary_removed` | `{itineraryId, regionName}` |
| `itinerary_updated` | `{itineraryId, regionName}` |
| `place_added` | `{placeId, placeName}` |
| `place_removed` | `{placeId, placeName}` |

`payload` lưu tên tại thời điểm xảy ra, để nhật ký vẫn đọc được sau khi dữ liệu
gốc bị xóa hoặc đổi tên.

**Gộp `itinerary_updated`:** client tự lưu liên tục (FR-8.9). Nếu dòng mới nhất
của nhóm là `itinerary_updated` cùng `actor_id`, cùng `itineraryId` và cách đây
dưới 10 phút thì cập nhật `created_at` của dòng đó thay vì chèn dòng mới.

Phản hồi `GET /groups/:id/activity` trả `actorName` (null khi tài khoản đã xóa;
client hiển thị "Người dùng đã xóa").

## 6. Xóa tài khoản

Dựa hoàn toàn vào ràng buộc khóa ngoại, `UsersService.deleteAccount` không đổi:

- Nhóm người đó làm owner bị xóa (`groups.owner_id` CASCADE) → thành viên, link
  mời, địa điểm chung, nhật ký của nhóm bị xóa theo; lịch trình của người khác
  trong nhóm có `group_id` về trống.
- Tư cách thành viên ở nhóm khác bị xóa (`group_members.user_id` CASCADE).
- Lịch trình người đó tạo bị xóa như hiện tại (`itineraries.owner_id` CASCADE),
  kể cả khi nằm trong nhóm; link xem của chúng bị xóa theo.
- `group_activities.actor_id`, `group_invites.created_by`,
  `group_places.added_by`, `itinerary_share_links.created_by` về trống.

## 7. Xung đột khi cùng sửa

S8 giữ cơ chế hiện có: `PUT /itineraries/:id` thay toàn bộ, ai lưu sau thắng,
lỗi `DAYS_MISMATCH` khi số ngày lệch. Xung đột theo từng mục và thông báo cho
người bị ghi đè (FR-10.6) thuộc S9.

## 8. Cấu trúc code

```
modules/groups/
  groups.module.ts
  access.ts                     can(access, action) — hàm thuần
  access.service.ts             groupRole, itineraryAccess
  tokens.ts                     tạo token, băm
  activity.service.ts
  groups.controller.ts          /groups, /groups/:id/members, /activity, /places
  groups.service.ts
  invites.controller.ts         /groups/:id/invites, /invites/:token
  invites.service.ts
  dto/…
  entities/group.entity.ts, group-member.entity.ts, group-invite.entity.ts,
           group-place.entity.ts, group-activity.entity.ts
modules/itineraries/
  share-links.controller.ts     /itineraries/:id/share-link, /public/itineraries/:token
  share-links.service.ts
  entities/itinerary-share-link.entity.ts
```

`ItinerariesModule` import `GroupsModule` (để dùng `AccessService`,
`ActivityService`). `GroupsModule` không import `ItinerariesModule`; khi cần
danh sách lịch trình của nhóm, `GroupsService` truy vấn SQL trực tiếp như
`ItinerariesService.list` đang làm, tránh phụ thuộc vòng.

Kiểu dùng chung đặt trong `packages/shared-types/src/group.ts` (thay các kiểu
hiện có, bỏ `coverImageUrl`) và `itinerary.ts` (`PublicItinerary`, các trường
mới của `Itinerary`/`ItinerarySummary`).

## 9. Kiểm thử

**Unit**

- `access.spec.ts`: mọi ô của bảng 4.6.
- `tokens.spec.ts`: token đủ độ dài, base64url, băm ổn định, hai token khác nhau.
- `invites.service.spec.ts`: hết hạn, đã thu hồi, đã là thành viên (giữ/nâng,
  không hạ), nhóm đầy.
- `activity.service.spec.ts`: gộp `itinerary_updated` trong 10 phút, không gộp
  khi khác người, khác lịch trình hoặc quá 10 phút.

**E2E** — `test/groups.e2e-spec.ts`

1. A tạo nhóm, tạo lịch trình trong nhóm.
2. A tạo link mời viewer; B xem trước (không đăng nhập) rồi chấp nhận.
3. B xem được lịch trình; B sửa → 403; B thấy lịch trình trong `GET /itineraries`.
4. A nâng B lên editor; B sửa được; nhật ký có `member_joined`, `role_changed`,
   `itinerary_updated`.
5. C (không liên quan) `GET` lịch trình → 404.
6. B tạo link xem; `GET /public/itineraries/:token` không đăng nhập trả dữ liệu,
   không có email hay id người dùng; thu hồi xong → 404.
7. A thu hồi link mời; C chấp nhận → 410.
8. B tạo lịch trình trong nhóm; A xóa tài khoản → nhóm biến mất, lịch trình của B
   còn và `groupId = null`.

Chạy lại `test/itinerary.e2e-spec.ts`, `test/saved-places.e2e-spec.ts`,
`test/account.e2e-spec.ts` để chắc việc thay `findOwned` không làm hỏng luồng cũ.
