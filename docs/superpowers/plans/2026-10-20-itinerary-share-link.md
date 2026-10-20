# Link xem lịch trình (chia sẻ từ mobile, xem trên web) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nút "Chia sẻ lịch trình" trên mobile gửi một link `https://<web>/t/<token>` ổn định; người nhận mở trên trình duyệt thấy lịch trình chỉ xem, không cần app (US-13, FR-10.3).

**Architecture:** Backend suy ra token từ id của link bằng HMAC (bí mật riêng), nên database vẫn chỉ lưu SHA-256 của token mà server vẫn trả lại được link đang hiệu lực qua `GET /itineraries/:id/share-link` (ai xem được lịch trình đều lấy được, kể cả viewer). Mobile lấy link hiện có, chỉ tạo mới khi chưa có. Trang Next.js `apps/web/src/app/t/[token]` render phía server từ `GET /api/public/itineraries/:token`.

**Tech Stack:** NestJS 12 + raw SQL (backend), Expo / React Native (mobile), Next.js 16.3.5 App Router + Tailwind 4 (web), vitest 4.

**Spec:** Không có file spec riêng. Nguồn yêu cầu: PRD `docs/PRD-Rong.md` US-13, FR-10.3; quyết định của người dùng ngày 2026-10-20: (1) trang xem do Next.js `apps/web` phục vụ, (2) chia sẻ lại phải trả về link cũ, không thu hồi link đã gửi.

> **Lệch so với lựa chọn đã chốt:** người dùng chọn "lưu token dạng xem lại được (cột mới, migration)". Plan này đạt cùng kết quả bằng token suy ra từ HMAC — không cần migration và giữ nguyên tính chất "lộ database không lộ link" ghi trong `groups/tokens.ts`. Nếu muốn quay về phương án cột mới, chỉ Task 1–2 thay đổi.

## Global Constraints

- Comment, log, chuỗi lỗi và chữ trên UI bằng tiếng Việt.
- Backend ESM: import tương đối phải có đuôi `.js`.
- Lỗi backend: `{ code, message }`; mã cho link không tồn tại là `SHARE_LINK_NOT_FOUND` (đã có).
- Token: 43 ký tự base64url, khớp `/^[A-Za-z0-9_-]{43}$/` (`isTokenShape`).
- Database chỉ lưu `token_hash` (SHA-256); không thêm cột chứa token.
- `SHARE_LINK_SECRET` không bắt buộc; thiếu thì dùng `JWT_SECRET`; nếu đặt thì ≥ 32 ký tự.
- Mỗi lịch trình tối đa một link còn hiệu lực (index `uq_share_link_active` đã có). `POST` vẫn = tạo link mới và thu hồi link cũ.
- Trang web: không cache dữ liệu lịch trình (link bị thu hồi phải chết ngay), `robots: noindex, nofollow`, chỉ hiển thị dữ liệu riêng của Rong (PRD §7.4 — `PublicItinerary` đã lọc sẵn).
- Web theo design system Rong: font Be Vietnam Pro, nền mist `#F1F3F0`, chữ ink `#16231D`, hành động/brand pine `#2F6B55`, lavender `#9C8CF2` chỉ cho nội dung AI; chỉ giao diện sáng.
- Next.js 16 khác bản cũ: đọc `apps/web/AGENTS.md` và tài liệu trong `apps/web/node_modules/next/dist/docs/` trước khi sửa `apps/web` (đặc biệt `01-app/01-getting-started/06-fetching-data.md`, `10-error-handling.md`, `14-metadata-and-og-images.md`).
- Commit nhỏ, mỗi task một commit; kết thúc message bằng dòng attribution của phiên.

## Review Focus

1. **Link cũ (tạo bằng token ngẫu nhiên trước thay đổi này)** — `GET` phải trả `{ link: null }` chứ không trả token sai; mobile của editor sẽ tạo link mới. → test e2e "link cũ không suy ra được" ở Task 2.
2. **Viewer chia sẻ khi lịch trình chưa có link** — không được gọi `POST` (403); hiện thông báo nhờ người chỉnh sửa chia sẻ trước. → logic `resolveShareToken` + kiểm tra tay ở Task 5.
3. **Backend Render ngủ (cold start 30–60 s) khi Zalo/Messenger lấy ảnh xem trước hoặc người nhận mở link** — trang không được treo vô hạn; fetch có timeout 25 s, lỗi thì hiện trang lỗi có nút thử lại chứ không phải 404. → test `fetchPublicItinerary` phân biệt 404 và lỗi khác ở Task 3.
4. **Token rác hoặc sai dạng trong URL web** (`/t/abc`, `/t/%00`) — trả trang 404, không gọi backend. → test ở Task 3.
5. **Lịch trình có ngày trống, mục nghỉ không gắn địa điểm (`place: null`), không có `tips`/`unscheduled`** — trang vẫn render, không crash. → test `describeItem` ở Task 3 và dữ liệu thử ở Task 4.

---

## File Structure

