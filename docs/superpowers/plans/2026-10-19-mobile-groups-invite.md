# Mobile groups + https invite links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tab "Nhóm", màn chi tiết nhóm, mời bạn bè bằng link `https://www.rongthongdong.name.vn/invite/<token>` (mở app qua Android App Links hoặc trang web dự phòng có nút tải APK), màn chấp nhận lời mời, và chặn sửa lịch trình với người chỉ xem.

**Architecture:** Backend thêm hai route ngoài prefix `api` trong `modules/groups`: trang HTML `/invite/:token` (dựng bằng hàm thuần, dùng lại `InvitesService.preview`) và `/.well-known/assetlinks.json`. Mobile gọi các API S8 có sẵn qua `authFetch`; link mời đi qua `+native-intent.tsx`, được giữ trong một store nhỏ (SecureStore) cho tới khi người dùng đăng nhập rồi mới mở màn chấp nhận.

**Tech Stack:** NestJS 12 + vitest (backend), Expo 57 / expo-router / React Native 0.86 (mobile, không có test runner: kiểm bằng `tsc`, `eslint`, `expo export`).

**Spec:** `docs/superpowers/specs/2026-10-19-mobile-groups-invite-design.md`

## Global Constraints

- Nhánh `feat/mobile-groups` (đã có thanh tab nổi từ `feat/mobile-floating-tabs`).
- Comment, log, chữ trên giao diện, message lỗi: tiếng Việt. Backend ESM: import tương đối kết thúc `.js`.
- Giao diện theo token Stitch như `trips.tsx`: tiêu đề `PlayfairDisplay_700Bold`, chữ `PlusJakartaSans_*`, hành động `Palette.forest900`, nền `Palette.parchment50`, thẻ `#FFFFFF` viền `Palette.parchment200` bo `Radius.lg`, nhãn `terracotta100`/`terracotta700`, chấm `turmeric500`, nút viên thuốc.
- Màn tab tuân `apps/mobile/CLAUDE.md` mục "Thanh tab nổi" (`useTabBarInset()`); màn mới bọc `<Screen>`; bottom sheet dùng `BottomSheet`/`ActionSheet` trong `components/ui` (vẽ qua `SheetHost`).
- Domain link mời: `https://www.rongthongdong.name.vn`; nút tải: `https://github.com/bluez44/Rong/releases/latest`; package `vn.rong.app`.
- Fingerprint APK release: `0F:E4:75:E1:89:95:40:90:D6:C9:77:98:B3:1E:06:C9:C7:75:D1:92:3D:E3:84:AC:DB:F9:01:71:2E:C6:DE:34` (đặt vào env `ANDROID_APP_LINK_SHA256` trên Render, không viết cứng trong code).
- Typed routes: sau khi thêm file route, sinh lại `.expo/types/router.d.ts` bằng `cd apps/mobile && CI=1 timeout 90 npx expo start --offline` (để nó tự dừng) trước khi chạy `tsc`; `expo export` không sinh lại file này.
- Mobile hiện nguyên `message` lỗi của backend (`ApiError.message`) cho `GROUP_FULL`, giới hạn nhóm, `INVITE_EXPIRED`, `INVITE_NOT_FOUND`, `INVITE_LIMIT`, `OWNER_CANNOT_LEAVE`.

## Review Focus

1. Tên nhóm / tên người mời chứa HTML (`<script>`, `"`, `&`) trên trang `/invite/:token` → hiện nguyên văn, không chạy. Test: Task 1 `escapes user text`, Task 2 e2e `escapes group name`.
2. Bấm link mời khi chưa đăng nhập, đăng ký + xác minh email (app có thể bị tắt giữa chừng) → sau khi vào được `(app)` thì mở đúng màn chấp nhận lời mời. Task 5 lưu token vào SecureStore; kiểm tay ở Task 7.
3. Người đã là thành viên bấm lại link (kể cả link quyền thấp hơn) → vào thẳng nhóm, không lỗi, không bị hạ quyền. Backend đã đúng (`roleAfterAccept`); Task 5 xử lý `accept` trả `GroupDetail` như tham gia mới.
4. Link hết hạn / bị thu hồi / token rác (`/invite/abc`) → trang web vẫn là HTML có nút tải app (410/404), app hiện message backend. Task 2 e2e ba ca; Task 5 màn lỗi.
5. Người chỉ xem mở lịch trình của nhóm → không có nút "Sửa", không vào chế độ sửa kể cả với `?edit=1`, không có "Xóa lịch trình". Task 6.

