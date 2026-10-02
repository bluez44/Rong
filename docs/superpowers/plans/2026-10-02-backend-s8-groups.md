# S8 — Nhóm & chia sẻ: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm nhóm, link mời, phân quyền chủ nhóm/chỉnh sửa/xem, địa điểm chung của nhóm, nhật ký hoạt động và link xem lịch trình công khai cho web vào backend.

**Architecture:** Module mới `groups/` truy cập database bằng SQL thuần qua `DataSource` (giống `saved-places/`), không thêm entity TypeORM cho các bảng mới. Mọi quyết định phân quyền đi qua một hàm thuần `decide()` trong `groups/access.ts`; `AccessService` đọc vai trò từ database rồi gọi hàm này. `ItinerariesService` thay `findOwned` bằng `authorize(userId, id, action)`. Token link chỉ lưu SHA-256.

**Tech Stack:** NestJS 12 (ESM) · TypeORM 0.3 (SQL thuần + một cột mới trên entity `Itinerary`) · Postgres/PostGIS trên Neon · class-validator · Vitest + supertest

**Spec:** `docs/superpowers/specs/2026-10-02-backend-s8-groups-design.md`

## Global Constraints

- **ESM:** mọi import tương đối trong `apps/backend` có đuôi `.js`, kể cả khi file nguồn là `.ts`.
- **Schema chỉ đổi qua migration**, `synchronize: false`. Migration mới: `1758900000000-CreateGroups.ts`.
- **Database e2e là Neon dùng chung** (`DATABASE_URL` trong `apps/backend/.env`). **Phải hỏi người dùng trước khi chạy `migration:run` lần đầu** (Task 1). Sau khi được đồng ý, các lần chạy `test:e2e` tiếp theo không cần hỏi lại. Dữ liệu test dùng tên hiển thị bắt đầu bằng `e2e-groups` và `osm_id` trong khoảng `-9300 < osm_id <= -9200`, dọn trong `afterAll`.
- **Tiền tố API** `/api` (đặt trong `main.ts` và trong e2e).
- **Lỗi** dạng `{ statusCode, code, message }`, `message` tiếng Việt, cùng giọng văn với `itineraries.service.ts`.
- **Không lộ sự tồn tại:** không có quyền xem → 404; xem được nhưng thiếu quyền thao tác → 403 `FORBIDDEN_ROLE`.
- **Giới hạn:** 20 nhóm mỗi người (`GROUP_LIMIT`, 409), 50 thành viên mỗi nhóm (`GROUP_FULL`, 409), 10 link mời còn hiệu lực mỗi nhóm (`INVITE_LIMIT`, 409), 200 địa điểm chung mỗi nhóm (`GROUP_PLACES_LIMIT`, 409).
- **Link mời** hết hạn sau 7 ngày; **link xem** không hết hạn, mỗi lịch trình tối đa một link còn hiệu lực.
- **Token:** 32 byte ngẫu nhiên, base64url (43 ký tự); database chỉ lưu SHA-256 hex.
- **Gộp nhật ký `itinerary_updated`:** cùng người, cùng lịch trình, dòng mới nhất của nhóm, dưới 10 phút.
- **Lệnh:** unit `pnpm --filter @rong/backend test`; e2e `pnpm --filter @rong/backend test:e2e -- groups`; typecheck `pnpm --filter @rong/backend typecheck`; lint `pnpm --filter @rong/backend lint`.
- **Commit:** Conventional Commits, scope `backend` hoặc `shared-types`, kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Token rác hoặc sai định dạng** ở `/invites/:token`, `/public/itineraries/:token` (chuỗi ngắn, có ký tự lạ, `%00`) → 404, không lỗi 500, không chạm database. Test ở Task 5 và Task 8.
2. **Chấp nhận lời mời hai lần, hoặc chấp nhận link vai trò thấp hơn** → không tạo dòng trùng, không hạ quyền, không ghi nhật ký thừa. Test ở Task 5.
3. **Thành viên bị xóa khỏi nhóm** gọi lại API nhóm hoặc lịch trình của nhóm → 404 ngay, kể cả còn access token cũ. Test ở Task 5 (nhóm) và Task 7 (lịch trình).
4. **Owner tự xóa mình hoặc bị đổi vai trò** → 400 `OWNER_CANNOT_LEAVE` / `CANNOT_CHANGE_OWNER`, nhóm không bao giờ mất owner. Test ở Task 5.
5. **Tạo lại link xem** → link cũ chết ngay (404), chỉ một link sống. Test ở Task 8.

---

## Cấu trúc file

```
packages/shared-types/src/
  group.ts                                       ← Task 1 (viết lại)
  itinerary.ts                                   ← Task 1 (sửa)

apps/backend/src/
  app.module.ts                                  ← Task 3 (sửa)
  database/migrations/1758900000000-CreateGroups.ts   ← Task 1 (tạo)
  modules/groups/
    access.ts, access.spec.ts                    ← Task 2  hàm thuần: decide, atLeast, roleAfterAccept
    tokens.ts, tokens.spec.ts                    ← Task 2  newToken, hashToken, isTokenShape
    errors.ts                                    ← Task 2  helper tạo HttpException
    access.service.ts                            ← Task 3
    activity.ts, activity.spec.ts                ← Task 3  shouldMerge, cursor
    activity.service.ts                          ← Task 3
    groups.module.ts                             ← Task 3 (tạo), Task 5, 6 (sửa)
    dto/groups.dto.ts                            ← Task 4 (tạo), Task 5 (sửa)
    groups.service.ts, groups.controller.ts      ← Task 4 (tạo), Task 6 (sửa controller)
    invites.service.ts, invites.controller.ts    ← Task 5
    group-places.service.ts                      ← Task 6
  modules/itineraries/
    entities/itinerary.entity.ts                 ← Task 1 (thêm groupId)
    itinerary-summaries.ts                       ← Task 4 (tạo), Task 7 (dùng)
    itineraries.service.ts                       ← Task 7
    itineraries.controller.ts                    ← Task 7
    itineraries.module.ts                        ← Task 7, 8
    dto/create-itinerary.dto.ts                  ← Task 7 (thêm groupId)
    dto/move-itinerary.dto.ts                    ← Task 7
    share-links.service.ts, share-links.controller.ts   ← Task 8
  modules/README.md                              ← Task 9
apps/backend/test/groups.e2e-spec.ts             ← Task 4 (tạo), Task 5–9 (thêm describe)
```

---

### Task 1: Kiểu dùng chung, migration và cột `group_id`

**Files:**
- Modify: `packages/shared-types/src/group.ts` (viết lại toàn bộ)
- Modify: `packages/shared-types/src/itinerary.ts`
- Create: `apps/backend/src/database/migrations/1758900000000-CreateGroups.ts`
- Modify: `apps/backend/src/modules/itineraries/entities/itinerary.entity.ts`
- Modify: `apps/backend/src/modules/itineraries/itineraries.service.ts` (chỉ hàm `toResponse`, để còn biên dịch được)

**Interfaces:**
- Produces: các kiểu `GroupRole`, `InviteRole`, `ItineraryRole`, `GroupSummary`, `GroupMember`, `GroupDetail`, `GroupInvite`, `CreatedGroupInvite`, `InvitePreview`, `GroupPlace`, `GroupActivityType`, `GroupActivity`, `PublicItinerary`, `ItineraryShareLink`; `Itinerary.groupId/groupName/myRole`; `ItinerarySummary.groupId/groupName/myRole`; cột `Itinerary.groupId: string | null`.

- [ ] **Step 1: Viết lại `packages/shared-types/src/group.ts`**

```ts
import type { ItinerarySummary } from './itinerary';
import type { PlaceCategory } from './place';

/**
 * Nhóm và chia sẻ — PRD mục 7.2, F10. Thiết kế: spec S8
 * (docs/superpowers/specs/2026-10-02-backend-s8-groups-design.md).
 */
export type GroupRole = 'owner' | 'editor' | 'viewer';

/** Vai trò một link mời có thể cấp. Mặc định 'viewer' — FR-10.4. */
export type InviteRole = Exclude<GroupRole, 'owner'>;

/** Một dòng trong "nhóm của tôi". */
export interface GroupSummary {
  id: string;
  name: string;
  myRole: GroupRole;
  memberCount: number;
  itineraryCount: number;
  createdAt: string;
}

/** Không có email: thành viên chỉ thấy tên hiển thị của nhau. */
export interface GroupMember {
  userId: string;
  displayName: string | null;
  role: GroupRole;
  joinedAt: string;
}

export interface GroupDetail {
  id: string;
  name: string;
  ownerId: string;
  myRole: GroupRole;
  createdAt: string;
  /** Owner trước, rồi editor, rồi viewer; cùng vai trò thì ai vào trước đứng trước. */
  members: GroupMember[];
  itineraries: ItinerarySummary[];
}

/** Link mời còn hiệu lực. Token chỉ trả về đúng một lần, lúc tạo. */
export interface GroupInvite {
  id: string;
  role: InviteRole;
  expiresAt: string;
  createdAt: string;
}

export interface CreatedGroupInvite extends GroupInvite {
  /** Đưa vào deep link. Server chỉ lưu bản băm, không lấy lại được. */
  token: string;
}

/** GET /invites/:token — xem trước, không cần đăng nhập. */
export interface InvitePreview {
  groupName: string;
  inviterName: string | null;
  role: InviteRole;
  memberCount: number;
  expiresAt: string;
}

/** Địa điểm chung của nhóm — FR-10.9. */
export interface GroupPlace {
  placeId: string;
  name: string;
  category: PlaceCategory;
  regionId: string;
  regionName: string;
  addedByName: string | null;
  addedAt: string;
}

export type GroupActivityType =
  | 'member_joined'
  | 'member_left'
  | 'member_removed'
  | 'role_changed'
  | 'group_renamed'
  | 'itinerary_added'
  | 'itinerary_removed'
  | 'itinerary_updated'
  | 'place_added'
  | 'place_removed';

/** Nhật ký hoạt động — FR-10.5. `payload` giữ tên tại thời điểm xảy ra. */
export interface GroupActivity {
  id: string;
  type: GroupActivityType;
  /** null khi tài khoản đã bị xóa — client hiện "Người dùng đã xóa". */
  actorId: string | null;
  actorName: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}
```

- [ ] **Step 2: Sửa `packages/shared-types/src/itinerary.ts`**

Thêm ngay sau dòng `import type { PlaceCategory } from './place';`:

```ts
import type { GroupRole } from './group';

/** Quyền của người đang xem trên một lịch trình: người tạo, hoặc vai trò trong nhóm chứa nó. */
export type ItineraryRole = 'creator' | GroupRole;
```

Trong `interface Itinerary`, thay dòng `groupId?: string | null;` bằng:

```ts
  groupId: string | null;
  groupName: string | null;
  myRole: ItineraryRole;
```

Trong `interface ItinerarySummary`, thêm sau `createdAt: string;`:

```ts
  groupId: string | null;
  groupName: string | null;
  myRole: ItineraryRole;
```

Thêm vào cuối file:

```ts
/** POST /itineraries/:id/share-link. Token chỉ trả về đúng một lần. */
export interface ItineraryShareLink {
  token: string;
  createdAt: string;
}

/**
 * GET /public/itineraries/:token — trang web chỉ xem (FR-10.3). Không có id
 * hay email người dùng, ghi chú riêng, nhóm, hay nội dung Google.
 */
export interface PublicItinerary {
  regionName: string;
  startsAt: string;
  endsAt: string;
  travelParty: TravelParty;
  adults: number;
  children: number;
  planner: PlannerKind;
  days: ItineraryDay[];
  unscheduled: UnscheduledPlace[];
  warnings: ItineraryWarning[];
  tips: string[];
  updatedAt: string;
}
```

(Import vòng chỉ-kiểu giữa `group.ts` và `itinerary.ts` là hợp lệ vì cả hai đều dùng `import type`.)

- [ ] **Step 3: Build shared-types**

Run: `pnpm --filter @rong/shared-types build`
Expected: thoát mã 0, không lỗi.

- [ ] **Step 4: Tạo migration `apps/backend/src/database/migrations/1758900000000-CreateGroups.ts`**

```ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Nhóm & chia sẻ — F10, spec S8. Token link mời và link xem chỉ lưu SHA-256.
 * Xóa tài khoản dựa hoàn toàn vào khóa ngoại (spec S8 mục 6): nhóm của owner
 * bị xóa theo, lịch trình trong nhóm trở thành lịch trình cá nhân.
 */
export class CreateGroups1758900000000 implements MigrationInterface {
  name = 'CreateGroups1758900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "groups" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" text NOT NULL,
        "owner_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_group_owner" FOREIGN KEY ("owner_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "group_members" (
        "group_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "role" text NOT NULL,
        "joined_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_group_member" PRIMARY KEY ("group_id", "user_id"),
        CONSTRAINT "chk_group_member_role" CHECK ("role" IN ('owner', 'editor', 'viewer')),
        CONSTRAINT "fk_group_member_group" FOREIGN KEY ("group_id")
          REFERENCES "groups" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_group_member_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_group_member_user" ON "group_members" ("user_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "group_invites" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "group_id" uuid NOT NULL,
        "token_hash" text NOT NULL,
        "role" text NOT NULL,
        "created_by" uuid,
        "expires_at" timestamptz NOT NULL,
        "revoked_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_group_invite_token" UNIQUE ("token_hash"),
        CONSTRAINT "chk_group_invite_role" CHECK ("role" IN ('editor', 'viewer')),
        CONSTRAINT "fk_group_invite_group" FOREIGN KEY ("group_id")
          REFERENCES "groups" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_group_invite_creator" FOREIGN KEY ("created_by")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_group_invite_group" ON "group_invites" ("group_id")`,
    );
    await queryRunner.query(`
      ALTER TABLE "itineraries" ADD COLUMN "group_id" uuid
        CONSTRAINT "fk_itinerary_group" REFERENCES "groups" ("id") ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_itinerary_group" ON "itineraries" ("group_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "itinerary_share_links" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "itinerary_id" uuid NOT NULL,
        "token_hash" text NOT NULL,
        "created_by" uuid,
        "revoked_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_share_link_token" UNIQUE ("token_hash"),
        CONSTRAINT "fk_share_link_itinerary" FOREIGN KEY ("itinerary_id")
          REFERENCES "itineraries" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_share_link_creator" FOREIGN KEY ("created_by")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_share_link_active" ON "itinerary_share_links" ("itinerary_id") WHERE "revoked_at" IS NULL`,
    );
    await queryRunner.query(`
      CREATE TABLE "group_places" (
        "group_id" uuid NOT NULL,
        "place_id" uuid NOT NULL,
        "region_id" uuid NOT NULL,
        "added_by" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_group_place" PRIMARY KEY ("group_id", "place_id"),
        CONSTRAINT "fk_group_place_group" FOREIGN KEY ("group_id")
          REFERENCES "groups" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_group_place_place" FOREIGN KEY ("place_id")
          REFERENCES "places" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_group_place_region" FOREIGN KEY ("region_id")
          REFERENCES "regions" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_group_place_adder" FOREIGN KEY ("added_by")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "group_activities" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "group_id" uuid NOT NULL,
        "actor_id" uuid,
        "type" text NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_group_activity_group" FOREIGN KEY ("group_id")
          REFERENCES "groups" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_group_activity_actor" FOREIGN KEY ("actor_id")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_group_activity_group_created" ON "group_activities" ("group_id", "created_at" DESC, "id" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "group_activities"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "group_places"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "itinerary_share_links"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_itinerary_group"`);
    await queryRunner.query(
      `ALTER TABLE "itineraries" DROP COLUMN IF EXISTS "group_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "group_invites"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "group_members"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "groups"`);
  }
}
```

- [ ] **Step 5: Thêm cột vào entity `Itinerary`**

Trong `apps/backend/src/modules/itineraries/entities/itinerary.entity.ts`, thêm ngay sau khối `region?: Region;`:

```ts
  /** Nhóm chứa lịch trình (F10); null là lịch trình cá nhân. Xóa nhóm thì về null. */
  @Column({ name: 'group_id', type: 'uuid', nullable: true })
  groupId!: string | null;