| File | Trách nhiệm |
| --- | --- |
| `apps/backend/src/modules/itineraries/share-link-token.ts` (mới) | Hàm thuần: suy ra token từ bí mật + id link |
| `apps/backend/src/modules/itineraries/share-link-token.spec.ts` (mới) | Unit test |
| `apps/backend/src/config/configuration.ts` | Thêm `shareLinks.secret` |
| `apps/backend/.env.example` | Thêm `SHARE_LINK_SECRET` |
| `apps/backend/src/modules/itineraries/share-links.service.ts` | `create` dùng token suy ra; thêm `current` |
| `apps/backend/src/modules/itineraries/share-links.controller.ts` | Thêm `GET itineraries/:id/share-link` |
| `apps/backend/src/modules/itineraries/itineraries.module.ts` | Provider `SHARE_LINKS_CONFIG` |
| `packages/shared-types/src/itinerary.ts` | Kiểu `CurrentItineraryShareLink` |
| `apps/backend/test/groups.e2e-spec.ts` | e2e cho `GET` |
| `apps/web/src/lib/public-itinerary.ts` (mới) | Lấy `PublicItinerary` từ backend, phân biệt 404 |
| `apps/web/src/lib/format.ts` (mới) | Định dạng ngày/giờ/nhãn tiếng Việt |
| `apps/web/src/lib/*.test.ts` (mới) | vitest |
| `apps/web/src/app/t/[token]/page.tsx`, `not-found.tsx`, `error.tsx` | Trang xem |
| `apps/web/src/app/layout.tsx`, `globals.css` | Font + màu design system |
| `apps/web/.env.example` (mới) | `RONG_API_URL` |
| `apps/mobile/src/lib/share-link.ts` (mới) | Dựng URL, chọn token |
| `apps/mobile/src/app/(app)/itinerary/[id].tsx` | `onShare` dùng link |
| `apps/mobile/.env.example` | `EXPO_PUBLIC_WEB_BASE_URL` |
| `apps/backend/src/modules/README.md`, `CLAUDE.md` | Ghi chú route mới |

---

### Task 1: Token suy ra từ HMAC + cấu hình bí mật

**Files:**
- Create: `apps/backend/src/modules/itineraries/share-link-token.ts`
- Test: `apps/backend/src/modules/itineraries/share-link-token.spec.ts`
- Modify: `apps/backend/src/config/configuration.ts` (interface `AppConfig`, `requireStrongSecret`, `loadConfig`)
- Modify: `apps/backend/.env.example`

**Interfaces:**
- Produces: `shareLinkToken(secret: string, linkId: string): string`; `AppConfig['shareLinks']: ShareLinksConfig` với `ShareLinksConfig { secret: string }`.

- [ ] **Step 1: Viết test thất bại**

```ts
// apps/backend/src/modules/itineraries/share-link-token.spec.ts
import { describe, expect, it } from 'vitest';

import { isTokenShape } from '../groups/tokens.js';
import { shareLinkToken } from './share-link-token.js';

const SECRET = 'x'.repeat(32);
const ID = '7d9c1f0e-4b7a-4c51-9a35-1c2b3d4e5f60';

describe('shareLinkToken', () => {
  it('cùng bí mật và id thì cùng token, đúng dạng token', () => {
    const token = shareLinkToken(SECRET, ID);
    expect(token).toBe(shareLinkToken(SECRET, ID));
    expect(isTokenShape(token)).toBe(true);
  });

  it('khác id hoặc khác bí mật thì khác token', () => {
    const token = shareLinkToken(SECRET, ID);
    expect(shareLinkToken(SECRET, '00000000-0000-4000-8000-000000000000')).not.toBe(token);
    expect(shareLinkToken('y'.repeat(32), ID)).not.toBe(token);
  });
});
```

- [ ] **Step 2: Chạy test, phải FAIL**

Run: `cd apps/backend && npx vitest run src/modules/itineraries/share-link-token.spec.ts`
Expected: FAIL — không tìm thấy module `./share-link-token.js`.

- [ ] **Step 3: Viết hàm**

```ts
// apps/backend/src/modules/itineraries/share-link-token.ts
import { createHmac } from 'node:crypto';

/**
 * Token của link xem lịch trình = HMAC-SHA256(bí mật, id link), base64url (43 ký tự, cùng dạng
 * `newToken`). Database vẫn chỉ lưu SHA-256 của token, nhưng server tính lại được token từ id để
 * trả link đang hiệu lực cho người chia sẻ lần sau. Đổi bí mật thì mọi link cũ không lấy lại được
 * (vẫn mở được cho tới khi bị thay).
 */
export function shareLinkToken(secret: string, linkId: string): string {
  return createHmac('sha256', secret)
    .update(`itinerary-share-link:${linkId}`)
    .digest('base64url');
}
```

- [ ] **Step 4: Chạy test, phải PASS**

Run: `cd apps/backend && npx vitest run src/modules/itineraries/share-link-token.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Thêm cấu hình**

Trong `configuration.ts`:

1. Cạnh `InviteLinksConfig`, thêm:

```ts
/** Link xem lịch trình trên web (FR-10.3). */
export interface ShareLinksConfig {
  /** Khóa HMAC suy ra token từ id link (`share-link-token.ts`). Mặc định dùng `JWT_SECRET`. */
  secret: string;
}
```

2. Trong `AppConfig`, ngay sau `inviteLinks: InviteLinksConfig;` thêm `shareLinks: ShareLinksConfig;`.

3. Cho `requireStrongSecret` nhận tên biến để thông báo lỗi đúng:

```ts
function requireStrongSecret(value: string, name = 'JWT_SECRET'): string {
  if (value.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `${name} phải dài ít nhất ${MIN_JWT_SECRET_LENGTH} ký tự. ` +
        `Sinh nhanh bằng: openssl rand -base64 48`,
    );
  }
  return value;
}
```

4. Trong object trả về của `loadConfig`, sau khối `inviteLinks`:

```ts
    shareLinks: {
      secret: process.env.SHARE_LINK_SECRET
        ? requireStrongSecret(process.env.SHARE_LINK_SECRET, 'SHARE_LINK_SECRET')
        : (process.env.JWT_SECRET as string),
    },