---

### Task 1: Hàm dựng trang mời (backend, thuần)

**Files:**
- Create: `apps/backend/src/modules/groups/invite-page.ts`
- Test: `apps/backend/src/modules/groups/invite-page.spec.ts`

**Interfaces:**
- Produces:
  - `export const APK_DOWNLOAD_URL = 'https://github.com/bluez44/Rong/releases/latest'`
  - `export function escapeHtml(text: string): string` — thay `& < > " '`.
  - `export type InvitePageView = { kind: 'ok'; token: string; preview: InvitePreview } | { kind: 'invalid' }` (`InvitePreview` từ `@rong/shared-types`).
  - `export function renderInvitePage(view: InvitePageView): string` — một tài liệu HTML đầy đủ.
  - `export function assetLinks(fingerprints: string[]): object[]` — `[]` khi rỗng, ngược lại một phần tử `{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'vn.rong.app', sha256_cert_fingerprints: fingerprints } }`.

- [ ] **Step 1: Viết test**

```ts
const preview: InvitePreview = { groupName: 'Đà Lạt cuối tuần', inviterName: 'Linh', role: 'viewer', memberCount: 3, expiresAt: '2026-10-26T05:00:00.000Z' };
it('trang hợp lệ có tên nhóm, người mời, quyền, hạn, nút tải và mở app', () => {
  const html = renderInvitePage({ kind: 'ok', token: 'tok123', preview });
  expect(html).toMatch(/^<!doctype html>/i);
  expect(html).toContain('Đà Lạt cuối tuần');
  expect(html).toContain('Lời mời từ Linh');
  expect(html).toContain('3 thành viên · quyền Chỉ xem · hết hạn 26/10');
  expect(html).toContain(`href="${APK_DOWNLOAD_URL}"`);
  expect(html).toContain('href="rong://invite/tok123"');
  expect(html).toContain('<meta property="og:title" content="Linh mời bạn vào nhóm Đà Lạt cuối tuần"');
  expect(html).toContain('<meta name="robots" content="noindex"');
  expect(html).toContain('iPhone: chưa có bản cài đặt.');
});
it('escapes user text', () => {
  const html = renderInvitePage({ kind: 'ok', token: 't', preview: { ...preview, groupName: '<script>alert(1)</script>', inviterName: 'A & "B"' } });
  expect(html).not.toContain('<script>alert');
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).toContain('A &amp; &quot;B&quot;');
});
it('quyền chỉnh sửa và người mời không tên', () => {
  const html = renderInvitePage({ kind: 'ok', token: 't', preview: { ...preview, role: 'editor', inviterName: null } });
  expect(html).toContain('quyền Chỉnh sửa');
  expect(html).toContain('Lời mời vào nhóm');
});
it('link không dùng được vẫn có nút tải app, không có nút mở app', () => {
  const html = renderInvitePage({ kind: 'invalid' });
  expect(html).toContain('Link mời đã hết hạn hoặc không hợp lệ. Xin link mới từ chủ nhóm.');
  expect(html).toContain(`href="${APK_DOWNLOAD_URL}"`);
  expect(html).not.toContain('rong://invite/');
});
it('assetLinks', () => {
  expect(assetLinks([])).toEqual([]);
  expect(assetLinks(['AA:BB'])[0]).toMatchObject({ target: { package_name: 'vn.rong.app', sha256_cert_fingerprints: ['AA:BB'] } });
});
```