```

- [ ] **Step 6: Cho `toResponse` biên dịch được với kiểu mới**

Trong `itineraries.service.ts`, đổi chữ ký và phần đầu của `toResponse` ở cuối file:

```ts
function toResponse(
  it: Itinerary,
  groupName: string | null = null,
  myRole: ItineraryRole = 'creator',
): ItineraryResponse {
  return {
    id: it.id,
    ownerId: it.ownerId,
    groupId: it.groupId,
    groupName,
    myRole,
    regionId: it.regionId,
```

(giữ nguyên các dòng còn lại), thêm `ItineraryRole,` vào danh sách `import type { … } from '@rong/shared-types';` ở đầu file. Trong hàm `list`, thêm ba trường vào object trả về để khớp kiểu (Task 7 sẽ thay hẳn hàm này):

```ts
      createdAt: r.created_at.toISOString(),
      groupId: null,
      groupName: null,
      myRole: 'creator' as const,
```

- [ ] **Step 7: Typecheck backend, mobile, web**

Run: `pnpm --filter @rong/backend typecheck && pnpm --filter @rong/mobile typecheck && pnpm --filter @rong/web typecheck`
Expected: cả ba thoát mã 0. Nếu mobile báo lỗi do tự dựng object `Itinerary`/`ItinerarySummary`, thêm ba trường mới với giá trị `null`, `null`, `'creator'` tại chỗ đó.

- [ ] **Step 8: Hỏi người dùng rồi chạy migration**

Hỏi người dùng: "Task 1 cần chạy migration `CreateGroups` lên database Neon trong `.env`. Chạy không?" Chỉ chạy khi được đồng ý.

Run: `pnpm --filter @rong/backend migration:run`
Expected: log có `Migration CreateGroups1758900000000 has been executed successfully.`

- [ ] **Step 9: Chạy lại unit test**

Run: `pnpm --filter @rong/backend test`
Expected: toàn bộ PASS (161 test như trước).

- [ ] **Step 10: Commit**

```bash
git add packages/shared-types/src/group.ts packages/shared-types/src/itinerary.ts apps/backend/src/database/migrations/1758900000000-CreateGroups.ts apps/backend/src/modules/itineraries/entities/itinerary.entity.ts apps/backend/src/modules/itineraries/itineraries.service.ts
git commit -m "feat(backend): add groups schema and shared types for S8"
```

---

### Task 2: Quy tắc quyền, token, lỗi (hàm thuần)

**Files:**
- Create: `apps/backend/src/modules/groups/access.ts`
- Create: `apps/backend/src/modules/groups/access.spec.ts`
- Create: `apps/backend/src/modules/groups/tokens.ts`
- Create: `apps/backend/src/modules/groups/tokens.spec.ts`
- Create: `apps/backend/src/modules/groups/errors.ts`

**Interfaces:**
- Produces:
  - `type ItineraryAction = 'view' | 'edit' | 'delete' | 'move'`
  - `interface ItineraryAccess { isCreator: boolean; groupRole: GroupRole | null }`
  - `type AccessDecision = 'allow' | 'forbidden' | 'not_found'`
  - `decide(access: ItineraryAccess, action: ItineraryAction): AccessDecision`
  - `atLeast(role: GroupRole | null, min: GroupRole): boolean`
  - `roleAfterAccept(current: GroupRole | null, offered: InviteRole): GroupRole | null` (null = giữ nguyên)
  - `newToken(): string`, `hashToken(token: string): string`, `isTokenShape(token: string): boolean`
  - `errors.ts`: `bad(code, message)`, `notFound(code, message)`, `forbiddenRole()`, `conflict(code, message)`, `gone(code, message)`, `groupNotFound()`, `itineraryNotFound()`

- [ ] **Step 1: Viết test `access.spec.ts`**

```ts
import { describe, expect, it } from 'vitest';

import {
  atLeast,
  decide,
  roleAfterAccept,
  type ItineraryAction,
  type ItineraryAccess,
} from './access.js';

describe('decide — bảng quyền trên lịch trình (spec S8 mục 4.6)', () => {
  const actions: ItineraryAction[] = ['view', 'edit', 'delete', 'move'];
  const cases: Array<[string, ItineraryAccess, string[]]> = [
    // tên, quyền, kết quả theo thứ tự view, edit, delete, move
    ['người tạo, không nhóm', { isCreator: true, groupRole: null }, ['allow', 'allow', 'allow', 'allow']],
    ['người tạo là viewer của nhóm', { isCreator: true, groupRole: 'viewer' }, ['allow', 'allow', 'allow', 'allow']],
    ['owner nhóm', { isCreator: false, groupRole: 'owner' }, ['allow', 'allow', 'allow', 'forbidden']],
    ['editor', { isCreator: false, groupRole: 'editor' }, ['allow', 'allow', 'forbidden', 'forbidden']],
    ['viewer', { isCreator: false, groupRole: 'viewer' }, ['allow', 'forbidden', 'forbidden', 'forbidden']],
    ['không liên quan', { isCreator: false, groupRole: null }, ['not_found', 'not_found', 'not_found', 'not_found']],
  ];

  for (const [name, access, expected] of cases) {
    it(name, () => {
      expect(actions.map((a) => decide(access, a))).toEqual(expected);
    });
  }
});

describe('atLeast', () => {
  it('so vai trò theo thứ bậc viewer < editor < owner', () => {
    expect(atLeast('owner', 'editor')).toBe(true);
    expect(atLeast('editor', 'editor')).toBe(true);
    expect(atLeast('viewer', 'editor')).toBe(false);
    expect(atLeast(null, 'viewer')).toBe(false);
  });
});

describe('roleAfterAccept — chấp nhận lời mời', () => {
  it('chưa là thành viên thì nhận vai trò của link', () => {
    expect(roleAfterAccept(null, 'viewer')).toBe('viewer');
    expect(roleAfterAccept(null, 'editor')).toBe('editor');
  });

  it('chỉ nâng, không bao giờ hạ; owner giữ owner', () => {
    expect(roleAfterAccept('viewer', 'editor')).toBe('editor');
    expect(roleAfterAccept('editor', 'viewer')).toBeNull();
    expect(roleAfterAccept('editor', 'editor')).toBeNull();
    expect(roleAfterAccept('owner', 'editor')).toBeNull();
  });
});
```

- [ ] **Step 2: Viết test `tokens.spec.ts`**

```ts
import { describe, expect, it } from 'vitest';

import { hashToken, isTokenShape, newToken } from './tokens.js';

describe('token link', () => {
  it('43 ký tự base64url, mỗi lần một khác', () => {
    const a = newToken();
    const b = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(isTokenShape(a)).toBe(true);
  });

  it('băm SHA-256 hex, ổn định', () => {
    const t = newToken();
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(hashToken(newToken()));
  });

  it('từ chối chuỗi sai định dạng', () => {
    expect(isTokenShape('')).toBe(false);
    expect(isTokenShape('abc')).toBe(false);
    expect(isTokenShape(`${newToken()}x`)).toBe(false);
    expect(isTokenShape('a'.repeat(42) + '%')).toBe(false);
    expect(isTokenShape('a'.repeat(42) + '\0')).toBe(false);
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận FAIL**

Run: `pnpm --filter @rong/backend exec vitest run src/modules/groups`
Expected: FAIL — không tìm thấy module `./access.js`, `./tokens.js`.

- [ ] **Step 4: Viết `access.ts`**

```ts
import type { GroupRole, InviteRole } from '@rong/shared-types';

/**
 * Quy tắc phân quyền của S8 — nơi duy nhất định nghĩa ai được làm gì. Hàm
 * thuần, không đụng database: `AccessService` đọc vai trò rồi gọi vào đây.
 */
export type ItineraryAction = 'view' | 'edit' | 'delete' | 'move';

export interface ItineraryAccess {
  isCreator: boolean;
  /** Vai trò trong nhóm chứa lịch trình; null khi lịch trình cá nhân hoặc không phải thành viên. */
  groupRole: GroupRole | null;
}

export type AccessDecision = 'allow' | 'forbidden' | 'not_found';

const RANK: Record<GroupRole, number> = { viewer: 1, editor: 2, owner: 3 };

/** Chuyển nhóm (`move`) chỉ người tạo được làm, nên không vai trò nhóm nào có nó. */
const GROUP_ROLE_CAN: Record<GroupRole, ReadonlySet<ItineraryAction>> = {
  owner: new Set(['view', 'edit', 'delete']),
  editor: new Set(['view', 'edit']),
  viewer: new Set(['view']),
};

/** Không xem được thì `not_found` (không lộ lịch trình tồn tại), xem được mà thiếu quyền thì `forbidden`. */
export function decide(
  access: ItineraryAccess,
  action: ItineraryAction,
): AccessDecision {
  if (access.isCreator) return 'allow';
  if (access.groupRole === null) return 'not_found';
  return GROUP_ROLE_CAN[access.groupRole].has(action) ? 'allow' : 'forbidden';
}

export function atLeast(role: GroupRole | null, min: GroupRole): boolean {
  return role !== null && RANK[role] >= RANK[min];
}

/** Vai trò mới sau khi chấp nhận lời mời; null là giữ nguyên. Chỉ nâng, không hạ. */
export function roleAfterAccept(
  current: GroupRole | null,
  offered: InviteRole,
): GroupRole | null {
  if (current === null) return offered;
  return RANK[offered] > RANK[current] ? offered : null;
}
```

- [ ] **Step 5: Viết `tokens.ts`**

```ts
import { createHash, randomBytes } from 'node:crypto';

/**
 * Token của link mời và link xem: 32 byte ngẫu nhiên, base64url. Database chỉ
 * lưu SHA-256 — lộ database không lộ link dùng được. Không cần salt hay so
 * sánh hằng thời gian: token đủ entropy để không thể dò, và tra bằng bản băm.
 */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Chặn chuỗi rác trước khi chạm database. */
export function isTokenShape(token: string): boolean {
  return TOKEN_SHAPE.test(token);
}
```

- [ ] **Step 6: Viết `errors.ts`**

```ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';

export function bad(code: string, message: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, code, message });
}

export function notFound(code: string, message: string): NotFoundException {
  return new NotFoundException({ statusCode: 404, code, message });
}

export function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ statusCode: 409, code, message });
}

export function gone(code: string, message: string): GoneException {
  return new GoneException({ statusCode: 410, code, message });
}

/** Xem được nhưng vai trò không đủ để làm thao tác này. */
export function forbiddenRole(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    code: 'FORBIDDEN_ROLE',
    message: 'Vai trò của bạn trong nhóm không cho phép thao tác này.',
  });
}

export function groupNotFound(): NotFoundException {
  return notFound('GROUP_NOT_FOUND', 'Không tìm thấy nhóm này.');
}

export function itineraryNotFound(): NotFoundException {
  return notFound('ITINERARY_NOT_FOUND', 'Không tìm thấy lịch trình này.');
}
```

- [ ] **Step 7: Chạy test, xác nhận PASS**

Run: `pnpm --filter @rong/backend exec vitest run src/modules/groups`
Expected: PASS — `access.spec.ts` 9 test, `tokens.spec.ts` 3 test.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/modules/groups
git commit -m "feat(backend): add group access rules and link tokens"
```

---

### Task 3: `AccessService`, `ActivityService`, `GroupsModule`

**Files:**
- Create: `apps/backend/src/modules/groups/activity.ts`
- Create: `apps/backend/src/modules/groups/activity.spec.ts`
- Create: `apps/backend/src/modules/groups/access.service.ts`
- Create: `apps/backend/src/modules/groups/activity.service.ts`
- Create: `apps/backend/src/modules/groups/groups.module.ts`
- Modify: `apps/backend/src/app.module.ts`

**Interfaces:**
- Consumes: `decide`, `atLeast`, `ItineraryAccess` (Task 2); `groupNotFound`, `forbiddenRole` (Task 2).
- Produces:
  - `AccessService.groupRole(userId: string, groupId: string, manager?: EntityManager): Promise<GroupRole | null>`
  - `AccessService.requireGroupRole(userId: string, groupId: string, min: GroupRole, manager?: EntityManager): Promise<GroupRole>` — 404 `GROUP_NOT_FOUND` nếu không là thành viên, 403 `FORBIDDEN_ROLE` nếu thấp hơn `min`
  - `AccessService.itineraryAccess(userId: string, itineraryId: string): Promise<ItineraryAccess | null>` — null khi lịch trình không tồn tại
  - `ActivityService.record(manager: EntityManager, groupId: string, actorId: string, type: GroupActivityType, payload: Record<string, unknown>): Promise<void>`
  - `ActivityService.list(groupId: string, cursor: string | undefined): Promise<CursorPage<GroupActivity>>`
  - `GroupsModule` export `AccessService`, `ActivityService`

- [ ] **Step 1: Viết test `activity.spec.ts`**

```ts
import { describe, expect, it } from 'vitest';

import {
  decodeActivityCursor,
  encodeActivityCursor,
  MERGE_WINDOW_MS,
  shouldMerge,
} from './activity.js';

describe('shouldMerge — gộp itinerary_updated', () => {
  const now = new Date('2026-10-02T10:00:00Z');
  const last = {
    type: 'itinerary_updated',
    actorId: 'u1',
    itineraryId: 'i1',
    createdAt: new Date(now.getTime() - 5 * 60 * 1000),
  };
  const next = { type: 'itinerary_updated', actorId: 'u1', itineraryId: 'i1' };

  it('cùng người, cùng lịch trình, dưới 10 phút thì gộp', () => {
    expect(shouldMerge(last, next, now)).toBe(true);
  });

  it('không gộp khi khác người, khác lịch trình, quá 10 phút hoặc khác loại', () => {
    expect(shouldMerge(last, { ...next, actorId: 'u2' }, now)).toBe(false);
    expect(shouldMerge(last, { ...next, itineraryId: 'i2' }, now)).toBe(false);
    expect(
      shouldMerge(
        { ...last, createdAt: new Date(now.getTime() - MERGE_WINDOW_MS) },
        next,
        now,
      ),
    ).toBe(false);
    expect(shouldMerge({ ...last, type: 'place_added' }, next, now)).toBe(false);
    expect(shouldMerge(last, { ...next, type: 'place_added' }, now)).toBe(false);
    expect(shouldMerge(undefined, next, now)).toBe(false);
  });
});

describe('con trỏ nhật ký', () => {
  const id = '3f1c2b4e-8a9d-4c7e-9f0a-1b2c3d4e5f60';
  const t = '2026-10-02 10:00:00.123456+00';

  it('mã hóa rồi giải mã ra đúng giá trị', () => {
    expect(decodeActivityCursor(encodeActivityCursor({ t, id }))).toEqual({ t, id });
  });

  it('con trỏ hỏng thì coi như trang đầu', () => {
    expect(decodeActivityCursor(undefined)).toBeNull();
    expect(decodeActivityCursor('rac')).toBeNull();
    expect(
      decodeActivityCursor(encodeActivityCursor({ t: 'không phải ngày', id })),
    ).toBeNull();
    expect(
      decodeActivityCursor(encodeActivityCursor({ t, id: "x'; DROP TABLE" })),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `pnpm --filter @rong/backend exec vitest run src/modules/groups/activity.spec.ts`
Expected: FAIL — không tìm thấy `./activity.js`.

- [ ] **Step 3: Viết `activity.ts`**

```ts
/** Client tự lưu liên tục (FR-8.9): các lần sửa liền nhau của một người gộp thành một dòng nhật ký. */
export const MERGE_WINDOW_MS = 10 * 60 * 1000;

export interface ActivityKey {
  type: string;
  actorId: string | null;
  itineraryId: string | null;
}

export function shouldMerge(
  last: (ActivityKey & { createdAt: Date }) | undefined,
  next: ActivityKey,
  now: Date,
): boolean {
  return (
    last !== undefined &&
    next.type === 'itinerary_updated' &&
    last.type === 'itinerary_updated' &&
    last.actorId === next.actorId &&
    last.itineraryId === next.itineraryId &&
    now.getTime() - last.createdAt.getTime() < MERGE_WINDOW_MS
  );
}

/**
 * Con trỏ giữ `created_at` dạng chuỗi Postgres (độ chính xác micro giây) cùng
 * id; đổi qua Date của JS sẽ mất phần micro giây và làm lặp hoặc sót dòng.
 */
export interface ActivityCursor {
  t: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeActivityCursor(cursor: ActivityCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeActivityCursor(
  raw: string | undefined,
): ActivityCursor | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Partial<ActivityCursor>;
    if (
      typeof value.t === 'string' &&
      !Number.isNaN(Date.parse(value.t)) &&
      typeof value.id === 'string' &&
      UUID.test(value.id)
    ) {
      return { t: value.t, id: value.id };
    }
  } catch {
    // Con trỏ hỏng: trả trang đầu.
  }
  return null;
}
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Run: `pnpm --filter @rong/backend exec vitest run src/modules/groups/activity.spec.ts`
Expected: PASS — 4 test.

Nếu test `"2026-10-02 10:00:00.123456+00"` FAIL vì `Date.parse` của Node không đọc được dạng có khoảng trắng: đổi điều kiện thành `!Number.isNaN(Date.parse(value.t.replace(' ', 'T')))`. Không đổi chuỗi lưu trong con trỏ.

- [ ] **Step 5: Viết `access.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { GroupRole } from '@rong/shared-types';
import { DataSource, type EntityManager } from 'typeorm';

import { atLeast, type ItineraryAccess } from './access.js';
import { forbiddenRole, groupNotFound } from './errors.js';

/** Đọc vai trò từ database. Quy tắc nằm ở `access.ts`. */
@Injectable()
export class AccessService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async groupRole(
    userId: string,
    groupId: string,
    manager: EntityManager = this.db.manager,
  ): Promise<GroupRole | null> {
    const [row] = (await manager.query(
      `SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [groupId, userId],
    )) as Array<{ role: GroupRole }>;
    return row?.role ?? null;
  }

  /** Không là thành viên → 404 (không lộ nhóm tồn tại); vai trò thấp hơn `min` → 403. */
  async requireGroupRole(
    userId: string,
    groupId: string,
    min: GroupRole,
    manager?: EntityManager,
  ): Promise<GroupRole> {
    const role = await this.groupRole(userId, groupId, manager);
    if (role === null) throw groupNotFound();
    if (!atLeast(role, min)) throw forbiddenRole();
    return role;
  }

  /** null khi lịch trình không tồn tại. */
  async itineraryAccess(
    userId: string,
    itineraryId: string,
  ): Promise<ItineraryAccess | null> {
    const [row] = (await this.db.query(
      `SELECT i.owner_id = $2 AS is_creator, m.role
         FROM itineraries i
         LEFT JOIN group_members m ON m.group_id = i.group_id AND m.user_id = $2
        WHERE i.id = $1`,
      [itineraryId, userId],
    )) as Array<{ is_creator: boolean; role: GroupRole | null }>;
    if (!row) return null;
    return { isCreator: row.is_creator, groupRole: row.role ?? null };
  }
}
```

- [ ] **Step 6: Viết `activity.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  CursorPage,
  GroupActivity,
  GroupActivityType,
} from '@rong/shared-types';
import { DataSource, type EntityManager } from 'typeorm';

import {
  decodeActivityCursor,
  encodeActivityCursor,
  shouldMerge,
} from './activity.js';

const PAGE_SIZE = 20;

interface ActivityRow {
  id: string;
  type: GroupActivityType;
  actor_id: string | null;
  actor_name: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
  t: string;
}

@Injectable()
export class ActivityService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** Gọi trong cùng transaction với thao tác gây ra hoạt động (spec S8 mục 5). */
  async record(
    manager: EntityManager,
    groupId: string,
    actorId: string,
    type: GroupActivityType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (type === 'itinerary_updated') {
      const [last] = (await manager.query(
        `SELECT id, type, actor_id, payload->>'itineraryId' AS itinerary_id, created_at
           FROM group_activities
          WHERE group_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
        [groupId],
      )) as Array<{
        id: string;
        type: string;
        actor_id: string | null;
        itinerary_id: string | null;
        created_at: Date;
      }>;
      const merge = shouldMerge(
        last && {
          type: last.type,
          actorId: last.actor_id,
          itineraryId: last.itinerary_id,
          createdAt: last.created_at,
        },
        {
          type,
          actorId,
          itineraryId: (payload.itineraryId as string | undefined) ?? null,
        },
        new Date(),
      );
      if (merge) {
        await manager.query(
          `UPDATE group_activities SET created_at = now(), payload = $2 WHERE id = $1`,
          [last.id, payload],
        );
        return;
      }
    }
    await manager.query(
      `INSERT INTO group_activities (group_id, actor_id, type, payload) VALUES ($1, $2, $3, $4)`,
      [groupId, actorId, type, payload],
    );
  }

  /** Mới nhất trước. Gọi sau khi đã kiểm tra quyền xem nhóm. */
  async list(
    groupId: string,
    rawCursor: string | undefined,
  ): Promise<CursorPage<GroupActivity>> {
    const cursor = decodeActivityCursor(rawCursor);
    const rows = (await this.db.query(
      `SELECT a.id, a.type, a.actor_id, u.display_name AS actor_name, a.payload,
              a.created_at, a.created_at::text AS t
         FROM group_activities a
         LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.group_id = $1
          AND ($2::timestamptz IS NULL OR (a.created_at, a.id) < ($2::timestamptz, $3::uuid))
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $4`,
      [groupId, cursor?.t ?? null, cursor?.id ?? null, PAGE_SIZE + 1],
    )) as ActivityRow[];
    const page = rows.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    return {
      items: page.map((r) => ({
        id: r.id,
        type: r.type,
        actorId: r.actor_id,
        actorName: r.actor_name,
        payload: r.payload,
        createdAt: r.created_at.toISOString(),
      })),
      nextCursor:
        rows.length > PAGE_SIZE && last
          ? encodeActivityCursor({ t: last.t, id: last.id })
          : null,
    };
  }
}
```

- [ ] **Step 7: Viết `groups.module.ts`**

```ts
import { Module } from '@nestjs/common';

import { AccessService } from './access.service.js';
import { ActivityService } from './activity.service.js';

/** Nhóm & chia sẻ — F10, spec S8. */
@Module({
  providers: [AccessService, ActivityService],
  exports: [AccessService, ActivityService],
})
export class GroupsModule {}
```

- [ ] **Step 8: Đăng ký module trong `app.module.ts`**

Thêm `import { GroupsModule } from './modules/groups/groups.module.js';` vào nhóm import (theo thứ tự chữ cái, sau `AuthModule`), và thêm `GroupsModule,` vào mảng `imports` ngay sau `SavedPlacesModule,`.

- [ ] **Step 9: Typecheck và unit test**

Run: `pnpm --filter @rong/backend typecheck && pnpm --filter @rong/backend test`
Expected: thoát mã 0; toàn bộ PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/backend/src/modules/groups apps/backend/src/app.module.ts
git commit -m "feat(backend): add group access and activity services"
```

---

### Task 4: Nhóm — tạo, xem, đổi tên, xóa, nhật ký

**Files:**
- Create: `apps/backend/src/modules/itineraries/itinerary-summaries.ts`
- Create: `apps/backend/src/modules/groups/dto/groups.dto.ts`
- Create: `apps/backend/src/modules/groups/groups.service.ts`
- Create: `apps/backend/src/modules/groups/groups.controller.ts`
- Modify: `apps/backend/src/modules/groups/groups.module.ts`
- Create: `apps/backend/test/groups.e2e-spec.ts`

**Interfaces:**
- Consumes: `AccessService.requireGroupRole`, `ActivityService.record/list` (Task 3); `conflict`, `bad`, `notFound`, `forbiddenRole` (Task 2).
- Produces:
  - `itinerarySummaries(db: DataSource, userId: string, groupId: string | null): Promise<ItinerarySummary[]>` — `groupId = null` là "của tôi" (tôi tạo hoặc thuộc nhóm tôi tham gia)
  - `MAX_GROUPS_PER_USER = 20`, `MAX_MEMBERS = 50` (export từ `groups.service.ts`)
  - `GroupsService.create(userId, name)`, `.list(userId)`, `.detail(userId, groupId)`, `.rename(userId, groupId, name)`, `.remove(userId, groupId)`, `.changeRole(actorId, groupId, targetUserId, role)`, `.removeMember(actorId, groupId, targetUserId)`, `.activity(userId, groupId, cursor)`, `.countGroupsOf(userId, manager)`, `.displayName(userId, manager)`
  - DTO: `GroupNameDto { name }`, `MemberRoleDto { role }`, `ActivityQueryDto { cursor? }`
  - e2e: biến `app`, `db`, `tokens`, `regionId`, `placeIds`, hàm `call(as)` dùng chung cho Task 5–9

- [ ] **Step 1: Viết `itinerary-summaries.ts`**

```ts
import type { ItinerarySummary, ItineraryRole, PlannerKind } from '@rong/shared-types';
import type { DataSource } from 'typeorm';

/**
 * Danh sách lịch trình kèm quyền của người xem. Dùng chung cho
 * `GET /itineraries` (groupId = null: tôi tạo hoặc thuộc nhóm tôi tham gia) và
 * chi tiết nhóm (chỉ lịch trình của nhóm đó). Là hàm thường, không phải
 * provider, để `GroupsModule` không phải import `ItinerariesModule`.
 */
export async function itinerarySummaries(
  db: DataSource,
  userId: string,
  groupId: string | null,
): Promise<ItinerarySummary[]> {
  const rows = (await db.query(
    `SELECT i.id, i.region_id, r.name AS region_name, i.starts_at, i.ends_at, i.planner,
            jsonb_array_length(i.days) AS day_count, i.created_at,
            i.group_id, g.name AS group_name,
            CASE WHEN i.owner_id = $1 THEN 'creator' ELSE m.role END AS my_role
       FROM itineraries i
       JOIN regions r ON r.id = i.region_id
       LEFT JOIN groups g ON g.id = i.group_id
       LEFT JOIN group_members m ON m.group_id = i.group_id AND m.user_id = $1
      WHERE ${groupId === null ? '(i.owner_id = $1 OR m.user_id IS NOT NULL)' : 'i.group_id = $2'}
      ORDER BY i.created_at DESC
      LIMIT 100`,
    groupId === null ? [userId] : [userId, groupId],
  )) as Array<{
    id: string;
    region_id: string;
    region_name: string;
    starts_at: Date;
    ends_at: Date;
    planner: PlannerKind;
    day_count: number;
    created_at: Date;
    group_id: string | null;
    group_name: string | null;
    my_role: ItineraryRole;
  }>;
  return rows.map((r) => ({
    id: r.id,
    regionId: r.region_id,
    regionName: r.region_name,
    startsAt: r.starts_at.toISOString(),
    endsAt: r.ends_at.toISOString(),
    planner: r.planner,
    dayCount: Number(r.day_count),
    createdAt: r.created_at.toISOString(),
    groupId: r.group_id,
    groupName: r.group_name,
    myRole: r.my_role,
  }));
}
```

- [ ] **Step 2: Viết `dto/groups.dto.ts`**

```ts
import type { InviteRole } from '@rong/shared-types';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class GroupNameDto {
  @Transform(trim)
  @IsString()
  @Length(1, 60, { message: 'Tên nhóm từ 1 đến 60 ký tự.' })
  name!: string;
}

export class MemberRoleDto {
  @IsIn(['editor', 'viewer'])
  role!: InviteRole;
}

export class ActivityQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  cursor?: string;
}
```

- [ ] **Step 3: Viết test e2e `apps/backend/test/groups.e2e-spec.ts`**

```ts
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { LangchainService } from '../src/langchain/langchain.service.js';

/**
 * Nhóm & chia sẻ (S8), chạy trên database thật như itinerary.e2e-spec. Người
 * dùng: a (owner), b (được mời), c (không liên quan). Lịch trình tạo ở chế độ
 * tự sắp xếp nên không gọi AI.
 */
describe('Nhóm & chia sẻ (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  const tokens: Record<'a' | 'b' | 'c', string> = { a: '', b: '', c: '' };
  const userIds: Record<'a' | 'b' | 'c', string> = { a: '', b: '', c: '' };
  let regionId: string;
  const placeIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LangchainService)
      .useValue({ planItinerary: vi.fn(), findPlaces: vi.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    db = app.get(DataSource);
    const jwt = app.get(JwtService);
    const users = (await db.query(
      `INSERT INTO users (display_name)
       VALUES ('e2e-groups-a'), ('e2e-groups-b'), ('e2e-groups-c')
       RETURNING id, display_name`,
    )) as Array<{ id: string; display_name: string }>;
    for (const u of users) {
      const key = u.display_name.slice(-1) as 'a' | 'b' | 'c';
      userIds[key] = u.id;
      tokens[key] = jwt.sign({ sub: u.id });
    }

    [{ id: regionId }] = (await db.query(
      `SELECT id FROM regions WHERE source_key = 'vn:destination:da-lat'`,
    )) as Array<{ id: string }>;

    for (const [i, name] of ['Hồ Tuyền Lâm', 'Đồi chè Cầu Đất'].entries()) {
      const [row] = (await db.query(
        `INSERT INTO places (osm_type, osm_id, name, category, location, composite_score)
         VALUES ('node', $1, $2, 'nature', ST_SetSRID(ST_MakePoint(108.43, 11.9), 4326), 50)
         ON CONFLICT (osm_type, osm_id) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [-9200 - i, `E2E ${name}`],
      )) as Array<{ id: string }>;
      placeIds.push(row.id);
    }
  });

  afterAll(async () => {
    await db?.query(`DELETE FROM users WHERE display_name LIKE 'e2e-groups-%'`);
    await db?.query(
      `DELETE FROM places WHERE osm_id <= -9200 AND osm_id > -9300`,
    );
    await app?.close();
  });

  /** Gọi API với tư cách một người dùng; `null` là không đăng nhập. */
  const call = (as: 'a' | 'b' | 'c' | null) => {
    const server = app.getHttpServer();
    const auth = (req: request.Test) =>
      as === null ? req : req.set('Authorization', `Bearer ${tokens[as]}`);
    return {
      get: (path: string) => auth(request(server).get(`/api${path}`)),
      post: (path: string, body: object = {}) =>
        auth(request(server).post(`/api${path}`)).send(body),
      put: (path: string, body: object = {}) =>
        auth(request(server).put(`/api${path}`)).send(body),
      patch: (path: string, body: object = {}) =>
        auth(request(server).patch(`/api${path}`)).send(body),
      delete: (path: string) => auth(request(server).delete(`/api${path}`)),
    };
  };

  /** Lịch trình tự sắp xếp 2 ngày ở Đà Lạt. */
  const manualTrip = (extra: object = {}) => ({
    regionId,
    planningMode: 'manual',
    startsAt: '2026-10-05T08:00:00+07:00',
    endsAt: '2026-10-06T18:00:00+07:00',
    travelParty: 'friends',
    adults: 2,
    children: 0,
    selectedPlaceIds: [placeIds[0]],
    ...extra,
  });

  describe('nhóm', () => {
    let groupId: string;

    it('tạo nhóm: người tạo là owner, có trong danh sách của mình', async () => {
      const res = await call('a').post('/groups', { name: '  Đà Lạt cuối tuần ' }).expect(201);
      groupId = res.body.id;
      expect(res.body).toMatchObject({
        name: 'Đà Lạt cuối tuần',
        ownerId: userIds.a,
        myRole: 'owner',
        itineraries: [],
      });
      expect(res.body.members).toEqual([
        expect.objectContaining({ userId: userIds.a, role: 'owner', displayName: 'e2e-groups-a' }),
      ]);
      expect(res.body.members[0]).not.toHaveProperty('email');

      const list = await call('a').get('/groups').expect(200);
      expect(list.body).toContainEqual(
        expect.objectContaining({ id: groupId, myRole: 'owner', memberCount: 1, itineraryCount: 0 }),
      );
    });

    it('tên rỗng hoặc quá dài bị từ chối', async () => {
      await call('a').post('/groups', { name: '   ' }).expect(400);
      await call('a').post('/groups', { name: 'x'.repeat(61) }).expect(400);
    });

    it('người ngoài nhóm nhận 404, không phải 403', async () => {
      const res = await call('c').get(`/groups/${groupId}`).expect(404);
      expect(res.body.code).toBe('GROUP_NOT_FOUND');
      await call('c').patch(`/groups/${groupId}`, { name: 'x' }).expect(404);
      await call('c').get(`/groups/${groupId}/activity`).expect(404);
    });

    it('đổi tên ghi nhật ký group_renamed', async () => {
      await call('a').patch(`/groups/${groupId}`, { name: 'Đà Lạt tháng 10' }).expect(200);
      const res = await call('a').get(`/groups/${groupId}/activity`).expect(200);
      expect(res.body.items[0]).toMatchObject({
        type: 'group_renamed',
        actorId: userIds.a,
        actorName: 'e2e-groups-a',
        payload: { from: 'Đà Lạt cuối tuần', to: 'Đà Lạt tháng 10' },
      });
      expect(res.body.nextCursor).toBeNull();
    });

    it('xóa nhóm', async () => {
      await call('a').delete(`/groups/${groupId}`).expect(204);
      await call('a').get(`/groups/${groupId}`).expect(404);
    });

    it('cần đăng nhập', async () => {
      await call(null).get('/groups').expect(401);
    });
  });
});
```

- [ ] **Step 4: Chạy e2e, xác nhận FAIL**

Run: `pnpm --filter @rong/backend test:e2e -- groups`
Expected: FAIL — `POST /api/groups` trả 404 (chưa có route).

- [ ] **Step 5: Viết `groups.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  CursorPage,
  GroupActivity,
  GroupDetail,
  GroupMember,
  GroupRole,
  GroupSummary,
  InviteRole,
} from '@rong/shared-types';
import { DataSource, type EntityManager } from 'typeorm';

import { itinerarySummaries } from '../itineraries/itinerary-summaries.js';
import { AccessService } from './access.service.js';
import { ActivityService } from './activity.service.js';
import { bad, conflict, forbiddenRole, notFound } from './errors.js';

/** Giới hạn chống lạm dụng — spec S8 mục 4.7. */
export const MAX_GROUPS_PER_USER = 20;
export const MAX_MEMBERS = 50;

@Injectable()
export class GroupsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly access: AccessService,
    private readonly activityLog: ActivityService,
  ) {}

  async create(userId: string, name: string): Promise<GroupDetail> {
    const groupId = await this.db.transaction(async (m) => {
      if ((await this.countGroupsOf(userId, m)) >= MAX_GROUPS_PER_USER) {
        throw groupLimit();
      }
      const [{ id }] = (await m.query(
        `INSERT INTO groups (name, owner_id) VALUES ($1, $2) RETURNING id`,
        [name, userId],
      )) as Array<{ id: string }>;
      await m.query(
        `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [id, userId],
      );
      return id;
    });
    return this.detail(userId, groupId);
  }

  async list(userId: string): Promise<GroupSummary[]> {
    const rows = (await this.db.query(
      `SELECT g.id, g.name, m.role, g.created_at,
              (SELECT count(*)::int FROM group_members x WHERE x.group_id = g.id) AS member_count,
              (SELECT count(*)::int FROM itineraries i WHERE i.group_id = g.id) AS itinerary_count
         FROM group_members m
         JOIN groups g ON g.id = m.group_id
        WHERE m.user_id = $1
        ORDER BY g.created_at DESC`,
      [userId],
    )) as Array<{
      id: string;
      name: string;
      role: GroupRole;
      created_at: Date;
      member_count: number;
      itinerary_count: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      myRole: r.role,
      memberCount: r.member_count,
      itineraryCount: r.itinerary_count,
      createdAt: r.created_at.toISOString(),
    }));
  }

  async detail(userId: string, groupId: string): Promise<GroupDetail> {
    const myRole = await this.access.requireGroupRole(userId, groupId, 'viewer');
    const [group] = (await this.db.query(
      `SELECT id, name, owner_id, created_at FROM groups WHERE id = $1`,
      [groupId],
    )) as Array<{ id: string; name: string; owner_id: string; created_at: Date }>;
    const members = (await this.db.query(
      `SELECT m.user_id, u.display_name, m.role, m.joined_at
         FROM group_members m JOIN users u ON u.id = m.user_id
        WHERE m.group_id = $1
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, m.joined_at`,
      [groupId],
    )) as Array<{
      user_id: string;
      display_name: string | null;
      role: GroupRole;
      joined_at: Date;
    }>;
    return {
      id: group.id,
      name: group.name,
      ownerId: group.owner_id,
      myRole,
      createdAt: group.created_at.toISOString(),
      members: members.map(
        (r): GroupMember => ({
          userId: r.user_id,
          displayName: r.display_name,
          role: r.role,
          joinedAt: r.joined_at.toISOString(),
        }),
      ),
      itineraries: await itinerarySummaries(this.db, userId, groupId),
    };
  }

  async rename(userId: string, groupId: string, name: string): Promise<GroupDetail> {
    await this.access.requireGroupRole(userId, groupId, 'owner');
    await this.db.transaction(async (m) => {
      const [{ name: from }] = (await m.query(
        `SELECT name FROM groups WHERE id = $1 FOR UPDATE`,
        [groupId],
      )) as Array<{ name: string }>;
      if (from === name) return;
      await m.query(
        `UPDATE groups SET name = $2, updated_at = now() WHERE id = $1`,
        [groupId, name],
      );
      await this.activityLog.record(m, groupId, userId, 'group_renamed', { from, to: name });
    });
    return this.detail(userId, groupId);
  }

  /** Lịch trình trong nhóm trở thành lịch trình cá nhân (khóa ngoại SET NULL). */
  async remove(userId: string, groupId: string): Promise<void> {
    await this.access.requireGroupRole(userId, groupId, 'owner');
    await this.db.query(`DELETE FROM groups WHERE id = $1`, [groupId]);
  }

  async changeRole(
    actorId: string,
    groupId: string,
    targetUserId: string,
    role: InviteRole,
  ): Promise<GroupDetail> {
    await this.access.requireGroupRole(actorId, groupId, 'owner');
    await this.db.transaction(async (m) => {
      const target = await this.member(m, groupId, targetUserId);
      if (target.role === 'owner') {
        throw bad('CANNOT_CHANGE_OWNER', 'Không đổi được vai trò của chủ nhóm.');
      }
      if (target.role === role) return;
      await m.query(
        `UPDATE group_members SET role = $3 WHERE group_id = $1 AND user_id = $2`,
        [groupId, targetUserId, role],
      );
      await this.activityLog.record(m, groupId, actorId, 'role_changed', {
        userName: target.display_name,
        from: target.role,
        to: role,
      });
    });
    return this.detail(actorId, groupId);
  }

  /** Owner xóa thành viên, hoặc thành viên tự rời. Owner không tự rời được — muốn rời thì xóa nhóm. */
  async removeMember(actorId: string, groupId: string, targetUserId: string): Promise<void> {
    const actorRole = await this.access.requireGroupRole(actorId, groupId, 'viewer');
    const self = actorId === targetUserId;
    if (!self && actorRole !== 'owner') throw forbiddenRole();
    await this.db.transaction(async (m) => {
      const target = await this.member(m, groupId, targetUserId);
      if (target.role === 'owner') {
        throw bad(
          'OWNER_CANNOT_LEAVE',
          'Chủ nhóm không rời nhóm được. Xóa nhóm nếu không dùng nữa.',
        );
      }
      await m.query(
        `DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`,
        [groupId, targetUserId],
      );
      await this.activityLog.record(
        m,
        groupId,
        actorId,
        self ? 'member_left' : 'member_removed',
        { userName: target.display_name },
      );
    });
  }

  async activity(
    userId: string,
    groupId: string,
    cursor: string | undefined,
  ): Promise<CursorPage<GroupActivity>> {
    await this.access.requireGroupRole(userId, groupId, 'viewer');
    return this.activityLog.list(groupId, cursor);
  }

  /** Số nhóm người dùng đang tham gia, kể cả nhóm mình làm owner. */
  async countGroupsOf(userId: string, m: EntityManager): Promise<number> {
    const [{ n }] = (await m.query(
      `SELECT count(*)::int AS n FROM group_members WHERE user_id = $1`,
      [userId],
    )) as Array<{ n: number }>;
    return n;
  }

  async displayName(userId: string, m: EntityManager): Promise<string | null> {
    const [row] = (await m.query(
      `SELECT display_name FROM users WHERE id = $1`,
      [userId],
    )) as Array<{ display_name: string | null }>;
    return row?.display_name ?? null;
  }

  private async member(
    m: EntityManager,
    groupId: string,
    userId: string,
  ): Promise<{ role: GroupRole; display_name: string | null }> {
    const [row] = (await m.query(
      `SELECT m.role, u.display_name
         FROM group_members m JOIN users u ON u.id = m.user_id
        WHERE m.group_id = $1 AND m.user_id = $2
        FOR UPDATE OF m`,
      [groupId, userId],
    )) as Array<{ role: GroupRole; display_name: string | null }>;
    if (!row) throw notFound('MEMBER_NOT_FOUND', 'Người này không ở trong nhóm.');
    return row;
  }
}

export function groupLimit() {
  return conflict(
    'GROUP_LIMIT',
    `Bạn đã tham gia tối đa ${MAX_GROUPS_PER_USER} nhóm. Rời bớt nhóm rồi thử lại.`,
  );
}
```

- [ ] **Step 6: Viết `groups.controller.ts`**

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type {
  CursorPage,
  GroupActivity,
  GroupDetail,
  GroupSummary,
} from '@rong/shared-types';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ActivityQueryDto, GroupNameDto, MemberRoleDto } from './dto/groups.dto.js';
import { GroupsService } from './groups.service.js';

/** Nhóm, thành viên, nhật ký hoạt động — F10. */
@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: GroupNameDto): Promise<GroupDetail> {
    return this.groups.create(user.userId, dto.name);
  }

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<GroupSummary[]> {
    return this.groups.list(user.userId);
  }

  @Get(':id')
  detail(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<GroupDetail> {
    return this.groups.detail(user.userId, id);
  }

  @Patch(':id')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: GroupNameDto,
  ): Promise<GroupDetail> {
    return this.groups.rename(user.userId, id, dto.name);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.groups.remove(user.userId, id);
  }

  @Patch(':id/members/:userId')
  changeRole(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: MemberRoleDto,
  ): Promise<GroupDetail> {
    return this.groups.changeRole(user.userId, id, userId, dto.role);
  }

  /** Owner xóa thành viên (FR-10.7), hoặc tự rời nhóm khi `userId` là chính mình. */
  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    return this.groups.removeMember(user.userId, id, userId);
  }

  @Get(':id/activity')
  activity(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ActivityQueryDto,
  ): Promise<CursorPage<GroupActivity>> {
    return this.groups.activity(user.userId, id, query.cursor);
  }
}
```

- [ ] **Step 7: Đăng ký controller và service trong `groups.module.ts`**

```ts
import { Module } from '@nestjs/common';