```

5. Trong `apps/backend/.env.example`, ngay dưới dòng `JWT_SECRET=`:

```
# Khóa suy ra token link xem lịch trình (≥ 32 ký tự). Trống thì dùng JWT_SECRET;
# đổi khóa thì app không lấy lại được link cũ và sẽ tạo link mới khi chia sẻ.
SHARE_LINK_SECRET=
```

- [ ] **Step 6: Typecheck + unit test toàn backend**

Run: `cd apps/backend && pnpm typecheck && pnpm test`
Expected: không lỗi, mọi test PASS. (Nếu có spec nào dựng `AppConfig` đầy đủ bằng tay và báo thiếu `shareLinks`, thêm `shareLinks: { secret: 'x'.repeat(32) }` vào đó.)

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/modules/itineraries/share-link-token.ts apps/backend/src/modules/itineraries/share-link-token.spec.ts apps/backend/src/config/configuration.ts apps/backend/.env.example
git commit -m "feat(backend): derive itinerary share-link tokens from the link id"
```

---

### Task 2: `GET /itineraries/:id/share-link` trả link đang hiệu lực

**Files:**
- Modify: `packages/shared-types/src/itinerary.ts:200-205`
- Modify: `apps/backend/src/modules/itineraries/share-links.service.ts`
- Modify: `apps/backend/src/modules/itineraries/share-links.controller.ts`
- Modify: `apps/backend/src/modules/itineraries/itineraries.module.ts`
- Test: `apps/backend/test/groups.e2e-spec.ts` (describe `'link xem lịch trình'`, dòng ~632)

**Interfaces:**
- Consumes: `shareLinkToken(secret, linkId)`, `AppConfig['shareLinks']` (Task 1).
- Produces: `GET /api/itineraries/:id/share-link` → `CurrentItineraryShareLink { link: ItineraryShareLink | null }`, quyền `view`, người ngoài 404. `POST` giữ nguyên hợp đồng `ItineraryShareLink`.

- [ ] **Step 1: Thêm kiểu chung**

Trong `packages/shared-types/src/itinerary.ts`, thay khối `ItineraryShareLink` bằng:

```ts
/** Link xem lịch trình trên web: `<web>/t/<token>`. */
export interface ItineraryShareLink {
  token: string;
  createdAt: string;
}

/**
 * GET /itineraries/:id/share-link — link đang hiệu lực, ai xem được lịch trình đều lấy được.
 * null khi chưa có link (hoặc link tạo trước khi token được suy ra từ id, không lấy lại được).
 */
export interface CurrentItineraryShareLink {
  link: ItineraryShareLink | null;
}
```

Run: `pnpm --filter @rong/backend build:deps`
Expected: build `@rong/shared-types` thành công.

- [ ] **Step 2: Viết e2e thất bại**

Trong `describe('link xem lịch trình', …)` của `apps/backend/test/groups.e2e-spec.ts`, thêm sau test `'viewer không tạo được link; người ngoài nhận 404'` (user `a` là owner, `c` là viewer trong nhóm, `b` là người ngoài; `db` là `DataSource` của spec):

```ts
    it('lấy lại đúng link đang hiệu lực; viewer cũng lấy được; người ngoài 404', async () => {
      await call('a').delete(`/itineraries/${tripId}/share-link`).expect(204);
      expect(
        (await call('a').get(`/itineraries/${tripId}/share-link`).expect(200)).body,
      ).toEqual({ link: null });

      const created = await call('a')
        .post(`/itineraries/${tripId}/share-link`)
        .expect(201);
      for (const who of ['a', 'c'] as const) {
        const res = await call(who)
          .get(`/itineraries/${tripId}/share-link`)
          .expect(200);
        expect(res.body.link).toEqual(created.body);
      }
      await call(null)
        .get(`/public/itineraries/${created.body.token}`)
        .expect(200);
      await call('b').get(`/itineraries/${tripId}/share-link`).expect(404);
      await call(null).get(`/itineraries/${tripId}/share-link`).expect(401);
    });

    it('link cũ không suy ra được token thì trả null', async () => {
      await call('a').delete(`/itineraries/${tripId}/share-link`).expect(204);
      // Giống link tạo trước khi có token suy ra: hash của một token ngẫu nhiên.
      await db.query(
        `INSERT INTO itinerary_share_links (itinerary_id, token_hash) VALUES ($1, $2)`,
        [tripId, 'f'.repeat(64)],
      );
      expect(
        (await call('a').get(`/itineraries/${tripId}/share-link`).expect(200)).body,
      ).toEqual({ link: null });
      // Editor chia sẻ lại thì có link mới dùng được.
      const fresh = await call('a')
        .post(`/itineraries/${tripId}/share-link`)
        .expect(201);
      expect(
        (await call('a').get(`/itineraries/${tripId}/share-link`).expect(200)).body.link.token,
      ).toBe(fresh.body.token);
    });
```

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/groups.e2e-spec.ts -t 'link xem lịch trình'`
Expected: 2 test mới FAIL (route `GET` chưa có → 404), các test cũ PASS.

- [ ] **Step 3: Provider cấu hình**

Trong `itineraries.module.ts` thêm import `ConfigService` từ `@nestjs/config`, `type AppConfig` từ `'../../config/configuration.js'`, `SHARE_LINKS_CONFIG` từ `'./share-links.service.js'`, rồi trong `providers` thêm (giữ các provider cũ):

```ts
    {
      provide: SHARE_LINKS_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<AppConfig['shareLinks']>('shareLinks'),
    },
```

- [ ] **Step 4: Sửa service**

Trong `share-links.service.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  CurrentItineraryShareLink,
  // …các kiểu đang có
} from '@rong/shared-types';

import type { ShareLinksConfig } from '../../config/configuration.js';
import { hashToken, isTokenShape } from '../groups/tokens.js';
import { shareLinkToken } from './share-link-token.js';