- [ ] **Step 2: Chạy, thấy fail** — `cd apps/backend && npx vitest run src/modules/groups/invite-page.spec.ts` → FAIL (module không có).

- [ ] **Step 3: Viết `invite-page.ts`.** Template literal, CSS inline trong `<style>`, Google Fonts `Playfair Display:wght@700` + `Plus Jakarta Sans:wght@400;600;700`, `<meta name="viewport" content="width=device-width, initial-scale=1">`, `lang="vi"`. Bố cục và chữ theo mockup `invite-flow-v2.html` (màn ②): chữ "Rong", "Lên lịch trình du lịch cùng nhau", khối `#083C29` với dải "Lời mời từ …" (người mời null → "Lời mời vào nhóm"), tên nhóm, dòng meta; nút chính "Tải app cho Android", ghi chú "Bản mới nhất trên GitHub Releases (.apk)", nút phụ "Đã cài app? Mở trong app" (`rong://invite/${encodeURIComponent(token)}`), "iPhone: chưa có bản cài đặt.". Ngày hạn `dd/mm` theo `Asia/Ho_Chi_Minh` (`Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })`). `og:description` = "Mở bằng app Rong để cùng xem lịch trình". Trang `invalid`: `<title>` và `og:title` "Lời mời Rong", không có khối nhóm.

- [ ] **Step 4: Chạy lại** → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(backend): render the invite fallback page"`

### Task 2: Route `/invite/:token` và `/.well-known/assetlinks.json`

**Files:**
- Create: `apps/backend/src/global-prefix.ts`, `apps/backend/src/modules/groups/invite-page.controller.ts`, `apps/backend/test/invite-page.e2e-spec.ts`
- Modify: `apps/backend/src/main.ts`, `apps/backend/src/config/configuration.ts`, `apps/backend/.env.example`, `apps/backend/src/modules/groups/groups.module.ts`, `apps/backend/src/modules/README.md`, `CLAUDE.md` (mục "Open today")

**Interfaces:**
- Consumes: Task 1 `renderInvitePage`, `assetLinks`; `InvitesService.preview(token): Promise<InvitePreview>` (ném `NotFoundException` 404 / `GoneException` 410).
- Produces:
  - `src/global-prefix.ts`: `export const API_PREFIX = 'api'`; `export const API_PREFIX_OPTIONS = { exclude: ['invite/:token', '.well-known/assetlinks.json'] }` — `main.ts` gọi `app.setGlobalPrefix(API_PREFIX, API_PREFIX_OPTIONS)`; e2e của task này cũng vậy.
  - Config: `export interface InviteLinksConfig { androidSha256: string[] }`, `AppConfig.inviteLinks`, đọc `ANDROID_APP_LINK_SHA256` (tách dấu phẩy, trim, bỏ rỗng). Provider `INVITE_LINKS_CONFIG` trong `GroupsModule` theo mẫu `WEB_PLACES_CONFIG` ở `places.module.ts`.
  - `InvitePageController` (`@Controller()`, `@Public()` cả lớp): `GET invite/:token` trả HTML (`@Res()` Express, `Content-Type: text/html; charset=utf-8`, `Cache-Control: no-store`); `HttpException` 404/410 từ `preview` → `renderInvitePage({ kind: 'invalid' })` với đúng status đó; lỗi khác ném tiếp. `GET .well-known/assetlinks.json` → JSON `assetLinks(config.androidSha256)`.