import { AccessService } from './access.service.js';
import { ActivityService } from './activity.service.js';
import { GroupsController } from './groups.controller.js';
import { GroupsService } from './groups.service.js';

/** Nhóm & chia sẻ — F10, spec S8. */
@Module({
  controllers: [GroupsController],
  providers: [AccessService, ActivityService, GroupsService],
  exports: [AccessService, ActivityService],
})
export class GroupsModule {}
```

- [ ] **Step 8: Chạy e2e, xác nhận PASS**

Run: `pnpm --filter @rong/backend test:e2e -- groups`
Expected: PASS — 6 test trong `nhóm`.

- [ ] **Step 9: Typecheck, lint, commit**

Run: `pnpm --filter @rong/backend typecheck && pnpm --filter @rong/backend lint`
Expected: thoát mã 0.

```bash
git add apps/backend/src/modules/groups apps/backend/src/modules/itineraries/itinerary-summaries.ts apps/backend/test/groups.e2e-spec.ts
git commit -m "feat(backend): create, rename and delete groups with an activity log"
```

---

### Task 5: Link mời, tham gia, đổi vai trò, xóa thành viên

**Files:**
- Modify: `apps/backend/src/modules/groups/dto/groups.dto.ts`
- Create: `apps/backend/src/modules/groups/invites.service.ts`
- Create: `apps/backend/src/modules/groups/invites.controller.ts`
- Modify: `apps/backend/src/modules/groups/groups.module.ts`
- Modify: `apps/backend/test/groups.e2e-spec.ts`

**Interfaces:**
- Consumes: `newToken`, `hashToken`, `isTokenShape` (Task 2); `roleAfterAccept` (Task 2); `AccessService.requireGroupRole/groupRole`, `ActivityService.record` (Task 3); `GroupsService.detail/countGroupsOf/displayName`, `MAX_GROUPS_PER_USER`, `MAX_MEMBERS`, `groupLimit` (Task 4).
- Produces: `MAX_ACTIVE_INVITES = 10`, `INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000`; `InvitesService.create/listActive/revoke/preview/accept`; DTO `CreateInviteDto { role? }`.

- [ ] **Step 1: Thêm describe vào `groups.e2e-spec.ts`**

Chèn khối này ngay sau `describe('nhóm', …)` (trước dòng `});` cuối cùng của file):

```ts
  describe('link mời và thành viên', () => {
    let groupId: string;
    let viewerInvite: { id: string; token: string };

    beforeAll(async () => {
      const res = await call('a').post('/groups', { name: 'Nhóm mời' }).expect(201);
      groupId = res.body.id;
    });

    it('owner tạo link viewer (mặc định); token chỉ trả một lần', async () => {
      const res = await call('a').post(`/groups/${groupId}/invites`).expect(201);
      viewerInvite = res.body;
      expect(res.body.role).toBe('viewer');
      expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const list = await call('a').get(`/groups/${groupId}/invites`).expect(200);
      expect(list.body).toEqual([
        expect.objectContaining({ id: viewerInvite.id, role: 'viewer' }),
      ]);
      expect(list.body[0]).not.toHaveProperty('token');
    });

    it('xem trước không cần đăng nhập', async () => {
      const res = await call(null).get(`/invites/${viewerInvite.token}`).expect(200);
      expect(res.body).toMatchObject({
        groupName: 'Nhóm mời',
        inviterName: 'e2e-groups-a',
        role: 'viewer',
        memberCount: 1,
      });
    });

    it('token rác trả 404, không lỗi 500', async () => {
      for (const bad of ['abc', 'a'.repeat(43) + 'b', '%00', 'x'.repeat(200)]) {
        const res = await call(null).get(`/invites/${encodeURIComponent(bad)}`);
        expect(res.status).toBe(404);
      }
      const unknown = 'A'.repeat(43);
      expect((await call('b').post(`/invites/${unknown}/accept`)).body.code).toBe('INVITE_NOT_FOUND');
    });

    it('b chấp nhận thành viewer; chấp nhận lại không tạo trùng hay ghi thêm nhật ký', async () => {
      const res = await call('b').post(`/invites/${viewerInvite.token}/accept`).expect(201);
      expect(res.body.myRole).toBe('viewer');
      await call('b').post(`/invites/${viewerInvite.token}/accept`).expect(201);
      const detail = await call('a').get(`/groups/${groupId}`).expect(200);
      expect(detail.body.members.filter((x: { userId: string }) => x.userId === userIds.b)).toHaveLength(1);
      const log = await call('a').get(`/groups/${groupId}/activity`).expect(200);
      expect(log.body.items.filter((x: { type: string }) => x.type === 'member_joined')).toHaveLength(1);
    });

    it('viewer không tạo được link mời', async () => {
      const res = await call('b').post(`/groups/${groupId}/invites`).expect(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
    });

    it('link editor nâng b lên editor; link viewer sau đó không hạ quyền', async () => {
      const editor = await call('a').post(`/groups/${groupId}/invites`, { role: 'editor' }).expect(201);
      const up = await call('b').post(`/invites/${editor.body.token}/accept`).expect(201);
      expect(up.body.myRole).toBe('editor');
      const again = await call('b').post(`/invites/${viewerInvite.token}/accept`).expect(201);
      expect(again.body.myRole).toBe('editor');
    });

    it('link đã thu hồi trả 410', async () => {
      await call('a').delete(`/groups/${groupId}/invites/${viewerInvite.id}`).expect(204);
      const res = await call('c').post(`/invites/${viewerInvite.token}/accept`).expect(410);
      expect(res.body.code).toBe('INVITE_EXPIRED');
      await call(null).get(`/invites/${viewerInvite.token}`).expect(410);
    });

    it('link hết hạn trả 410', async () => {
      const res = await call('a').post(`/groups/${groupId}/invites`).expect(201);
      await db.query(
        `UPDATE group_invites SET expires_at = now() - interval '1 minute' WHERE id = $1`,
        [res.body.id],
      );
      await call('c').post(`/invites/${res.body.token}/accept`).expect(410);
    });

    it('owner đổi vai trò; không đổi được vai trò owner', async () => {
      const res = await call('a')
        .patch(`/groups/${groupId}/members/${userIds.b}`, { role: 'viewer' })
        .expect(200);
      expect(res.body.members).toContainEqual(
        expect.objectContaining({ userId: userIds.b, role: 'viewer' }),
      );
      const own = await call('a')
        .patch(`/groups/${groupId}/members/${userIds.a}`, { role: 'editor' })
        .expect(400);
      expect(own.body.code).toBe('CANNOT_CHANGE_OWNER');
      await call('b').patch(`/groups/${groupId}/members/${userIds.a}`, { role: 'viewer' }).expect(403);
    });

    it('owner không tự rời được; thành viên tự rời rồi mất quyền ngay', async () => {
      const own = await call('a').delete(`/groups/${groupId}/members/${userIds.a}`).expect(400);
      expect(own.body.code).toBe('OWNER_CANNOT_LEAVE');
      await call('b').delete(`/groups/${groupId}/members/${userIds.b}`).expect(204);
      await call('b').get(`/groups/${groupId}`).expect(404);
      const log = await call('a').get(`/groups/${groupId}/activity`).expect(200);
      expect(log.body.items[0]).toMatchObject({
        type: 'member_left',
        payload: { userName: 'e2e-groups-b' },
      });
    });

    it('owner xóa thành viên; người không phải owner không xóa được người khác', async () => {
      const inv = await call('a').post(`/groups/${groupId}/invites`).expect(201);
      await call('b').post(`/invites/${inv.body.token}/accept`).expect(201);
      await call('c').post(`/invites/${inv.body.token}/accept`).expect(201);
      await call('c').delete(`/groups/${groupId}/members/${userIds.b}`).expect(403);
      await call('a').delete(`/groups/${groupId}/members/${userIds.c}`).expect(204);
      await call('c').get(`/groups/${groupId}`).expect(404);
    });

    it('nhóm đầy trả 409 GROUP_FULL', async () => {
      const inv = await call('a').post(`/groups/${groupId}/invites`).expect(201);
      const filler = (await db.query(
        `INSERT INTO users (display_name)
         SELECT 'e2e-groups-fill-' || g FROM generate_series(1, 47) g RETURNING id`,
      )) as Array<{ id: string }>;
      for (const f of filler) {
        await db.query(
          `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'viewer')`,
          [groupId, f.id],
        );
      }
      // a + b + 47 = 49; c vào là 50, người tiếp theo bị chặn.
      await call('c').post(`/invites/${inv.body.token}/accept`).expect(201);
      const [extra] = (await db.query(
        `INSERT INTO users (display_name) VALUES ('e2e-groups-fill-x') RETURNING id`,
      )) as Array<{ id: string }>;
      const token = app.get(JwtService).sign({ sub: extra.id });
      const res = await request(app.getHttpServer())
        .post(`/api/invites/${inv.body.token}/accept`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
      expect(res.body.code).toBe('GROUP_FULL');
    });
  });
```

Thêm ở đầu file cạnh các import: không cần import mới (đã có `JwtService`, `request`).

- [ ] **Step 2: Chạy e2e, xác nhận FAIL**

Run: `pnpm --filter @rong/backend test:e2e -- groups`
Expected: FAIL ở `link mời và thành viên` — `POST /groups/:id/invites` trả 404.

- [ ] **Step 3: Thêm DTO vào `dto/groups.dto.ts`**

```ts
export class CreateInviteDto {
  /** Mặc định 'viewer' — FR-10.4. */
  @IsOptional()
  @IsIn(['editor', 'viewer'])
  role?: InviteRole;
}
```

- [ ] **Step 4: Viết `invites.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  CreatedGroupInvite,
  GroupDetail,
  GroupInvite,
  InvitePreview,
  InviteRole,
} from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { roleAfterAccept } from './access.js';
import { AccessService } from './access.service.js';
import { ActivityService } from './activity.service.js';
import { conflict, gone, notFound } from './errors.js';
import {
  GroupsService,
  groupLimit,
  MAX_GROUPS_PER_USER,
  MAX_MEMBERS,
} from './groups.service.js';
import { hashToken, isTokenShape, newToken } from './tokens.js';

export const MAX_ACTIVE_INVITES = 10;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface InviteRow {
  id: string;
  group_id: string;
  role: InviteRole;
  expires_at: Date;
  revoked_at: Date | null;
}

@Injectable()
export class InvitesService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
    private readonly groups: GroupsService,
  ) {}

  async create(
    userId: string,
    groupId: string,
    role: InviteRole,
  ): Promise<CreatedGroupInvite> {
    await this.access.requireGroupRole(userId, groupId, 'owner');
    const [{ n }] = (await this.db.query(
      `SELECT count(*)::int AS n FROM group_invites
        WHERE group_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [groupId],
    )) as Array<{ n: number }>;
    if (n >= MAX_ACTIVE_INVITES) {
      throw conflict(
        'INVITE_LIMIT',
        `Mỗi nhóm có tối đa ${MAX_ACTIVE_INVITES} link mời còn hiệu lực. Thu hồi bớt rồi thử lại.`,
      );
    }
    const token = newToken();
    const [row] = (await this.db.query(
      `INSERT INTO group_invites (group_id, token_hash, role, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, expires_at, created_at`,
      [groupId, hashToken(token), role, userId, new Date(Date.now() + INVITE_TTL_MS)],
    )) as Array<{ id: string; expires_at: Date; created_at: Date }>;
    return {
      id: row.id,
      role,
      token,
      expiresAt: row.expires_at.toISOString(),
      createdAt: row.created_at.toISOString(),
    };
  }

  async listActive(userId: string, groupId: string): Promise<GroupInvite[]> {
    await this.access.requireGroupRole(userId, groupId, 'owner');
    const rows = (await this.db.query(
      `SELECT id, role, expires_at, created_at FROM group_invites
        WHERE group_id = $1 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC`,
      [groupId],
    )) as Array<{ id: string; role: InviteRole; expires_at: Date; created_at: Date }>;
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      expiresAt: r.expires_at.toISOString(),
      createdAt: r.created_at.toISOString(),
    }));
  }

  /** FR-10.7. Idempotent. */
  async revoke(userId: string, groupId: string, inviteId: string): Promise<void> {
    await this.access.requireGroupRole(userId, groupId, 'owner');
    await this.db.query(
      `UPDATE group_invites SET revoked_at = now()
        WHERE id = $1 AND group_id = $2 AND revoked_at IS NULL`,
      [inviteId, groupId],
    );
  }

  async preview(token: string): Promise<InvitePreview> {
    const hash = this.hashOrThrow(token);
    const [row] = (await this.db.query(
      `SELECT i.id, i.group_id, i.role, i.expires_at, i.revoked_at,
              g.name AS group_name, u.display_name AS inviter_name,
              (SELECT count(*)::int FROM group_members m WHERE m.group_id = i.group_id) AS member_count
         FROM group_invites i
         JOIN groups g ON g.id = i.group_id
         LEFT JOIN users u ON u.id = i.created_by
        WHERE i.token_hash = $1`,
      [hash],
    )) as Array<
      InviteRow & { group_name: string; inviter_name: string | null; member_count: number }
    >;
    this.assertUsable(row);
    return {
      groupName: row.group_name,
      inviterName: row.inviter_name,
      role: row.role,
      memberCount: row.member_count,
      expiresAt: row.expires_at.toISOString(),
    };
  }

  /**
   * Tham gia nhóm. Đã là thành viên thì chỉ nâng vai trò, không hạ. Khóa dòng
   * nhóm để hai người cùng vào lúc nhóm còn một chỗ không vượt giới hạn.
   */
  async accept(userId: string, token: string): Promise<GroupDetail> {
    const hash = this.hashOrThrow(token);
    const groupId = await this.db.transaction(async (m) => {
      const [invite] = (await m.query(
        `SELECT id, group_id, role, expires_at, revoked_at FROM group_invites WHERE token_hash = $1`,
        [hash],
      )) as InviteRow[];
      this.assertUsable(invite);
      await m.query(`SELECT id FROM groups WHERE id = $1 FOR UPDATE`, [invite.group_id]);

      const current = await this.access.groupRole(userId, invite.group_id, m);
      const next = roleAfterAccept(current, invite.role);
      if (next === null) return invite.group_id;

      const userName = await this.groups.displayName(userId, m);
      if (current === null) {
        const [{ n }] = (await m.query(
          `SELECT count(*)::int AS n FROM group_members WHERE group_id = $1`,
          [invite.group_id],
        )) as Array<{ n: number }>;
        if (n >= MAX_MEMBERS) {
          throw conflict('GROUP_FULL', `Nhóm đã đủ ${MAX_MEMBERS} thành viên.`);
        }
        if ((await this.groups.countGroupsOf(userId, m)) >= MAX_GROUPS_PER_USER) {
          throw groupLimit();
        }
        await m.query(
          `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)`,
          [invite.group_id, userId, next],
        );
        await this.activity.record(m, invite.group_id, userId, 'member_joined', {
          userName,
          role: next,
        });
      } else {
        await m.query(
          `UPDATE group_members SET role = $3 WHERE group_id = $1 AND user_id = $2`,
          [invite.group_id, userId, next],
        );
        await this.activity.record(m, invite.group_id, userId, 'role_changed', {
          userName,
          from: current,
          to: next,
        });
      }
      return invite.group_id;
    });
    return this.groups.detail(userId, groupId);
  }

  private hashOrThrow(token: string): string {
    if (!isTokenShape(token)) throw inviteNotFound();
    return hashToken(token);
  }

  private assertUsable(row: InviteRow | undefined): asserts row is InviteRow {
    if (!row) throw inviteNotFound();
    if (row.revoked_at !== null || row.expires_at.getTime() <= Date.now()) {
      throw gone('INVITE_EXPIRED', 'Link mời đã hết hạn hoặc bị thu hồi. Xin link mới từ chủ nhóm.');
    }
  }
}

function inviteNotFound() {
  return notFound('INVITE_NOT_FOUND', 'Link mời không hợp lệ.');
}
```

- [ ] **Step 5: Viết `invites.controller.ts`**

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type {
  CreatedGroupInvite,
  GroupDetail,
  GroupInvite,
  InvitePreview,
} from '@rong/shared-types';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/public.decorator.js';
import { CreateInviteDto } from './dto/groups.dto.js';
import { InvitesService } from './invites.service.js';

/** Link mời nhóm — FR-10.2, 10.4, 10.7. */
@Controller()
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Post('groups/:id/invites')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateInviteDto,
  ): Promise<CreatedGroupInvite> {
    return this.invites.create(user.userId, id, dto.role ?? 'viewer');
  }

  @Get('groups/:id/invites')
  list(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<GroupInvite[]> {
    return this.invites.listActive(user.userId, id);
  }

  @Delete('groups/:id/invites/:inviteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('inviteId', new ParseUUIDPipe()) inviteId: string,
  ): Promise<void> {
    return this.invites.revoke(user.userId, id, inviteId);
  }

  /** Xem trước lời mời trước khi đăng nhập hoặc cài app. */
  @Public()
  @Get('invites/:token')
  preview(@Param('token') token: string): Promise<InvitePreview> {
    return this.invites.preview(token);
  }

  @Post('invites/:token/accept')
  accept(
    @CurrentUser() user: AuthUser,
    @Param('token') token: string,
  ): Promise<GroupDetail> {
    return this.invites.accept(user.userId, token);
  }
}
```

- [ ] **Step 6: Đăng ký trong `groups.module.ts`**

Thêm `import { InvitesController } from './invites.controller.js';` và `import { InvitesService } from './invites.service.js';`; đổi `controllers: [GroupsController, InvitesController]`, `providers: [AccessService, ActivityService, GroupsService, InvitesService]`.

- [ ] **Step 7: Chạy e2e, xác nhận PASS**

Run: `pnpm --filter @rong/backend test:e2e -- groups`
Expected: PASS — `nhóm` 6 test, `link mời và thành viên` 12 test.

- [ ] **Step 8: Typecheck, lint, commit**

Run: `pnpm --filter @rong/backend typecheck && pnpm --filter @rong/backend lint`

```bash
git add apps/backend/src/modules/groups apps/backend/test/groups.e2e-spec.ts
git commit -m "feat(backend): invite links, member roles and leaving groups"
```

---

### Task 6: Địa điểm chung của nhóm (FR-10.9)

**Files:**
- Create: `apps/backend/src/modules/groups/group-places.service.ts`
- Modify: `apps/backend/src/modules/groups/groups.controller.ts`
- Modify: `apps/backend/src/modules/groups/groups.module.ts`
- Modify: `apps/backend/test/groups.e2e-spec.ts`

**Interfaces:**
- Consumes: `AccessService.requireGroupRole`, `ActivityService.record` (Task 3); `bad`, `notFound`, `conflict` (Task 2); `SavePlaceDto` (có sẵn ở `saved-places/dto/save-place.dto.ts`).
- Produces: `MAX_GROUP_PLACES = 200`; `GroupPlacesService.list(userId, groupId): Promise<GroupPlace[]>`, `.add(userId, groupId, placeId, regionId): Promise<void>`, `.remove(userId, groupId, placeId): Promise<void>`.

- [ ] **Step 1: Thêm describe vào `groups.e2e-spec.ts`** (sau `describe('link mời và thành viên', …)`)

```ts
  describe('địa điểm chung', () => {
    let groupId: string;

    beforeAll(async () => {
      groupId = (await call('a').post('/groups', { name: 'Nhóm địa điểm' }).expect(201)).body.id;
      const viewer = await call('a').post(`/groups/${groupId}/invites`).expect(201);
      await call('c').post(`/invites/${viewer.body.token}/accept`).expect(201);
      const editor = await call('a').post(`/groups/${groupId}/invites`, { role: 'editor' }).expect(201);
      await call('b').post(`/invites/${editor.body.token}/accept`).expect(201);
    });

    it('editor thêm, mọi thành viên thấy, thêm lại không đổi', async () => {
      await call('b').put(`/groups/${groupId}/places/${placeIds[0]}`, { regionId }).expect(204);
      await call('b').put(`/groups/${groupId}/places/${placeIds[0]}`, { regionId }).expect(204);
      const res = await call('c').get(`/groups/${groupId}/places`).expect(200);
      expect(res.body).toEqual([
        expect.objectContaining({
          placeId: placeIds[0],
          name: 'E2E Hồ Tuyền Lâm',
          category: 'nature',
          regionId,
          addedByName: 'e2e-groups-b',
        }),
      ]);
      const log = await call('a').get(`/groups/${groupId}/activity`).expect(200);
      expect(log.body.items.filter((x: { type: string }) => x.type === 'place_added')).toHaveLength(1);
    });

    it('viewer không thêm, không xóa được', async () => {
      await call('c').put(`/groups/${groupId}/places/${placeIds[1]}`, { regionId }).expect(403);
      await call('c').delete(`/groups/${groupId}/places/${placeIds[0]}`).expect(403);
    });

    it('địa điểm hoặc vùng không tồn tại', async () => {
      const missing = '00000000-0000-0000-0000-000000000000';
      expect((await call('b').put(`/groups/${groupId}/places/${missing}`, { regionId }).expect(404)).body.code).toBe('PLACE_NOT_FOUND');
      expect((await call('b').put(`/groups/${groupId}/places/${placeIds[1]}`, { regionId: missing }).expect(400)).body.code).toBe('UNKNOWN_REGION');
    });

    it('xóa ghi nhật ký place_removed; xóa lần nữa vẫn 204', async () => {
      await call('b').delete(`/groups/${groupId}/places/${placeIds[0]}`).expect(204);
      await call('b').delete(`/groups/${groupId}/places/${placeIds[0]}`).expect(204);
      expect((await call('a').get(`/groups/${groupId}/places`).expect(200)).body).toEqual([]);
      const log = await call('a').get(`/groups/${groupId}/activity`).expect(200);
      expect(log.body.items[0]).toMatchObject({
        type: 'place_removed',
        payload: { placeId: placeIds[0], placeName: 'E2E Hồ Tuyền Lâm' },
      });
    });
  });
```

- [ ] **Step 2: Chạy e2e, xác nhận FAIL**

Run: `pnpm --filter @rong/backend test:e2e -- groups`
Expected: FAIL ở `địa điểm chung` — route `PUT /groups/:id/places/:placeId` trả 404.

- [ ] **Step 3: Viết `group-places.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { GroupPlace, PlaceCategory } from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { AccessService } from './access.service.js';
import { ActivityService } from './activity.service.js';
import { bad, conflict, notFound } from './errors.js';

export const MAX_GROUP_PLACES = 200;

/** Danh sách địa điểm chung của nhóm — FR-10.9. Viewer chỉ xem. */
@Injectable()
export class GroupPlacesService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
  ) {}

  async list(userId: string, groupId: string): Promise<GroupPlace[]> {
    await this.access.requireGroupRole(userId, groupId, 'viewer');
    const rows = (await this.db.query(
      `SELECT gp.place_id, p.name, p.category, gp.region_id, r.name AS region_name,
              pr.name AS parent_name, u.display_name AS added_by_name, gp.created_at
         FROM group_places gp
         JOIN places p ON p.id = gp.place_id
         JOIN regions r ON r.id = gp.region_id
         LEFT JOIN regions pr ON pr.id = r.parent_id
         LEFT JOIN users u ON u.id = gp.added_by
        WHERE gp.group_id = $1
        ORDER BY gp.created_at DESC`,
      [groupId],
    )) as Array<{
      place_id: string;
      name: string;
      category: PlaceCategory;
      region_id: string;
      region_name: string;
      parent_name: string | null;
      added_by_name: string | null;
      created_at: Date;
    }>;
    return rows.map((r) => ({
      placeId: r.place_id,
      name: r.name,
      category: r.category,
      regionId: r.region_id,
      regionName: r.parent_name ? `${r.region_name}, ${r.parent_name}` : r.region_name,
      addedByName: r.added_by_name,
      addedAt: r.created_at.toISOString(),
    }));
  }

  /** Đã có thì giữ nguyên (không đổi vùng, không ghi nhật ký). */
  async add(userId: string, groupId: string, placeId: string, regionId: string): Promise<void> {
    await this.access.requireGroupRole(userId, groupId, 'editor');
    const [check] = (await this.db.query(
      `SELECT (SELECT name FROM places WHERE id = $1) AS place_name,
              EXISTS (SELECT 1 FROM regions WHERE id = $2) AS region,
              (SELECT count(*)::int FROM group_places WHERE group_id = $3) AS n,
              EXISTS (SELECT 1 FROM group_places WHERE group_id = $3 AND place_id = $1) AS already`,
      [placeId, regionId, groupId],
    )) as Array<{ place_name: string | null; region: boolean; n: number; already: boolean }>;
    if (check.place_name === null) {
      throw notFound('PLACE_NOT_FOUND', 'Không tìm thấy địa điểm này.');
    }
    if (!check.region) throw bad('UNKNOWN_REGION', 'Không tìm thấy vùng này.');
    if (check.already) return;
    if (check.n >= MAX_GROUP_PLACES) {
      throw conflict(
        'GROUP_PLACES_LIMIT',
        `Danh sách chung tối đa ${MAX_GROUP_PLACES} địa điểm. Bỏ bớt rồi thử lại.`,
      );
    }
    await this.db.transaction(async (m) => {
      const inserted = (await m.query(
        `INSERT INTO group_places (group_id, place_id, region_id, added_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (group_id, place_id) DO NOTHING
         RETURNING place_id`,
        [groupId, placeId, regionId, userId],
      )) as unknown[];
      if (inserted.length === 0) return;
      await this.activity.record(m, groupId, userId, 'place_added', {
        placeId,
        placeName: check.place_name,
      });
    });
  }

  async remove(userId: string, groupId: string, placeId: string): Promise<void> {
    await this.access.requireGroupRole(userId, groupId, 'editor');
    await this.db.transaction(async (m) => {
      // TypeORM trả DELETE/UPDATE dạng [rows, rowCount], khác INSERT/SELECT.
      const [rows] = (await m.query(
        `DELETE FROM group_places gp USING places p
          WHERE gp.group_id = $1 AND gp.place_id = $2 AND p.id = gp.place_id
          RETURNING p.name`,
        [groupId, placeId],
      )) as [Array<{ name: string }>, number];
      const row = rows[0];
      if (!row) return;
      await this.activity.record(m, groupId, userId, 'place_removed', {
        placeId,
        placeName: row.name,
      });
    });
  }
}
```

Lưu ý: `DataSource/EntityManager.query()` của TypeORM (Postgres) trả `[rows, rowCount]` cho `UPDATE` và `DELETE`, nhưng trả mảng dòng cho `SELECT` và `INSERT` (đã kiểm tra trong `PostgresQueryRunner.js`). Đừng đọc kết quả `UPDATE`/`DELETE` như mảng dòng.

- [ ] **Step 4: Thêm route vào `groups.controller.ts`**

Thêm import:

```ts
import { Put } from '@nestjs/common';   // gộp vào khối import '@nestjs/common' sẵn có
import type { GroupPlace } from '@rong/shared-types';   // gộp vào khối import type sẵn có
import { SavePlaceDto } from '../saved-places/dto/save-place.dto.js';
import { GroupPlacesService } from './group-places.service.js';
```

Đổi constructor thành:

```ts
  constructor(
    private readonly groups: GroupsService,
    private readonly places: GroupPlacesService,
  ) {}