export const SHARE_LINKS_CONFIG = 'SHARE_LINKS_CONFIG';
```

(Bỏ `newToken` khỏi import.) Sửa comment lớp thành: `Mỗi lịch trình tối đa một link còn hiệu lực; tạo lại thì link cũ bị thu hồi. Không hết hạn. Token suy ra từ id link (share-link-token.ts) nên lấy lại được mà database chỉ lưu bản băm.`

Constructor thêm `@Inject(SHARE_LINKS_CONFIG) private readonly config: ShareLinksConfig,`.

Thay phần sinh token trong `create`:

```ts
    await this.itineraries.authorize(userId, itineraryId, 'edit');
    const linkId = randomUUID();
    const token = shareLinkToken(this.config.secret, linkId);
    const createdAt = await this.db.transaction(async (m) => {
      await m.query(
        `UPDATE itinerary_share_links SET revoked_at = now()
          WHERE itinerary_id = $1 AND revoked_at IS NULL`,
        [itineraryId],
      );
      const [row] = (await m.query(
        `INSERT INTO itinerary_share_links (id, itinerary_id, token_hash, created_by)
         VALUES ($1, $2, $3, $4) RETURNING created_at`,
        [linkId, itineraryId, hashToken(token), userId],
      )) as Array<{ created_at: Date }>;
      return row.created_at;
    });
    return { token, createdAt: createdAt.toISOString() };
```

Thêm method sau `create`:

```ts
  /** Link đang hiệu lực cho người xem được lịch trình (kể cả viewer): chia sẻ lại không đổi link. */
  async current(
    userId: string,
    itineraryId: string,
  ): Promise<CurrentItineraryShareLink> {
    await this.itineraries.authorize(userId, itineraryId, 'view');
    const [row] = (await this.db.query(
      `SELECT id, token_hash, created_at FROM itinerary_share_links
        WHERE itinerary_id = $1 AND revoked_at IS NULL`,
      [itineraryId],
    )) as Array<{ id: string; token_hash: string; created_at: Date }>;
    if (!row) return { link: null };
    const token = shareLinkToken(this.config.secret, row.id);
    // Link tạo bằng token ngẫu nhiên (trước khi suy ra từ id) hoặc trước khi đổi khóa: không lấy lại được.
    if (hashToken(token) !== row.token_hash) return { link: null };
    return { link: { token, createdAt: row.created_at.toISOString() } };
  }