- [ ] **Step 1: Viết e2e** `test/invite-page.e2e-spec.ts`: đặt `process.env.ANDROID_APP_LINK_SHA256 = 'AA:BB, CC:DD'` trước khi compile; `beforeAll` chép từ `groups.e2e-spec.ts` nhưng prefix bằng `API_PREFIX, API_PREFIX_OPTIONS`; tạo user `e2e-invite-page-owner`, `POST /api/groups` `{ name: 'Đà <b>Lạt</b>' }`, `POST /api/groups/:id/invites` lấy `token`. Ca:
  - `GET /invite/<token>` (không auth) → 200, `content-type` chứa `text/html`, body chứa `Đà &lt;b&gt;Lạt&lt;/b&gt;` (**escapes group name**) và `rong://invite/<token>`.
  - `GET /invite/khong-phai-token` → 404, HTML, chứa "Link mời đã hết hạn hoặc không hợp lệ".
  - thu hồi (`DELETE /api/groups/:id/invites/:inviteId`) rồi `GET /invite/<token>` → 410, HTML.
  - `GET /.well-known/assetlinks.json` → 200, `body[0].target.sha256_cert_fingerprints` = `['AA:BB', 'CC:DD']`.
  - `GET /api/invite/<token>` → 404 (route không nằm dưới `api`).
  - `afterAll` xoá user `e2e-invite-page-%` (cascade xoá nhóm).

- [ ] **Step 2: Chạy, thấy fail** — `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/invite-page.e2e-spec.ts` → FAIL (404 ở mọi ca HTML).

- [ ] **Step 3: Cài đặt** config + `.env.example` (`ANDROID_APP_LINK_SHA256=` kèm comment: fingerprint SHA-256 chứng chỉ ký APK, nhiều giá trị cách nhau dấu phẩy), `global-prefix.ts`, `main.ts`, controller, đăng ký controller + provider trong `GroupsModule`.

- [ ] **Step 4: Chạy e2e của task và `groups.e2e-spec.ts`** → PASS cả hai; `pnpm lint`, `pnpm typecheck` sạch.

- [ ] **Step 5: Tài liệu** — `src/modules/README.md` mục groups: hai route mới, env, lý do đứng ngoài `api`; `CLAUDE.md` gốc dòng "Open today" thêm `invite/:token` (trang HTML) và `.well-known/assetlinks.json`.

- [ ] **Step 6: Commit** — `git commit -m "feat(backend): serve invite page and Android asset links outside /api"`

### Task 3: Nền mobile cho nhóm (hook, nhãn, link)

**Files:**
- Modify: `apps/mobile/src/hooks/use-itineraries.ts` (export `useResource`), `apps/mobile/src/components/ui/icon.tsx`
- Create: `apps/mobile/src/hooks/use-groups.ts`, `apps/mobile/src/constants/groups.ts`, `apps/mobile/src/lib/invite-link.ts`

**Interfaces:**
- Produces:
  - `useResource<T>(path: string)` (export, không đổi hành vi).
  - `useGroups()` → `useResource<GroupSummary[]>('/groups')`; `useGroup(id: string)` → `useResource<GroupDetail>(`/groups/${id}`)`.
  - `ROLE_LABELS: Record<GroupRole, string>` = `{ owner: 'Chủ nhóm', editor: 'Chỉnh sửa', viewer: 'Chỉ xem' }`; `MY_ROLE_LINES: Record<GroupRole, string>` = `{ owner: 'Bạn là chủ nhóm', editor: 'Bạn có quyền chỉnh sửa', viewer: 'Bạn chỉ xem' }`; `initials(name: string | null): string` (tối đa 2 chữ cái đầu, viết hoa; null → "?").
  - `inviteUrl(token: string): string` = `${EXPO_PUBLIC_API_BASE_URL bỏ "/" cuối}/invite/${token}`; `inviteTokenFromPath(path: string): string | null` nhận cả `/invite/<t>`, `rong://invite/<t>`, `https://…/invite/<t>` (bỏ query/hash), trả null nếu không khớp.
  - Icon mới: `group: { ios: 'person.2', android: 'group', web: 'group' }`, `link: { ios: 'link', android: 'link', web: 'link' }`, `logout: { ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' }`.

- [ ] **Step 1: Cài đặt** các file trên (đọc base URL qua `process.env.EXPO_PUBLIC_API_BASE_URL` như `lib/api.ts`).
- [ ] **Step 2: Kiểm** — `cd apps/mobile && npx tsc --noEmit` sạch; `npx eslint` các file đổi sạch.
- [ ] **Step 3: Commit** — `git commit -m "feat(mobile): add group hooks, role labels and invite link helpers"`