```

Thêm vào cuối class:

```ts
  /** Địa điểm chung của nhóm — FR-10.9. PUT/DELETE idempotent như "Muốn đi". */
  @Get(':id/places')
  listPlaces(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<GroupPlace[]> {
    return this.places.list(user.userId, id);
  }

  @Put(':id/places/:placeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  addPlace(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('placeId', new ParseUUIDPipe()) placeId: string,
    @Body() dto: SavePlaceDto,
  ): Promise<void> {
    return this.places.add(user.userId, id, placeId, dto.regionId);
  }

  @Delete(':id/places/:placeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removePlace(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('placeId', new ParseUUIDPipe()) placeId: string,
  ): Promise<void> {
    return this.places.remove(user.userId, id, placeId);
  }
```

- [ ] **Step 5: Đăng ký `GroupPlacesService` trong `groups.module.ts`, chạy e2e**

Thêm `GroupPlacesService` vào `providers` (và import).

Run: `pnpm --filter @rong/backend test:e2e -- groups`
Expected: PASS — thêm 4 test `địa điểm chung`.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `pnpm --filter @rong/backend typecheck && pnpm --filter @rong/backend lint`

```bash
git add apps/backend/src/modules/groups apps/backend/test/groups.e2e-spec.ts
git commit -m "feat(backend): shared place list for groups"
```

---

### Task 7: Lịch trình trong nhóm — quyền, danh sách, tạo, chuyển nhóm

**Files:**
- Modify: `apps/backend/src/modules/itineraries/itineraries.service.ts`
- Modify: `apps/backend/src/modules/itineraries/itineraries.controller.ts`
- Modify: `apps/backend/src/modules/itineraries/itineraries.module.ts`
- Modify: `apps/backend/src/modules/itineraries/dto/create-itinerary.dto.ts`
- Create: `apps/backend/src/modules/itineraries/dto/move-itinerary.dto.ts`
- Modify: `apps/backend/test/groups.e2e-spec.ts`

**Interfaces:**
- Consumes: `decide`, `ItineraryAccess`, `ItineraryAction` (Task 2); `forbiddenRole`, `itineraryNotFound` (Task 2); `AccessService`, `ActivityService`, `GroupsModule` (Task 3); `itinerarySummaries` (Task 4).
- Produces: `ItinerariesService.authorize(userId: string, id: string, action: ItineraryAction): Promise<{ itinerary: Itinerary; access: ItineraryAccess }>` (public, dùng ở Task 8); `ItinerariesService.move(userId, id, groupId: string | null)`.

- [ ] **Step 1: Thêm describe vào `groups.e2e-spec.ts`** (sau `describe('địa điểm chung', …)`)

```ts
  describe('lịch trình trong nhóm', () => {
    let groupId: string;
    let tripId: string;

    /** Gửi lại đúng các ngày hiện có — đủ để PUT hợp lệ. */
    const unchanged = (trip: { days: Array<{ id: string }>; unscheduled: Array<{ placeId: string }> }) => ({
      days: trip.days.map((d) => ({ id: d.id, items: [] })),
      unscheduledPlaceIds: trip.unscheduled.map((u) => u.placeId),
    });

    beforeAll(async () => {
      groupId = (await call('a').post('/groups', { name: 'Nhóm lịch trình' }).expect(201)).body.id;
      const viewer = await call('a').post(`/groups/${groupId}/invites`).expect(201);
      await call('b').post(`/invites/${viewer.body.token}/accept`).expect(201);
    });

    it('owner tạo lịch trình trong nhóm; viewer không tạo được', async () => {
      const res = await call('a').post('/itineraries', manualTrip({ groupId })).expect(201);
      tripId = res.body.id;
      expect(res.body).toMatchObject({ groupId, groupName: 'Nhóm lịch trình', myRole: 'creator' });
      const denied = await call('b').post('/itineraries', manualTrip({ groupId })).expect(403);
      expect(denied.body.code).toBe('FORBIDDEN_ROLE');
      await call('c').post('/itineraries', manualTrip({ groupId })).expect(404);
    });

    it('viewer thấy trong danh sách và xem được, nhưng không sửa, không xóa', async () => {
      const list = await call('b').get('/itineraries').expect(200);
      expect(list.body).toContainEqual(
        expect.objectContaining({ id: tripId, groupId, groupName: 'Nhóm lịch trình', myRole: 'viewer' }),
      );
      const trip = await call('b').get(`/itineraries/${tripId}`).expect(200);
      expect(trip.body.myRole).toBe('viewer');
      await call('b').get(`/itineraries/${tripId}/alternatives?placeId=${placeIds[0]}`).expect(200);
      expect((await call('b').put(`/itineraries/${tripId}`, unchanged(trip.body)).expect(403)).body.code).toBe('FORBIDDEN_ROLE');
      await call('b').delete(`/itineraries/${tripId}`).expect(403);
    });

    it('người ngoài nhóm nhận 404', async () => {
      await call('c').get(`/itineraries/${tripId}`).expect(404);
      expect((await call('c').get('/itineraries').expect(200)).body.map((x: { id: string }) => x.id)).not.toContain(tripId);
    });

    it('editor sửa được; nhiều lần sửa liền nhau gộp thành một dòng nhật ký', async () => {
      const inv = await call('a').post(`/groups/${groupId}/invites`, { role: 'editor' }).expect(201);
      await call('b').post(`/invites/${inv.body.token}/accept`).expect(201);
      const trip = await call('b').get(`/itineraries/${tripId}`).expect(200);
      await call('b').put(`/itineraries/${tripId}`, unchanged(trip.body)).expect(200);
      await call('b').put(`/itineraries/${tripId}`, unchanged(trip.body)).expect(200);
      const log = await call('a').get(`/groups/${groupId}/activity`).expect(200);
      const updates = log.body.items.filter((x: { type: string }) => x.type === 'itinerary_updated');
      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({ actorId: userIds.b, payload: { itineraryId: tripId } });
      await call('b').delete(`/itineraries/${tripId}`).expect(403);
    });

    it('chỉ người tạo chuyển được lịch trình giữa các nhóm', async () => {
      const personal = await call('b').post('/itineraries', manualTrip()).expect(201);
      expect(personal.body.groupId).toBeNull();
      const moved = await call('b').patch(`/itineraries/${personal.body.id}/group`, { groupId }).expect(200);
      expect(moved.body).toMatchObject({ groupId, groupName: 'Nhóm lịch trình', myRole: 'creator' });
      expect((await call('a').get(`/itineraries/${personal.body.id}`).expect(200)).body.myRole).toBe('owner');
      await call('a').patch(`/itineraries/${personal.body.id}/group`, { groupId: null }).expect(403);
      const out = await call('b').patch(`/itineraries/${personal.body.id}/group`, { groupId: null }).expect(200);
      expect(out.body.groupId).toBeNull();
      await call('a').get(`/itineraries/${personal.body.id}`).expect(404);
      await call('c').patch(`/itineraries/${personal.body.id}/group`, { groupId }).expect(404);
    });

    it('không chuyển được vào nhóm mình chỉ là viewer', async () => {
      const other = (await call('a').post('/groups', { name: 'Nhóm chỉ xem' }).expect(201)).body.id;
      const inv = await call('a').post(`/groups/${other}/invites`).expect(201);
      await call('b').post(`/invites/${inv.body.token}/accept`).expect(201);
      const mine = await call('b').post('/itineraries', manualTrip()).expect(201);
      await call('b').patch(`/itineraries/${mine.body.id}/group`, { groupId: other }).expect(403);
    });

    it('thành viên bị xóa khỏi nhóm mất quyền với lịch trình của nhóm ngay', async () => {
      await call('a').delete(`/groups/${groupId}/members/${userIds.b}`).expect(204);
      await call('b').get(`/itineraries/${tripId}`).expect(404);
    });

    it('owner nhóm xóa được lịch trình của người khác trong nhóm', async () => {
      const inv = await call('a').post(`/groups/${groupId}/invites`, { role: 'editor' }).expect(201);
      await call('b').post(`/invites/${inv.body.token}/accept`).expect(201);
      const theirs = await call('b').post('/itineraries', manualTrip({ groupId })).expect(201);
      await call('a').delete(`/itineraries/${theirs.body.id}`).expect(204);
      await call('b').get(`/itineraries/${theirs.body.id}`).expect(404);
    });
  });
```

- [ ] **Step 2: Chạy e2e, xác nhận FAIL**

Run: `pnpm --filter @rong/backend test:e2e -- groups`
Expected: FAIL ở `lịch trình trong nhóm` — `POST /itineraries` với `groupId` trả 400 (`property groupId should not exist`).

- [ ] **Step 3: Thêm `groupId` vào `CreateItineraryDto`**

Trong `dto/create-itinerary.dto.ts`, thêm vào cuối class (`IsOptional`, `IsUUID` đã được import):

```ts
  /** Tạo trong nhóm (FR-6.8): người tạo phải là owner hoặc editor của nhóm. */
  @IsOptional()
  @IsUUID()
  groupId?: string | null;
```

- [ ] **Step 4: Tạo `dto/move-itinerary.dto.ts`**

```ts
import { IsUUID, ValidateIf } from 'class-validator';

/** PATCH /itineraries/:id/group — null là đưa ra khỏi nhóm. */
export class MoveItineraryDto {
  @ValidateIf((o: MoveItineraryDto) => o.groupId !== null)
  @IsUUID()
  groupId!: string | null;
}
```

- [ ] **Step 5: Sửa `itineraries.module.ts`**

Thêm `import { GroupsModule } from '../groups/groups.module.js';` và `GroupsModule,` vào mảng `imports`.

- [ ] **Step 6: Sửa `itineraries.service.ts`**

6a. Import — thêm:

```ts
import type { EntityManager } from 'typeorm';   // gộp: `import { DataSource, Repository, type EntityManager } from 'typeorm';`
import { decide, type ItineraryAccess, type ItineraryAction } from '../groups/access.js';
import { AccessService } from '../groups/access.service.js';
import { ActivityService } from '../groups/activity.service.js';
import { forbiddenRole, itineraryNotFound } from '../groups/errors.js';
import { itinerarySummaries } from './itinerary-summaries.js';
```

Xóa `NotFoundException` khỏi import `@nestjs/common` nếu không còn dùng.

6b. Constructor — thêm hai tham số cuối:

```ts
    private readonly access: AccessService,
    private readonly activity: ActivityService,
```

6c. Trong `create`, ngay sau dòng `const region = await this.regionName(input.regionId);`, thêm:

```ts
    // FR-6.8: lịch trình tạo trong nhóm thuộc nhóm đó; viewer không tạo được.
    const groupId = dto.groupId ?? null;
    if (groupId) await this.access.requireGroupRole(ownerId, groupId, 'editor');
```

Thay khối `const saved = await this.itineraries.save(…); return toResponse(saved);` ở cuối `create` bằng:

```ts
    const saved = await this.db.transaction(async (m) => {
      const it = await m.save(
        this.itineraries.create({
          ownerId,
          regionId: input.regionId,
          groupId,
          planner,
          startsAt: new Date(start),
          endsAt: new Date(end),
          input,
          days: outDays,
          unscheduled: dedupeUnscheduled(unscheduled),
          warnings,
          tips,
        }),
      );
      await this.logToGroup(m, it, ownerId, 'itinerary_added', region);
      return it;
    });
    return this.respond(saved, { isCreator: true, groupRole: null });
```

6d. Thay toàn bộ hàm `list` bằng:

```ts
  /** Lịch trình tôi tạo và lịch trình thuộc nhóm tôi tham gia. */
  async list(userId: string): Promise<ItinerarySummary[]> {
    return itinerarySummaries(this.db, userId, null);
  }
```

6e. Thay `get`:

```ts
  async get(userId: string, id: string): Promise<ItineraryResponse> {
    const { itinerary, access } = await this.authorize(userId, id, 'view');
    return this.respond(itinerary, access);
  }
```

6f. Trong `update`: đổi `const itinerary = await this.findOwned(ownerId, id);` thành `const { itinerary, access } = await this.authorize(ownerId, id, 'edit');`, và thay dòng cuối `return toResponse(await this.itineraries.save(itinerary));` bằng:

```ts
    const region = await this.regionName(itinerary.regionId);
    const saved = await this.db.transaction(async (m) => {
      const it = await m.save(itinerary);
      await this.logToGroup(m, it, ownerId, 'itinerary_updated', region);
      return it;
    });
    return this.respond(saved, access);
```

6g. Trong `alternatives`: đổi `const itinerary = await this.findOwned(ownerId, id);` thành `const { itinerary } = await this.authorize(ownerId, id, 'view');`.

6h. Thay `remove`:

```ts
  async remove(userId: string, id: string): Promise<void> {
    const { itinerary } = await this.authorize(userId, id, 'delete');
    const region = await this.regionName(itinerary.regionId);
    await this.db.transaction(async (m) => {
      await this.logToGroup(m, itinerary, userId, 'itinerary_removed', region);
      await m.delete(Itinerary, { id: itinerary.id });
    });
  }

  /** Chỉ người tạo; nhóm đích phải là nơi mình là owner hoặc editor. */
  async move(userId: string, id: string, groupId: string | null): Promise<ItineraryResponse> {
    const { itinerary, access } = await this.authorize(userId, id, 'move');
    if (itinerary.groupId === groupId) return this.respond(itinerary, access);
    if (groupId) await this.access.requireGroupRole(userId, groupId, 'editor');
    const region = await this.regionName(itinerary.regionId);
    const before = { ...itinerary };
    itinerary.groupId = groupId;
    const saved = await this.db.transaction(async (m) => {
      await this.logToGroup(m, before, userId, 'itinerary_removed', region);
      const it = await m.save(itinerary);
      await this.logToGroup(m, it, userId, 'itinerary_added', region);
      return it;
    });
    return this.respond(saved, access);
  }
```

6i. Thay `findOwned` bằng:

```ts
  /**
   * Kiểm tra quyền theo bảng ở spec S8 mục 4.6. Không xem được thì 404 như
   * không tồn tại, để không lộ id hợp lệ; xem được mà thiếu quyền thì 403.
   */
  async authorize(
    userId: string,
    id: string,
    action: ItineraryAction,
  ): Promise<{ itinerary: Itinerary; access: ItineraryAccess }> {
    const access = await this.access.itineraryAccess(userId, id);
    const decision = access ? decide(access, action) : 'not_found';
    if (decision === 'not_found') throw itineraryNotFound();
    if (decision === 'forbidden') throw forbiddenRole();
    const itinerary = await this.itineraries.findOneBy({ id });
    if (!itinerary) throw itineraryNotFound();
    return { itinerary, access: access! };
  }

  private async respond(it: Itinerary, access: ItineraryAccess): Promise<ItineraryResponse> {
    let groupName: string | null = null;
    if (it.groupId) {
      const [row] = (await this.db.query(`SELECT name FROM groups WHERE id = $1`, [
        it.groupId,
      ])) as Array<{ name: string }>;
      groupName = row?.name ?? null;
    }
    return toResponse(it, groupName, access.isCreator ? 'creator' : access.groupRole!);
  }

  private async logToGroup(
    m: EntityManager,
    it: Pick<Itinerary, 'id' | 'groupId'>,
    actorId: string,
    type: 'itinerary_added' | 'itinerary_updated' | 'itinerary_removed',
    regionName: string,
  ): Promise<void> {
    if (!it.groupId) return;
    await this.activity.record(m, it.groupId, actorId, type, {
      itineraryId: it.id,
      regionName,
    });
  }
```

Đổi tên tham số `ownerId` thành `userId` trong `update` và `alternatives` không bắt buộc; giữ nguyên nếu muốn diff nhỏ.

6j. Trong `toResponse`, bỏ giá trị mặc định đã thêm ở Task 1 (`groupName: string | null`, `myRole: ItineraryRole` không còn `= …`), vì mọi chỗ gọi giờ đều truyền đủ.

- [ ] **Step 7: Thêm route chuyển nhóm vào `itineraries.controller.ts`**

Thêm `Patch` vào import `@nestjs/common`, `import { MoveItineraryDto } from './dto/move-itinerary.dto.js';`, và route sau `update`:

```ts
  /** Chuyển lịch trình vào nhóm hoặc ra khỏi nhóm (`groupId: null`). Chỉ người tạo. */
  @Patch(':id/group')
  move(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MoveItineraryDto,
  ): Promise<Itinerary> {
    return this.itineraries.move(user.userId, id, dto.groupId);
  }
```

- [ ] **Step 8: Chạy e2e nhóm và các e2e lịch trình cũ**

Run: `pnpm --filter @rong/backend test:e2e`
Expected: PASS toàn bộ, gồm `itinerary.e2e-spec.ts`, `saved-places.e2e-spec.ts`, `account.e2e-spec.ts` và 8 test mới `lịch trình trong nhóm`.

- [ ] **Step 9: Unit test, typecheck, lint, commit**

Run: `pnpm --filter @rong/backend test && pnpm --filter @rong/backend typecheck && pnpm --filter @rong/backend lint`

```bash
git add apps/backend/src/modules/itineraries apps/backend/test/groups.e2e-spec.ts
git commit -m "feat(backend): share itineraries with groups by role"
```

---

### Task 8: Link xem lịch trình trên web

**Files:**
- Create: `apps/backend/src/modules/itineraries/share-links.service.ts`
- Create: `apps/backend/src/modules/itineraries/share-links.controller.ts`
- Modify: `apps/backend/src/modules/itineraries/itineraries.module.ts`
- Modify: `apps/backend/test/groups.e2e-spec.ts`

**Interfaces:**
- Consumes: `ItinerariesService.authorize` (Task 7); `newToken`, `hashToken`, `isTokenShape` (Task 2); `notFound` (Task 2).
- Produces: `ShareLinksService.create(userId, itineraryId): Promise<ItineraryShareLink>`, `.revoke(userId, itineraryId): Promise<void>`, `.getPublic(token): Promise<PublicItinerary>`.

- [ ] **Step 1: Thêm describe vào `groups.e2e-spec.ts`** (sau `describe('lịch trình trong nhóm', …)`)

```ts
  describe('link xem lịch trình', () => {
    let tripId: string;
    let groupId: string;

    beforeAll(async () => {
      groupId = (await call('a').post('/groups', { name: 'Nhóm chia sẻ web' }).expect(201)).body.id;
      const inv = await call('a').post(`/groups/${groupId}/invites`).expect(201);
      await call('c').post(`/invites/${inv.body.token}/accept`).expect(201);
      tripId = (
        await call('a')
          .post('/itineraries', manualTrip({ groupId, notes: 'ghi chú riêng tư' }))
          .expect(201)
      ).body.id;
    });

    it('xem công khai không cần đăng nhập, không lộ dữ liệu riêng', async () => {
      const link = await call('a').post(`/itineraries/${tripId}/share-link`).expect(201);
      expect(link.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const res = await call(null).get(`/public/itineraries/${link.body.token}`).expect(200);
      expect(res.body).toMatchObject({ travelParty: 'friends', adults: 2, children: 0, planner: 'manual' });
      expect(typeof res.body.regionName).toBe('string');
      expect(res.body.days).toHaveLength(2);
      const raw = JSON.stringify(res.body);
      for (const secret of [userIds.a, groupId, 'ghi chú riêng tư', 'aiEditsRemaining', 'ownerId']) {
        expect(raw).not.toContain(secret);
      }
    });

    it('tạo lại thì link cũ chết ngay; thu hồi thì link mới chết', async () => {
      const first = await call('a').post(`/itineraries/${tripId}/share-link`).expect(201);
      const second = await call('a').post(`/itineraries/${tripId}/share-link`).expect(201);
      expect((await call(null).get(`/public/itineraries/${first.body.token}`).expect(404)).body.code).toBe('SHARE_LINK_NOT_FOUND');
      await call(null).get(`/public/itineraries/${second.body.token}`).expect(200);
      await call('a').delete(`/itineraries/${tripId}/share-link`).expect(204);
      await call('a').delete(`/itineraries/${tripId}/share-link`).expect(204);
      await call(null).get(`/public/itineraries/${second.body.token}`).expect(404);
    });

    it('viewer không tạo được link; người ngoài nhận 404', async () => {
      await call('c').post(`/itineraries/${tripId}/share-link`).expect(403);
      await call('b').post(`/itineraries/${tripId}/share-link`).expect(404);
    });

    it('token rác trả 404', async () => {
      for (const bad of ['abc', 'A'.repeat(43), '%00']) {
        await call(null).get(`/public/itineraries/${encodeURIComponent(bad)}`).expect(404);
      }
    });
  });
```

(Ở thời điểm này `b` không ở trong "Nhóm chia sẻ web" nên nhận 404.)

- [ ] **Step 2: Chạy e2e, xác nhận FAIL**

Run: `pnpm --filter @rong/backend test:e2e -- groups`
Expected: FAIL ở `link xem lịch trình` — `POST /itineraries/:id/share-link` trả 404.

- [ ] **Step 3: Viết `share-links.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  ItineraryDay,
  ItineraryInput,
  ItineraryShareLink,
  ItineraryWarning,
  PlannerKind,
  PublicItinerary,
  UnscheduledPlace,
} from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { notFound } from '../groups/errors.js';
import { hashToken, isTokenShape, newToken } from '../groups/tokens.js';
import { ItinerariesService } from './itineraries.service.js';

/**
 * Link xem lịch trình trên web (FR-10.3). Mỗi lịch trình tối đa một link còn
 * hiệu lực; tạo lại thì link cũ bị thu hồi. Không hết hạn.
 */
@Injectable()
export class ShareLinksService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly itineraries: ItinerariesService,
  ) {}

  async create(userId: string, itineraryId: string): Promise<ItineraryShareLink> {
    await this.itineraries.authorize(userId, itineraryId, 'edit');
    const token = newToken();
    const createdAt = await this.db.transaction(async (m) => {
      await m.query(
        `UPDATE itinerary_share_links SET revoked_at = now()
          WHERE itinerary_id = $1 AND revoked_at IS NULL`,
        [itineraryId],
      );
      const [row] = (await m.query(
        `INSERT INTO itinerary_share_links (itinerary_id, token_hash, created_by)
         VALUES ($1, $2, $3) RETURNING created_at`,
        [itineraryId, hashToken(token), userId],
      )) as Array<{ created_at: Date }>;
      return row.created_at;
    });
    return { token, createdAt: createdAt.toISOString() };
  }

  async revoke(userId: string, itineraryId: string): Promise<void> {
    await this.itineraries.authorize(userId, itineraryId, 'edit');
    await this.db.query(
      `UPDATE itinerary_share_links SET revoked_at = now()
        WHERE itinerary_id = $1 AND revoked_at IS NULL`,
      [itineraryId],
    );
  }

  /** Chỉ dữ liệu riêng của app; không id người dùng, ghi chú, nhóm hay nội dung Google. */
  async getPublic(token: string): Promise<PublicItinerary> {
    if (!isTokenShape(token)) throw shareLinkNotFound();
    const [row] = (await this.db.query(
      `SELECT i.input, i.planner, i.starts_at, i.ends_at, i.days, i.unscheduled,
              i.warnings, i.tips, i.updated_at, r.name AS region_name, pr.name AS parent_name
         FROM itinerary_share_links s
         JOIN itineraries i ON i.id = s.itinerary_id
         JOIN regions r ON r.id = i.region_id
         LEFT JOIN regions pr ON pr.id = r.parent_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL`,
      [hashToken(token)],
    )) as Array<{
      input: ItineraryInput;
      planner: PlannerKind;
      starts_at: Date;
      ends_at: Date;
      days: ItineraryDay[];
      unscheduled: UnscheduledPlace[];
      warnings: ItineraryWarning[];
      tips: string[];
      updated_at: Date;
      region_name: string;
      parent_name: string | null;
    }>;
    if (!row) throw shareLinkNotFound();
    return {
      regionName: row.parent_name ? `${row.region_name}, ${row.parent_name}` : row.region_name,
      startsAt: row.starts_at.toISOString(),
      endsAt: row.ends_at.toISOString(),
      travelParty: row.input.travelParty,
      adults: row.input.adults,
      children: row.input.children,
      planner: row.planner,
      days: row.days,
      unscheduled: row.unscheduled,
      warnings: row.warnings,
      tips: row.tips,
      updatedAt: row.updated_at.toISOString(),
    };
  }
}