```

- [ ] **Step 5: Thêm route**

Trong `share-links.controller.ts`, thêm `CurrentItineraryShareLink` vào import kiểu, sửa comment lớp thành `/** Link xem lịch trình trên web — FR-10.3. Trang /t/[token] của apps/web gọi route công khai. */` (giữ nguyên) và thêm trước `@Post`:

```ts
  @Get('itineraries/:id/share-link')
  current(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<CurrentItineraryShareLink> {
    return this.links.current(user.userId, id);
  }
```

- [ ] **Step 6: Chạy e2e, phải PASS**

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/groups.e2e-spec.ts`
Expected: toàn bộ file PASS, gồm 2 test mới và test cũ `'tạo lại thì link cũ chết ngay; thu hồi thì link mới chết'`.

- [ ] **Step 7: Lint, typecheck, unit**

Run: `cd apps/backend && pnpm lint && pnpm typecheck && pnpm test`
Expected: sạch.

- [ ] **Step 8: Cập nhật tài liệu**

- `apps/backend/src/modules/README.md`: ở phần itineraries/share links, thêm một dòng: `GET /itineraries/:id/share-link` (quyền xem) trả link đang hiệu lực; token = HMAC(`SHARE_LINK_SECRET` hoặc `JWT_SECRET`, id link), database chỉ lưu SHA-256.
- `CLAUDE.md` mục "Itineraries": sửa dòng "Share links …" thành: `Share links (share-links.*) expose a read-only public view at public/itineraries/:token, rendered by apps/web at /t/:token. GET itineraries/:id/share-link returns the active link (token derived from the link id by HMAC), POST rotates it.`

- [ ] **Step 9: Commit**

```bash
git add packages/shared-types/src/itinerary.ts apps/backend/src/modules/itineraries apps/backend/test/groups.e2e-spec.ts apps/backend/src/modules/README.md CLAUDE.md
git commit -m "feat(backend): return the active itinerary share link to anyone who can view it"
```

---

### Task 3: Web — lấy dữ liệu và định dạng (có test)

**Files:**
- Modify: `apps/web/package.json` (thêm `vitest`, script `test`)
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/src/lib/public-itinerary.ts`, `apps/web/src/lib/public-itinerary.test.ts`
- Create: `apps/web/src/lib/format.ts`, `apps/web/src/lib/format.test.ts`
- Create: `apps/web/.env.example`

**Interfaces:**
- Consumes: `GET {RONG_API_URL}/api/public/itineraries/:token` → `PublicItinerary` hoặc 404 `{ code: 'SHARE_LINK_NOT_FOUND' }`.
- Produces:
  - `fetchPublicItinerary(token: string, fetchImpl?: typeof fetch): Promise<PublicItinerary | null>` — null khi token sai dạng hoặc backend 404; ném `Error` với lỗi khác/timeout.
  - `getPublicItinerary(token: string)` — bản `React.cache` của hàm trên, dùng chung cho `generateMetadata` và page.
  - `formatTime(iso: string): string` → `"08:30"` giờ Việt Nam; `formatPlanDate(date: string): string` → `"Thứ Bảy, 04/10"`; `formatDateRange(startsAt, endsAt): string` → `"04/10 – 05/10/2026"`; `partyLabel(p: PublicItinerary): string` → `"Nhóm bạn · 2 người lớn"`; `describeItem(item: ItineraryItem): string` → tên địa điểm, hoặc nhãn bữa/nghỉ khi `place` null.

- [ ] **Step 1: Cài vitest cho web**

Trong `apps/web/package.json`: thêm `"test": "vitest run"` vào `scripts`, `"vitest": "^4.1.2"` vào `devDependencies`. Tạo `apps/web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
```

Run: `pnpm install`
Expected: cài xong, không đổi phiên bản package khác.

- [ ] **Step 2: Viết test thất bại cho fetch**

```ts
// apps/web/src/lib/public-itinerary.test.ts
import { describe, expect, it, vi } from "vitest";

import { fetchPublicItinerary } from "./public-itinerary";

const TOKEN = "A".repeat(42) + "b";

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("fetchPublicItinerary", () => {
  it("token sai dạng thì null, không gọi backend", async () => {
    const fetchImpl = respond(200, {});
    for (const bad of ["abc", "%00", "A".repeat(44)]) {
      expect(await fetchPublicItinerary(bad, fetchImpl)).toBeNull();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("backend 404 thì null", async () => {
    const fetchImpl = respond(404, { code: "SHARE_LINK_NOT_FOUND" });
    expect(await fetchPublicItinerary(TOKEN, fetchImpl)).toBeNull();
  });

  it("200 thì trả dữ liệu, gọi đúng URL và không cache", async () => {
    process.env.RONG_API_URL = "https://api.example.vn/";
    const fetchImpl = respond(200, { regionName: "Đà Lạt" });
    expect(await fetchPublicItinerary(TOKEN, fetchImpl)).toEqual({ regionName: "Đà Lạt" });
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.example.vn/api/public/itineraries/${TOKEN}`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("lỗi khác 404 thì ném, để trang lỗi cho thử lại", async () => {
    await expect(fetchPublicItinerary(TOKEN, respond(502, {}))).rejects.toThrow();
  });
});
```

Run: `cd apps/web && pnpm test`
Expected: FAIL — không tìm thấy `./public-itinerary`.

- [ ] **Step 3: Viết `public-itinerary.ts`**

```ts
// apps/web/src/lib/public-itinerary.ts
import type { PublicItinerary } from "@rong/shared-types";
import { cache } from "react";

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
/** Backend trên Render ngủ khi vắng: lần đầu có thể mất 30–60 s. Quá thì báo lỗi để người xem thử lại. */
const TIMEOUT_MS = 25_000;

function apiBase(): string {
  return (process.env.RONG_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
}

/** null khi link không tồn tại hoặc đã thu hồi; lỗi khác thì ném. Không cache: link thu hồi phải chết ngay. */
export async function fetchPublicItinerary(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PublicItinerary | null> {
  if (!TOKEN_SHAPE.test(token)) return null;
  const res = await fetchImpl(`${apiBase()}/api/public/itineraries/${token}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Backend trả ${res.status} khi lấy lịch trình chia sẻ`);
  return (await res.json()) as PublicItinerary;
}

/** Dùng chung cho generateMetadata và page trong một request. */
export const getPublicItinerary = cache((token: string) => fetchPublicItinerary(token));
```

Run: `cd apps/web && pnpm test`
Expected: 4 test PASS.

- [ ] **Step 4: Viết test thất bại cho định dạng**

```ts
// apps/web/src/lib/format.test.ts
import type { ItineraryItem, PublicItinerary } from "@rong/shared-types";
import { describe, expect, it } from "vitest";

import { describeItem, formatDateRange, formatPlanDate, formatTime, partyLabel } from "./format";

const item = (over: Partial<ItineraryItem>): ItineraryItem => ({
  id: "1", kind: "visit", placeId: "p", place: null, dayPart: "morning", order: 0,
  startsAt: "2026-10-04T01:30:00.000Z", endsAt: "2026-10-04T02:30:00.000Z", isAiSuggested: false, ...over,
});

describe("format", () => {
  it("giờ theo múi giờ Việt Nam", () => {
    expect(formatTime("2026-10-04T01:30:00.000Z")).toBe("08:30");
  });
  it("ngày của lịch trình", () => {
    expect(formatPlanDate("2026-10-04")).toBe("Thứ Bảy, 04/10");
  });
  it("khoảng ngày, gộp khi cùng ngày", () => {
    expect(formatDateRange("2026-10-04T01:00:00.000Z", "2026-10-05T12:00:00.000Z")).toBe("04/10 – 05/10/2026");
    expect(formatDateRange("2026-10-04T01:00:00.000Z", "2026-10-04T12:00:00.000Z")).toBe("04/10/2026");
  });
  it("đối tượng đi", () => {
    const p = { travelParty: "family_with_kids", adults: 2, children: 1 } as PublicItinerary;
    expect(partyLabel(p)).toBe("Gia đình có trẻ nhỏ · 2 người lớn, 1 trẻ em");
  });
  it("mục không gắn địa điểm vẫn có tên", () => {
    expect(describeItem(item({ place: { name: "Hồ Xuân Hương", category: "nature", coordinates: null } }))).toBe("Hồ Xuân Hương");
    expect(describeItem(item({ kind: "meal", mealType: "lunch" }))).toBe("Bữa trưa");
    expect(describeItem(item({ kind: "rest", placeId: null }))).toBe("Nghỉ ngơi");
  });
});
```

Run: `cd apps/web && pnpm test`
Expected: FAIL — không tìm thấy `./format`.

- [ ] **Step 5: Viết `format.ts`**

Nhãn copy từ `apps/mobile/src/lib/trip-format.ts` (`TRAVEL_PARTY_LABELS`, `MEAL_LABELS`) — đối chiếu đúng chữ ở đó trước khi chép; dưới đây là bản cần có:

```ts
// apps/web/src/lib/format.ts
import type { ItineraryItem, MealType, PublicItinerary, TravelParty } from "@rong/shared-types";

const TZ = "Asia/Ho_Chi_Minh";
const WEEKDAYS = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

const TRAVEL_PARTY_LABELS: Record<TravelParty, string> = {
  friends: "Nhóm bạn",
  family_with_kids: "Gia đình có trẻ nhỏ",
  couple: "Cặp đôi",
  solo: "Một mình",
  with_elderly: "Có người lớn tuổi",
};

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Bữa sáng",
  lunch: "Bữa trưa",
  dinner: "Bữa tối",
};

const time = new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
const dayMonth = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", timeZone: TZ });
const year = new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: TZ });

const pad = (n: number) => String(n).padStart(2, "0");

/** "08:30" theo giờ Việt Nam. */
export function formatTime(iso: string): string {
  return time.format(new Date(iso));
}

/** Ngày `YYYY-MM-DD` của lịch trình → "Thứ Bảy, 04/10". */
export function formatPlanDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${pad(d)}/${pad(m)}`;
}

/** "04/10 – 05/10/2026", hoặc "04/10/2026" nếu cùng ngày. */
export function formatDateRange(startsAt: string, endsAt: string): string {
  const start = dayMonth.format(new Date(startsAt));
  const end = dayMonth.format(new Date(endsAt));
  const y = year.format(new Date(endsAt));
  return start === end ? `${start}/${y}` : `${start} – ${end}/${y}`;
}

/** "Nhóm bạn · 2 người lớn" / "… · 2 người lớn, 1 trẻ em". */
export function partyLabel(p: Pick<PublicItinerary, "travelParty" | "adults" | "children">): string {
  const people = [`${p.adults} người lớn`, ...(p.children > 0 ? [`${p.children} trẻ em`] : [])].join(", ");
  return `${TRAVEL_PARTY_LABELS[p.travelParty]} · ${people}`;
}

/** Tên hiển thị của một mục; mục ăn/nghỉ chưa gắn địa điểm thì dùng nhãn. */
export function describeItem(item: ItineraryItem): string {
  if (item.place) return item.place.name;
  if (item.kind === "meal") return item.mealType ? MEAL_LABELS[item.mealType] : "Ăn uống";
  return "Nghỉ ngơi";
}
```

Run: `cd apps/web && pnpm test`
Expected: toàn bộ PASS. Nếu `dayMonth` cho "04/10" khác định dạng (một số bản ICU dùng "04-10"), đổi sang tách `formatToParts` và ghép `${day}/${month}` thủ công.

- [ ] **Step 6: `.env.example`**

```
# apps/web/.env.example
# Backend NestJS (không có /api ở cuối). Chỉ dùng phía server.
RONG_API_URL=http://localhost:3001
# APK mới nhất cho nút "Tải app Rong".
NEXT_PUBLIC_APP_DOWNLOAD_URL=https://github.com/bluez44/Rong/releases/latest
```

- [ ] **Step 7: Typecheck + commit**

Run: `cd apps/web && pnpm typecheck && pnpm test`
Expected: sạch.

```bash
git add apps/web/package.json apps/web/vitest.config.ts apps/web/src/lib apps/web/.env.example pnpm-lock.yaml
git commit -m "feat(web): fetch and format shared itineraries"
```

---

### Task 4: Web — trang `/t/[token]`

**Files:**
- Modify: `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css`
- Modify: `apps/web/src/app/t/[token]/page.tsx`
- Create: `apps/web/src/app/t/[token]/not-found.tsx`, `apps/web/src/app/t/[token]/error.tsx`

**Interfaces:**
- Consumes: `getPublicItinerary`, `formatTime`, `formatPlanDate`, `formatDateRange`, `partyLabel`, `describeItem` (Task 3).
- Produces: route công khai `/t/:token` — 200 với lịch trình, 404 trang "Link không còn hiệu lực", lỗi backend → trang lỗi có nút "Thử lại".

- [ ] **Step 1: Font và màu**

Đọc trước `node_modules/next/dist/docs/01-app/01-getting-started/13-fonts.md`. Trong `layout.tsx` thay Geist bằng:

```tsx
import { Be_Vietnam_Pro } from "next/font/google";

const beVietnam = Be_Vietnam_Pro({
  variable: "--font-be-vietnam",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
});
```

`<html lang="vi" className={`${beVietnam.variable} h-full antialiased`}>`. Thêm `robots: { index: false, follow: false }` vào `metadata` gốc (trang duy nhất là link riêng tư).

`globals.css`: bỏ khối `prefers-color-scheme: dark` (chỉ giao diện sáng) và thay token:

```css
@import "tailwindcss";

:root {
  --background: #f1f3f0; /* mist */
  --foreground: #16231d; /* ink */
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-pine: #2f6b55;
  --color-lavender: #9c8cf2;
  --font-sans: var(--font-be-vietnam);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-be-vietnam), system-ui, sans-serif;
}
```

- [ ] **Step 2: Viết trang**

```tsx
// apps/web/src/app/t/[token]/page.tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { describeItem, formatDateRange, formatPlanDate, formatTime, partyLabel } from "@/lib/format";
import { getPublicItinerary } from "@/lib/public-itinerary";

/**
 * Trang xem lịch trình được chia sẻ — FR-10.3, US-13. Chỉ xem, không cần app. Render phía server
 * để Zalo/Messenger lấy được tiêu đề xem trước. Không cache: link bị thu hồi phải chết ngay.
 */
type PageProps = { params: Promise<{ token: string }> };

const DOWNLOAD_URL =
  process.env.NEXT_PUBLIC_APP_DOWNLOAD_URL ?? "https://github.com/bluez44/Rong/releases/latest";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const trip = await getPublicItinerary(token).catch(() => null);
  const title = trip
    ? `Lịch trình ${trip.regionName} · ${formatDateRange(trip.startsAt, trip.endsAt)}`
    : "Lịch trình · Rong";
  const description = trip
    ? `${trip.days.length} ngày · ${partyLabel(trip)}. Xem lịch trình trên Rong.`
    : "Xem lịch trình chuyến đi được chia sẻ từ Rong.";
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, type: "website", url: `/t/${token}` },
  };
}

export default async function SharedItineraryPage({ params }: PageProps) {
  const { token } = await params;
  const trip = await getPublicItinerary(token);
  if (!trip) notFound();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <p className="text-sm font-medium text-pine">Lịch trình trên Rong</p>
        <h1 className="text-2xl font-bold tracking-tight">{trip.regionName}</h1>
        <p className="text-sm opacity-70">
          {formatDateRange(trip.startsAt, trip.endsAt)} · {trip.days.length} ngày · {partyLabel(trip)}
        </p>
      </header>

      {trip.days.map((day, index) => (
        <section key={day.id} className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">
            Ngày {index + 1} · {formatPlanDate(day.date)}
          </h2>
          {day.items.length === 0 ? (
            <p className="text-sm opacity-60">Chưa có hoạt động.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {day.items.map((item) => (
                <li key={item.id} className="flex gap-3">
                  <span className="w-12 shrink-0 text-sm font-medium tabular-nums text-pine">
                    {formatTime(item.startsAt)}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium">{describeItem(item)}</p>
                    {item.travelMinutesFromPrevious ? (
                      <p className="text-xs opacity-60">Di chuyển ~{item.travelMinutesFromPrevious} phút</p>
                    ) : null}
                    {item.reason ? (
                      <p className={`text-sm ${item.isAiSuggested ? "text-lavender" : "opacity-70"}`}>{item.reason}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}

      {trip.unscheduled.length > 0 ? (
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-2 font-semibold">Chưa xếp vào ngày nào</h2>
          <ul className="list-disc pl-5 text-sm">
            {trip.unscheduled.map((u) => (
              <li key={u.placeId}>{u.name ?? "Địa điểm"}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {trip.tips.length > 0 ? (
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-2 font-semibold text-lavender">Mẹo cho chuyến đi</h2>
          <ul className="list-disc pl-5 text-sm">
            {trip.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <a
        href={DOWNLOAD_URL}
        className="rounded-full bg-pine px-5 py-3 text-center font-semibold text-white"
      >
        Tải app Rong để lập lịch trình của bạn
      </a>
    </main>
  );
}
```

- [ ] **Step 3: Trang 404 và trang lỗi**

Đọc `10-error-handling.md` để xác nhận chữ ký `error.tsx` của Next 16 (prop `reset` có thể đã đổi tên — dùng đúng tên trong tài liệu).

```tsx
// apps/web/src/app/t/[token]/not-found.tsx
export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-3 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Link không còn hiệu lực</h1>
      <p className="text-sm opacity-70">Lịch trình đã bị thu hồi link hoặc link sai. Xin link mới từ người chia sẻ.</p>
    </main>
  );
}
```

```tsx
// apps/web/src/app/t/[token]/error.tsx
"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-3 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Chưa tải được lịch trình</h1>
      <p className="text-sm opacity-70">Máy chủ đang khởi động hoặc mạng chập chờn. Thử lại sau vài giây.</p>
      <button onClick={reset} className="mx-auto rounded-full bg-pine px-5 py-2 font-semibold text-white">
        Thử lại
      </button>
    </main>
  );
}
```

- [ ] **Step 4: Build và kiểm tra tay với backend thật**

Run: `cd apps/web && pnpm lint && pnpm typecheck && pnpm build`
Expected: build thành công, `/t/[token]` là route động (ƒ).

Kiểm tra tay: chạy backend local (`pnpm --filter @rong/backend start:dev`), lấy token bằng `POST /api/itineraries/:id/share-link` (đăng nhập bằng tài khoản dev), tạo `apps/web/.env.local` từ `.env.example`, chạy `pnpm --filter @rong/web dev` rồi mở:
- `http://localhost:3000/t/<token>` → thấy tên vùng, ngày, các mục có giờ; xem source có `<meta name="robots" content="noindex, nofollow">`.
- Một lịch trình `planningMode: 'manual'` (ngày trống) → hiện "Chưa có hoạt động.".
- `http://localhost:3000/t/abc` → trang "Link không còn hiệu lực" (404).
- Tắt backend rồi tải lại link thật → trang "Chưa tải được lịch trình" có nút Thử lại.
- Thu hồi (`DELETE …/share-link`) rồi tải lại → 404 ngay, không cache.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app
git commit -m "feat(web): render shared itineraries at /t/[token]"
```

---

### Task 5: Mobile — chia sẻ kèm link

**Files:**
- Create: `apps/mobile/src/lib/share-link.ts`
- Modify: `apps/mobile/src/app/(app)/itinerary/[id].tsx:45-55` (`onShare`)
- Modify: `apps/mobile/.env.example`

**Interfaces:**
- Consumes: `GET`/`POST /itineraries/:id/share-link` (Task 2), kiểu `CurrentItineraryShareLink`, `ItineraryShareLink`; `authFetch` từ `useAuth()`.
- Produces: `itineraryShareUrl(token: string): string`; `resolveShareToken(authFetch, itineraryId: string, canCreate: boolean): Promise<string | null>`.

Mobile chưa có framework test; kiểm bằng typecheck, lint và chạy tay.

- [ ] **Step 1: Biến môi trường**

`apps/mobile/.env.example`, dưới `EXPO_PUBLIC_API_BASE_URL`:

```
# Trang web xem lịch trình được chia sẻ (apps/web), không có / ở cuối
EXPO_PUBLIC_WEB_BASE_URL=http://localhost:3000
```

Thêm cùng biến vào `apps/mobile/.env` của máy dev, và vào env của profile build trong EAS (giá trị = domain web đã deploy).

- [ ] **Step 2: `share-link.ts`**

```ts
// apps/mobile/src/lib/share-link.ts
import type { CurrentItineraryShareLink, ItineraryShareLink } from '@rong/shared-types';

import type { RequestOptions } from '@/lib/api';

/** Link xem lịch trình (FR-10.3): trang `/t/<token>` của apps/web, mở được mà không cần app. */
const WEB_BASE_URL = (process.env.EXPO_PUBLIC_WEB_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export function itineraryShareUrl(token: string): string {
  return `${WEB_BASE_URL}/t/${token}`;
}

type AuthFetch = <T>(path: string, options?: Omit<RequestOptions, 'token'>) => Promise<T>;

/**
 * Token của link đang hiệu lực; chưa có thì người sửa được tạo mới. Không tạo lại khi đã có link,
 * vì tạo mới sẽ thu hồi link đã gửi cho người khác. Null: người chỉ xem và lịch trình chưa có link.
 */
export async function resolveShareToken(
  authFetch: AuthFetch,
  itineraryId: string,
  canCreate: boolean,
): Promise<string | null> {
  const path = `/itineraries/${itineraryId}/share-link`;
  const { link } = await authFetch<CurrentItineraryShareLink>(path);
  if (link) return link.token;
  if (!canCreate) return null;
  return (await authFetch<ItineraryShareLink>(path, { method: 'POST' })).token;
}
```

- [ ] **Step 3: Sửa `onShare`**

Trong `itinerary/[id].tsx`: lấy `const { authFetch } = useAuth();` trong component (đã import `useAuth`), thêm `const [sharing, setSharing] = useState(false);`, import `itineraryShareUrl, resolveShareToken` từ `'@/lib/share-link'`, và thay `onShare`:

```tsx
  const onShare = async () => {
    if (!data || sharing) return;
    setSharing(true);
    try {
      const token = await resolveShareToken(authFetch, data.id, canEdit);
      if (!token) {
        Alert.alert(
          'Chưa có link chia sẻ',
          'Bạn chỉ có quyền xem. Nhờ người tạo hoặc người chỉnh sửa chia sẻ lịch trình một lần để có link.',
        );
        return;
      }
      const destination = regionName ? `tại ${regionName}` : '';
      const title = `Lịch trình du ngoạn ${destination} - Rong Thong Dong`.trim();
      const message = `${title}\nThời gian: ${formatDateRange(data.input.startsAt, data.input.endsAt)} (${data.days.length} ngày)\nXem lịch trình: ${itineraryShareUrl(token)}`;
      await Share.share({ title, message });
    } catch (error) {
      // Người dùng đóng bảng chia sẻ không phải lỗi; chỉ báo khi không lấy được link.
      if (error instanceof ApiError) {
        Alert.alert('Chưa lấy được link', 'Kiểm tra mạng rồi thử lại.');
      }
    } finally {
      setSharing(false);
    }
  };
```

Nút chia sẻ: thêm `disabled={sharing}` và `accessibilityState={{ busy: sharing }}` vào `Pressable`; khi `sharing` hiển thị `<ActivityIndicator color={Colors.light.text} />` thay cho icon `share` (đã import `ActivityIndicator`).

`authFetch` đã bọc lỗi mạng thành `ApiError(0, 'NETWORK_ERROR')` (`lib/api.ts`), nên chỉ cần bắt `ApiError`.

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm build:deps` (nếu chưa), rồi `cd apps/mobile && pnpm typecheck && pnpm lint`
Expected: sạch.

- [ ] **Step 5: Chạy tay**

Với backend + web local đang chạy, `EXPO_PUBLIC_WEB_BASE_URL` trỏ tới IP LAN của máy chạy web (ví dụ `http://192.168.1.10:3000`), chạy `pnpm --filter @rong/mobile start`:
- Owner bấm Chia sẻ → bảng chia sẻ có dòng "Xem lịch trình: …/t/<token>"; mở link trên điện thoại → trang web Task 4.
- Bấm Chia sẻ lần hai → **cùng** token; link lần một vẫn mở được.
- Viewer trong nhóm bấm Chia sẻ → cùng token với owner.
- Lịch trình nhóm chưa có link, viewer bấm Chia sẻ → Alert "Chưa có link chia sẻ", không có request `POST`.
- Tắt mạng rồi bấm → Alert "Chưa lấy được link"; hủy bảng chia sẻ → không có Alert.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/share-link.ts "apps/mobile/src/app/(app)/itinerary/[id].tsx" apps/mobile/.env.example
git commit -m "feat(mobile): share itineraries as a web link that stays the same"
```

---

## Sau khi xong (người dùng tự làm, không thuộc task nào)

1. Deploy `apps/web` (Vercel hoặc Render Web Service, root `apps/web`, build `pnpm --filter @rong/web build`) với `RONG_API_URL` = URL backend trên Render.
2. Trên Render backend: tùy chọn đặt `SHARE_LINK_SECRET` (≥ 32 ký tự) **trước** khi người dùng thật bắt đầu chia sẻ; đổi sau đó thì mọi link cũ không lấy lại được (vẫn mở được cho tới khi bị thay).
3. Đặt `EXPO_PUBLIC_WEB_BASE_URL` = domain web trong env của profile EAS rồi build lại app.

Việc để sau: nút "Tạo link mới / thu hồi link" trên mobile (backend đã có `DELETE`), ảnh OG riêng cho từng lịch trình, nút mở app từ trang web.