### Task 4: Tab Nhóm, tạo nhóm, chi tiết nhóm, sheet mời

Các route này trỏ qua lại (`/groups` ↔ `/group/[id]`), nên làm chung một task để typed routes luôn khớp.

**Files:**
- Create: `apps/mobile/src/app/(app)/(tabs)/groups.tsx`, `apps/mobile/src/app/(app)/group/[id].tsx`, `apps/mobile/src/components/create-group-sheet.tsx`, `apps/mobile/src/components/add-itinerary-sheet.tsx`, `apps/mobile/src/components/invite-sheet.tsx`
- Modify: `apps/mobile/src/app/(app)/(tabs)/_layout.tsx`, `apps/mobile/src/app/(app)/_layout.tsx` (`<Stack.Screen name="group/[id]" />`)

**Interfaces:**
- Consumes: Task 3 `useGroups`, `useGroup`, `useItineraries`, `ROLE_LABELS`, `MY_ROLE_LINES`, `initials`, `inviteUrl`; `useTabBarInset` (`components/floating-tab-bar`).
- Produces (Task 5 dùng route `/group/[id]` và `/groups`):
  - `CreateGroupSheet({ visible, onClose }: { visible: boolean; onClose: () => void })` — tạo xong: `onClose()`, `router.push({ pathname: '/group/[id]', params: { id } })`.
  - `AddItinerarySheet({ groupId, visible, onClose, onAdded }: { groupId: string; visible: boolean; onClose: () => void; onAdded: () => void })`.
  - `InviteSheet({ groupId, groupName, visible, onClose }: { groupId: string; groupName: string; visible: boolean; onClose: () => void })`.

- [ ] **Step 1: Tab.** Thêm `<TabTrigger name="groups" href="/groups" asChild><TabButton label="Nhóm" icon="group" /></TabTrigger>` giữa "Chuyến đi" và "Tài khoản"; sửa comment "Ba tab" → "Bốn tab".
- [ ] **Step 2: Màn `groups.tsx`** theo mockup `groups-tab.html` và spec mục "Tab Nhóm": `FlatList` + `RefreshControl`, `paddingBottom: useTabBarInset()`, tải lại khi focus (`useFocusEffect`, như `trips.tsx`), thẻ nhóm với dải vai trò (owner `forest900`, editor `forest700`, viewer `charcoalMuted`), "N thành viên · M lịch trình" (M = 0 → "chưa có lịch trình"), rỗng ("Chưa có nhóm nào" + "Tạo nhóm đầu tiên"), lỗi (`Notice` + "Thử lại"). Không vẽ hàng ảnh đại diện.
- [ ] **Step 3: `CreateGroupSheet`**: `BottomSheet`, `TextField` "Tên nhóm" (`maxLength={60}`), nút "Tạo nhóm" (`loading` khi gửi, tắt khi tên trống sau trim), `POST /groups` `{ name }`; lỗi → chữ dưới ô nhập bằng `ApiError.message`.
- [ ] **Step 4: Màn `group/[id].tsx`** theo mockup `group-detail.html` và spec mục "Chi tiết nhóm": nút quay lại + "⋯" (kính tròn như `itinerary/[id].tsx`), dòng `MY_ROLE_LINES[myRole]`, tên nhóm, "Tạo ngày dd/mm · N thành viên"; khối "Lịch trình" (thẻ như `trips.tsx`, bấm → `/itinerary/[id]`; "+ Thêm" khi `myRole !== 'viewer'`; trống → khung viền đứt "Chưa có lịch trình"); khối "Thành viên" (`initials`, `displayName ?? 'Người dùng'`, "(bạn)" khi `userId === session.user.id`, nhãn vai trò; owner có "⋯" ở người khác). Nút "Mời bạn bè" cố định đáy (`insets.bottom + Spacing.four`), chỉ owner, mở `InviteSheet`; người khác thấy "Chỉ chủ nhóm gửi được lời mời." cuối danh sách. Nội dung cuộn chừa chiều cao nút. 404 khi tải → `Notice` "Không tìm thấy nhóm này." + nút "Về danh sách nhóm" (`router.replace('/groups')`).
- [ ] **Step 5: Hành động** (`ActionSheet`; xác nhận xoá/rời bằng `Alert.alert`; thành công → `reload()`; lỗi → `Alert.alert` với `ApiError.message`):
  - thành viên (owner): "Cho quyền chỉnh sửa" / "Chỉ cho xem" (ẩn cái đang có) → `PATCH /groups/:id/members/:userId` `{ role }`; "Xoá khỏi nhóm" (destructive) → `DELETE …/members/:userId`.
  - "⋯" trên: owner "Đổi tên nhóm" (`ActionSheet` với `children` là `TextField` + nút Lưu → `PATCH /groups/:id` `{ name }`), "Xoá nhóm" → `DELETE /groups/:id` rồi `router.replace('/groups')`; editor/viewer "Rời nhóm" → `DELETE /groups/:id/members/<mình>` rồi `router.replace('/groups')`.