function shareLinkNotFound() {
  return notFound('SHARE_LINK_NOT_FOUND', 'Link xem lịch trình không tồn tại hoặc đã bị thu hồi.');
}
```

- [ ] **Step 4: Viết `share-links.controller.ts`**

```ts
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type { ItineraryShareLink, PublicItinerary } from '@rong/shared-types';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/public.decorator.js';
import { ShareLinksService } from './share-links.service.js';

/** Link xem lịch trình trên web — FR-10.3. Trang `/t/[token]` của apps/web gọi route công khai. */
@Controller()
export class ShareLinksController {
  constructor(private readonly links: ShareLinksService) {}

  @Post('itineraries/:id/share-link')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ItineraryShareLink> {
    return this.links.create(user.userId, id);
  }

  @Delete('itineraries/:id/share-link')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.links.revoke(user.userId, id);
  }

  @Public()
  @Get('public/itineraries/:token')
  view(@Param('token') token: string): Promise<PublicItinerary> {
    return this.links.getPublic(token);
  }
}
```

- [ ] **Step 5: Đăng ký trong `itineraries.module.ts`**

Thêm import hai file mới; `controllers: [ItinerariesController, ShareLinksController]`, `providers: [ItinerariesService, ShareLinksService]`.

- [ ] **Step 6: Chạy e2e, xác nhận PASS**

Run: `pnpm --filter @rong/backend test:e2e -- groups`
Expected: PASS — thêm 4 test `link xem lịch trình`.

- [ ] **Step 7: Typecheck, lint, commit**

Run: `pnpm --filter @rong/backend typecheck && pnpm --filter @rong/backend lint`

```bash
git add apps/backend/src/modules/itineraries apps/backend/test/groups.e2e-spec.ts
git commit -m "feat(backend): public view links for itineraries"
```

---

### Task 9: Xóa tài khoản, tài liệu, kiểm tra cuối

**Files:**
- Modify: `apps/backend/test/groups.e2e-spec.ts`
- Modify: `apps/backend/src/modules/README.md`

**Interfaces:**
- Consumes: mọi route ở Task 4–8; `DELETE /users/me` có sẵn.

- [ ] **Step 1: Thêm describe cuối cùng vào `groups.e2e-spec.ts`** (sau `describe('link xem lịch trình', …)`; phải là khối cuối vì xóa tài khoản `a`)

```ts
  describe('xóa tài khoản owner', () => {
    it('nhóm biến mất, lịch trình của thành viên trở thành cá nhân', async () => {
      const groupId = (await call('a').post('/groups', { name: 'Nhóm sắp mất' }).expect(201)).body.id;
      const inv = await call('a').post(`/groups/${groupId}/invites`, { role: 'editor' }).expect(201);
      await call('b').post(`/invites/${inv.body.token}/accept`).expect(201);
      const trip = await call('b').post('/itineraries', manualTrip({ groupId })).expect(201);
      const ownTrip = await call('a').post('/itineraries', manualTrip({ groupId })).expect(201);

      await call('a').delete('/users/me').expect(204);

      await call('b').get(`/groups/${groupId}`).expect(404);
      const after = await call('b').get(`/itineraries/${trip.body.id}`).expect(200);
      expect(after.body).toMatchObject({ groupId: null, groupName: null, myRole: 'creator' });
      await call('b').get(`/itineraries/${ownTrip.body.id}`).expect(404);
      const [{ n }] = (await db.query(
        `SELECT count(*)::int AS n FROM group_activities WHERE group_id = $1`,
        [groupId],
      )) as Array<{ n: number }>;
      expect(n).toBe(0);
    });
  });