- [ ] **Step 6: `AddItinerarySheet`**: `useItineraries()`, lọc `myRole === 'creator' && groupId === null`; mỗi dòng (điểm đến + `formatDateRange` từ `lib/trip-format`) bấm → `PATCH /itineraries/:id/group` `{ groupId }` → `onAdded()`, `onClose()`. Rỗng: "Bạn chưa có lịch trình cá nhân nào để thêm." + nút "Tạo lịch trình" → `router.push('/itinerary/new')`.
- [ ] **Step 7: `InviteSheet`** theo mockup `invite-flow-v2.html` (màn ①): segmented "Chỉ xem" (mặc định) / "Chỉnh sửa"; nút "Tạo link và chia sẻ" → `POST /groups/:id/invites` `{ role }` → `Share.share({ message })` với message `«tên mình ?? 'Mình'» mời bạn vào nhóm "«groupName»" trên Rong: «inviteUrl(token)»`; sau đó hiện link (`Text selectable`) và "Hết hạn sau 7 ngày"; đổi quyền thì xoá link đang hiện. Lỗi (`INVITE_LIMIT`…) → `Notice` với `ApiError.message`.
- [ ] **Step 8: Kiểm** — sinh lại typed routes, `npx tsc --noEmit` sạch, eslint các file đổi sạch, `npx expo export --platform android --output-dir <scratch>` thành công.
- [ ] **Step 9: Commit** — `git commit -m "feat(mobile): add Groups tab, group detail and invite sheet"`

### Task 5: Nhận link mời và chấp nhận lời mời

**Files:**
- Create: `apps/mobile/src/app/(app)/invite/[token].tsx`, `apps/mobile/src/lib/pending-invite.ts`
- Modify: `apps/mobile/src/app/+native-intent.tsx`, `apps/mobile/src/app/(app)/_layout.tsx` (`<Stack.Screen name="invite/[token]" />` + hook), `apps/mobile/app.config.ts`

**Interfaces:**
- Consumes: Task 3 `inviteTokenFromPath`, `ROLE_LABELS`, `initials`; route `/group/[id]`, `/groups` (Task 4).
- Produces: `lib/pending-invite.ts`: `setPendingInvite(token: string): void` (lưu bộ nhớ + `expo-secure-store` key `pendingInviteToken`, báo listener), `usePendingInviteRedirect(): void` (trong `(app)/_layout.tsx`: lúc mount và mỗi khi có token mới, đọc rồi xoá token, `router.push({ pathname: '/invite/[token]', params: { token } })`).