```

- [ ] **Step 2: Chạy e2e**

Run: `pnpm --filter @rong/backend test:e2e -- groups`
Expected: PASS — không cần code mới, khóa ngoại lo hết. Nếu FAIL, sửa khóa ngoại bằng một migration mới (không sửa `1758900000000`) và ghi lý do vào commit.

- [ ] **Step 3: Cập nhật `apps/backend/src/modules/README.md`**

Trong bảng module, thay dòng `groups/` bằng:

```
| `groups/` | F10 | Nhóm, link mời, phân quyền (`access.ts` là nơi duy nhất định nghĩa quy tắc), địa điểm chung, nhật ký hoạt động |
```

thêm dòng ngay sau dòng `itineraries/`:

```
| `saved-places/` | F9 | Danh sách "Muốn đi" |
```

và sửa mô tả `itineraries/` thành `Tạo (AI hoặc tự sắp xếp), sửa, đổi điểm tương tự, chia sẻ trong nhóm và link xem công khai. Chi phí (F7) để sau`.

Thêm vào cuối file:

````markdown
## Nhóm & chia sẻ (F10, S8)

```
POST   /api/groups                            tạo nhóm (người tạo là owner)
GET    /api/groups                            nhóm tôi tham gia
GET    /api/groups/:id                        thành viên + lịch trình của nhóm
PATCH  /api/groups/:id                        đổi tên (owner)
DELETE /api/groups/:id                        xóa nhóm (owner); lịch trình thành cá nhân
PATCH  /api/groups/:id/members/:userId        đổi vai trò editor ↔ viewer (owner)
DELETE /api/groups/:id/members/:userId        xóa thành viên (owner) / tự rời
GET    /api/groups/:id/activity?cursor=       nhật ký hoạt động
GET|PUT|DELETE /api/groups/:id/places[/:placeId]   địa điểm chung (FR-10.9)
POST|GET|DELETE /api/groups/:id/invites[/:inviteId] link mời (owner)
GET    /api/invites/:token                    [công khai] xem trước lời mời
POST   /api/invites/:token/accept             tham gia
PATCH  /api/itineraries/:id/group             chuyển lịch trình vào/ra nhóm (người tạo)
POST|DELETE /api/itineraries/:id/share-link   link xem trên web
GET    /api/public/itineraries/:token         [công khai] lịch trình chỉ đọc cho apps/web /t/[token]
```

- **Quyền** quyết định ở `groups/access.ts#decide`. Không xem được → 404, thiếu
  quyền → 403 `FORBIDDEN_ROLE`. `ItinerariesService.authorize` là cổng duy nhất
  vào một lịch trình.
- **Token** link mời và link xem chỉ lưu SHA-256; token thô trả về đúng một lần.
- **Xóa tài khoản** không cần code riêng: khóa ngoại xóa nhóm của owner, đưa lịch
  trình trong nhóm về cá nhân, để trống `actor_id` trong nhật ký.
- Đồng bộ real-time và xung đột theo từng mục (FR-10.5, 10.6) là lát S9.
````

- [ ] **Step 4: Kiểm tra toàn bộ**

Run: `pnpm --filter @rong/backend test && pnpm --filter @rong/backend test:e2e && pnpm --filter @rong/backend typecheck && pnpm --filter @rong/backend lint && pnpm --filter @rong/mobile typecheck && pnpm --filter @rong/web typecheck`
Expected: tất cả thoát mã 0. Ghi lại số test pass của unit và e2e để báo cáo.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/test/groups.e2e-spec.ts apps/backend/src/modules/README.md
git commit -m "docs(backend): document groups and sharing endpoints"
```