- [ ] **Step 1: Nhận link.** `+native-intent.tsx`: giữ nhánh `dataUrl=`; thêm: `const token = inviteTokenFromPath(path); if (token) { setPendingInvite(token); return '/'; }`. `(app)/_layout.tsx`: gọi `usePendingInviteRedirect()` (component nhỏ như `IncomingShare`). `(app)` chỉ mount khi đã onboarding + đăng nhập, nên token chờ tới lúc đó, kể cả qua lần mở lại app (SecureStore).
- [ ] **Step 2: Màn `invite/[token].tsx`** theo mockup (màn ③) và spec mục "Chấp nhận lời mời": `GET /invites/:token` (qua `authFetch`); "Tham gia nhóm" → `POST /invites/:token/accept` → `router.replace({ pathname: '/group/[id]', params: { id } })` (đã là thành viên cũng vậy); "Để sau" → `router.replace('/groups')`; lỗi tải hay lỗi tham gia → `Notice` `ApiError.message` + nút "Về trang chủ" (`router.replace('/')`).
- [ ] **Step 3: App Links.** `app.config.ts` `android.intentFilters`: `[{ action: 'VIEW', autoVerify: true, data: [{ scheme: 'https', host: 'www.rongthongdong.name.vn', pathPrefix: '/invite/' }], category: ['BROWSABLE', 'DEFAULT'] }]`, comment: cần build APK mới; xác minh qua `/.well-known/assetlinks.json` và env `ANDROID_APP_LINK_SHA256`. Kiểm `npx expo config --type introspect` có intent filter.
- [ ] **Step 4: Kiểm** — sinh lại typed routes, tsc sạch, eslint, `expo export` Android.
- [ ] **Step 5: Commit** — `git commit -m "feat(mobile): open invite links and accept invites"`

### Task 6: Người chỉ xem không sửa lịch trình

**Files:**
- Modify: `apps/mobile/src/app/(app)/itinerary/[id].tsx`

**Interfaces:**
- Consumes: `Itinerary.myRole: 'creator' | 'owner' | 'editor' | 'viewer'`.

- [ ] **Step 1:** `const canEdit = data ? data.myRole !== 'viewer' : false;` `const canDelete = data?.myRole === 'creator' || data?.myRole === 'owner';` Khi `!canEdit`: không hiện nút "Sửa/Xong" (khoảng dòng 133-148), `ItineraryViewBody` không hiện nút gọi `onStartEdit` (đổi prop thành tùy chọn `onStartEdit?: () => void`, ẩn nút khi undefined), và `editing` bị ép `false` kể cả khi mở với `edit=1` (ví dụ `const editingNow = editing && canEdit` dùng ở mọi chỗ đang đọc `editing`). `DeleteButton` chỉ render khi `canDelete`.
- [ ] **Step 2: Kiểm** — tsc sạch, eslint, `expo export` Android.
- [ ] **Step 3: Commit** — `git commit -m "fix(mobile): hide itinerary editing for group viewers"`

### Task 7: Kiểm toàn nhánh

- [ ] **Step 1:** Backend: `cd apps/backend && pnpm test && npx vitest run --config vitest.config.e2e.ts test/groups.e2e-spec.ts test/invite-page.e2e-spec.ts && pnpm lint && pnpm typecheck` → tất cả pass.
- [ ] **Step 2:** Mobile: sinh lại typed routes, `npx tsc --noEmit` sạch, `pnpm --filter @rong/mobile lint`, `npx expo export --platform android` thành công.
- [ ] **Step 3:** Ghi vào mô tả PR checklist chạy tay (cần backend đã deploy route mới + env fingerprint, và APK build mới vì đổi `intentFilters`): tạo nhóm → mời (Chỉ xem/Chỉnh sửa) → mở link trên máy đã cài / chưa cài / chưa đăng nhập (đăng ký + xác minh) → tham gia → bấm lại link lần hai → đổi quyền, xoá thành viên, rời nhóm, đổi tên, xoá nhóm → người chỉ xem mở lịch trình nhóm không thấy "Sửa"/"Xóa"; thanh tab không che nội dung tab Nhóm.
