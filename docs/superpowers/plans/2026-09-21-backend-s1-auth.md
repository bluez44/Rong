# S1 — Nền tảng backend & Auth: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng lớp nền dùng chung cho toàn bộ backend, cộng với xác thực bằng email/mật khẩu có hỗ trợ tài khoản dùng thử nâng cấp tại chỗ.

**Architecture:** NestJS 12 chạy ESM, TypeORM trên Postgres. Danh tính tách khỏi người dùng (`auth_identities` ↔ `users`) để thêm Google OAuth sau này chỉ là một dòng insert. Access token là JWT 15 phút; refresh token là chuỗi ngẫu nhiên lưu dạng hash trong database, xoay vòng mỗi lần dùng và thu hồi được.

**Tech Stack:** NestJS 12 · TypeORM 0.3 · Postgres 16 · `@nestjs/jwt` · `@node-rs/argon2` · `@nestjs/throttler` + Redis · `@nestjs/schedule` · Vitest

**Spec:** `docs/superpowers/specs/2026-09-21-backend-s1-auth-design.md`

## Global Constraints

Mọi task đều phải tuân thủ những điều dưới đây.

- **ESM:** `apps/backend/package.json` có `"type": "module"` và tsconfig dùng `moduleResolution: nodenext`. **Mọi import tương đối phải có đuôi `.js`**, kể cả khi file nguồn là `.ts`. Ví dụ: `import { AppError } from '../errors/app-error.js'`.
- **Không dùng `synchronize`:** schema chỉ đổi qua migration. `synchronize: false` đã được đặt sẵn.
- **Tiền tố API:** mọi route nằm dưới `/api` (đặt bằng `setGlobalPrefix('api')` trong `main.ts`).
- **Vòng đời token:** access token 15 phút (900 giây); refresh token 60 ngày.
- **Tham số argon2id:** `memoryCost` 19456, `timeCost` 2, `parallelism` 1.
- **Giữ guest:** xóa tài khoản guest không hoạt động sau 30 ngày.
- **Chuẩn hóa email:** hạ chữ thường và cắt khoảng trắng trước khi ghi hoặc so sánh.
- **Thông báo lỗi bằng tiếng Việt**, khớp với giọng văn sẵn có trong `src/config/configuration.ts` và `src/modules/health/health.service.ts`.
- **Lệnh chạy test:** `pnpm --filter @rong/backend test` (unit) và `pnpm --filter @rong/backend test:e2e` (cần `pnpm infra:up` trước).
- **Quy ước commit:** Conventional Commits, kết thúc bằng dòng `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Cấu trúc file

```
packages/shared-types/src/
  auth.ts                                   ← Task 2 (tạo)
  pagination.ts                             ← Task 2 (tạo)
  index.ts                                  ← Task 2 (sửa)

apps/backend/src/
  common/
    errors/app-error.ts                     ← Task 1 (tạo)
    errors/all-exceptions.filter.ts         ← Task 1 (tạo), Task 11 (sửa)
    request-id/request-id.middleware.ts     ← Task 1 (tạo)
  config/configuration.ts                   ← Task 2 (sửa)
  database/migrations/
    1758100000000-CreateUsersAndAuth.ts     ← Task 3 (tạo)
  modules/
    users/
      entities/user.entity.ts               ← Task 3 (tạo)
      users.service.ts                      ← Task 10 (tạo)
      users.controller.ts                   ← Task 10 (tạo)
      users.module.ts                       ← Task 10 (tạo)
      guest-cleanup.service.ts              ← Task 12 (tạo)
    auth/
      entities/auth-identity.entity.ts      ← Task 3 (tạo)
      entities/refresh-token.entity.ts      ← Task 3 (tạo)
      email.ts                              ← Task 4 (tạo)
      password.service.ts                   ← Task 4 (tạo)
      token.service.ts                      ← Task 5 (tạo)
      refresh-token.service.ts              ← Task 6 (tạo)
      jwt-auth.guard.ts                     ← Task 7 (tạo)
      current-user.decorator.ts             ← Task 7 (tạo)
      dto/auth.dto.ts                       ← Task 7 (tạo), Task 9 (sửa)
      auth.service.ts                       ← Task 7 (tạo), Task 8+9 (sửa)
      auth.controller.ts                    ← Task 7 (tạo), Task 8+9 (sửa)
      auth.module.ts                        ← Task 7 (tạo)
  app.module.ts                             ← Task 1, 7, 10, 11, 12 (sửa)
  main.ts                                   ← Task 1 (sửa)

apps/backend/test/
  auth-journey.e2e-spec.ts                  ← Task 13 (tạo)
```

Nguyên tắc chia: mỗi service có đúng một trách nhiệm và test được độc lập. `PasswordService` chỉ biết băm, `TokenService` chỉ biết JWT, `RefreshTokenService` chỉ biết vòng đời refresh token trong database. `AuthService` ghép chúng lại thành các trường hợp sử dụng. Nhờ vậy ba service đầu test được mà không cần database.

---

### Task 1: Khuôn lỗi thống nhất và request id

**Files:**
- Create: `apps/backend/src/common/errors/app-error.ts`
- Create: `apps/backend/src/common/errors/all-exceptions.filter.ts`
- Create: `apps/backend/src/common/errors/all-exceptions.filter.spec.ts`
- Create: `apps/backend/src/common/request-id/request-id.middleware.ts`
- Modify: `apps/backend/src/main.ts`
- Modify: `apps/backend/src/app.module.ts`

**Interfaces:**
- Consumes: không có.
- Produces: `AppError` (class, constructor `(code: ErrorCode, status: number, message: string)`), kiểu `ErrorCode`, `AllExceptionsFilter`, `requestIdMiddleware`, kiểu `RequestWithId`.

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/backend/src/common/errors/all-exceptions.filter.spec.ts`:

```ts
import { HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AppError } from './app-error.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function buildHost() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ requestId: 'req-1', url: '/api/test' }),
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  it('giữ nguyên mã lỗi và trạng thái của AppError', () => {
    const { host, status, json } = buildHost();

    new AllExceptionsFilter().catch(
      new AppError('EMAIL_TAKEN', 409, 'Email này đã được đăng ký.'),
      host,
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      statusCode: 409,
      code: 'EMAIL_TAKEN',
      message: 'Email này đã được đăng ký.',
      requestId: 'req-1',
    });
  });

  it('đổi lỗi 400 của Nest thành VALIDATION_FAILED', () => {
    const { host, status, json } = buildHost();

    new AllExceptionsFilter().catch(
      new HttpException('Bad Request', HttpStatus.BAD_REQUEST),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0][0].code).toBe('VALIDATION_FAILED');
  });

  it('không để lộ chi tiết nội bộ khi gặp lỗi không lường trước', () => {
    const { host, status, json } = buildHost();

    new AllExceptionsFilter().catch(new Error('connection string = postgres://u:p@h'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json.mock.calls[0][0].code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain('postgres://');
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận nó thất bại**

Run: `pnpm --filter @rong/backend test`
Expected: FAIL — không resolve được `./app-error.js` và `./all-exceptions.filter.js`.

- [ ] **Step 3: Viết `app-error.ts`**

```ts
/**
 * Lỗi nghiệp vụ có mã ổn định để client xử lý theo.
 *
 * `message` dành cho người đọc và có thể đổi; `code` là hợp đồng với client
 * nên không đổi.
 */
export type ErrorCode =
  | 'EMAIL_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_REFRESH_TOKEN'
  | 'NOT_A_GUEST'
  | 'RATE_LIMITED'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
```

- [ ] **Step 4: Viết `all-exceptions.filter.ts`**

```ts
import { Catch, HttpException, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';

import { AppError, type ErrorCode } from './app-error.js';

interface ErrorBody {
  statusCode: number;
  code: ErrorCode;
  message: string;
  requestId: string;
}

function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'VALIDATION_FAILED';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    default:
      return 'INTERNAL_ERROR';
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<{
      status: (code: number) => { json: (body: ErrorBody) => void };
    }>();
    const request = http.getRequest<{ requestId?: string; url?: string }>();
    const requestId = request.requestId ?? '';

    const body = this.toBody(exception, requestId);

    if (body.statusCode >= 500) {
      // Chi tiết thật chỉ đi vào log, không đi ra response.
      this.logger.error(
        `[${requestId}] ${request.url ?? ''} — ${String(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown, requestId: string): ErrorBody {
    if (exception instanceof AppError) {
      return {
        statusCode: exception.status,
        code: exception.code,
        message: exception.message,
        requestId,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        statusCode: status,
        code: codeForStatus(status),
        message: exception.message,
        requestId,
      };
    }

    return {
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Có lỗi xảy ra phía máy chủ.',
      requestId,
    };
  }
}
```

- [ ] **Step 5: Viết `request-id.middleware.ts`**

```ts
import { randomUUID } from 'node:crypto';

export interface RequestWithId {
  requestId: string;
}

interface ResponseLike {
  setHeader: (name: string, value: string) => void;
}

/**
 * Gán cho mỗi request một id để nối được log với response mà người dùng nhận.
 * Dùng randomUUID của Node: id chỉ cần duy nhất, không cần sắp xếp được.
 */
export function requestIdMiddleware(
  req: Partial<RequestWithId>,
  res: ResponseLike,
  next: () => void,
): void {
  const id = randomUUID();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}
```

- [ ] **Step 6: Chạy test để xác nhận nó pass**

Run: `pnpm --filter @rong/backend test`
Expected: PASS — 3 test mới cộng 2 test health cũ.

- [ ] **Step 7: Gắn filter và middleware vào ứng dụng**

Sửa `apps/backend/src/main.ts` — thêm import và đăng ký filter:

```ts
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors();

  const port = configService.get<number>('port') ?? 3001;
  await app.listen(port);

  Logger.log(`Rong backend đang chạy tại http://localhost:${port}/api`, 'Bootstrap');
}

await bootstrap();
```

Sửa `apps/backend/src/app.module.ts` để chạy middleware:

```ts
import { Module } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { requestIdMiddleware } from './common/request-id/request-id.middleware.js';
import { loadConfig } from './config/configuration.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [loadConfig],
      envFilePath: ['.env.local', '.env'],
    }),
    DatabaseModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestIdMiddleware).forRoutes('*');
  }
}
```

- [ ] **Step 8: Kiểm tra toàn bộ**

Run: `pnpm --filter @rong/backend typecheck && pnpm --filter @rong/backend lint && pnpm --filter @rong/backend test`
Expected: cả ba đều PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/common apps/backend/src/main.ts apps/backend/src/app.module.ts
git commit -F - <<'EOF'
feat(backend): add unified error envelope and request ids

Every error now leaves the API in the same shape, carrying a stable code
that clients can branch on and a request id that ties the response to the
server log.

Unexpected errors log their real detail and return a generic message, so
connection strings and stack traces stay out of responses.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Kiểu dữ liệu dùng chung và cấu hình xác thực

**Files:**
- Create: `packages/shared-types/src/auth.ts`
- Create: `packages/shared-types/src/pagination.ts`
- Modify: `packages/shared-types/src/index.ts`
- Modify: `apps/backend/src/config/configuration.ts`
- Create: `apps/backend/src/config/configuration.spec.ts`
- Modify: `apps/backend/.env.example`

**Interfaces:**
- Consumes: không có.
- Produces: `AuthTokens`, `UserProfile`, `CursorPage<T>` từ `@rong/shared-types`; `AuthConfig` và trường `auth` trong `AppConfig`.

- [ ] **Step 1: Viết test thất bại cho cấu hình**

Tạo `apps/backend/src/config/configuration.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from './configuration.js';

const REQUIRED = {
  DB_HOST: 'localhost',
  DB_PORT: '5433',
  DB_USERNAME: 'rong',
  DB_PASSWORD: 'rong',
  DB_DATABASE: 'rong',
  JWT_SECRET: 'a'.repeat(32),
};

describe('loadConfig', () => {
  let original: NodeJS.ProcessEnv;

  beforeEach(() => {
    original = { ...process.env };
    for (const [key, value] of Object.entries(REQUIRED)) {
      process.env[key] = value;
    }
  });

  afterEach(() => {
    process.env = original;
  });

  it('trả về vòng đời token mặc định', () => {
    delete process.env.ACCESS_TOKEN_TTL_SECONDS;
    delete process.env.REFRESH_TOKEN_TTL_DAYS;
    delete process.env.GUEST_RETENTION_DAYS;

    const config = loadConfig();

    expect(config.auth.accessTokenTtlSeconds).toBe(900);
    expect(config.auth.refreshTokenTtlDays).toBe(60);
    expect(config.auth.guestRetentionDays).toBe(30);
  });

  it('chết ngay khi thiếu JWT_SECRET', () => {
    delete process.env.JWT_SECRET;

    expect(() => loadConfig()).toThrow(/JWT_SECRET/);
  });

  it('từ chối JWT_SECRET quá ngắn', () => {
    process.env.JWT_SECRET = 'ngan-qua';

    expect(() => loadConfig()).toThrow(/32/);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận nó thất bại**

Run: `pnpm --filter @rong/backend test src/config`
Expected: FAIL — `config.auth` là `undefined`.

- [ ] **Step 3: Mở rộng `configuration.ts`**

Thêm interface và sửa `loadConfig` trong `apps/backend/src/config/configuration.ts`:

```ts
export interface AuthConfig {
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  guestRetentionDays: number;
}
```

Thêm `auth: AuthConfig;` vào `AppConfig`. Thêm hàm kiểm tra độ dài khóa, đặt ngay dưới `requireEnv`:

```ts
const MIN_JWT_SECRET_LENGTH = 32;

function requireStrongSecret(value: string): string {
  if (value.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET phải dài ít nhất ${MIN_JWT_SECRET_LENGTH} ký tự. ` +
        `Sinh nhanh bằng: openssl rand -base64 48`,
    );
  }
  return value;
}
```

Trong `loadConfig`, thêm `'JWT_SECRET'` vào danh sách `requireEnv`, và thêm khối `auth` vào giá trị trả về:

```ts
    auth: {
      jwtSecret: requireStrongSecret(process.env.JWT_SECRET as string),
      accessTokenTtlSeconds: toInt(process.env.ACCESS_TOKEN_TTL_SECONDS, 900),
      refreshTokenTtlDays: toInt(process.env.REFRESH_TOKEN_TTL_DAYS, 60),
      guestRetentionDays: toInt(process.env.GUEST_RETENTION_DAYS, 30),
    },
```

- [ ] **Step 4: Chạy test để xác nhận nó pass**

Run: `pnpm --filter @rong/backend test src/config`
Expected: PASS — 3 test.

- [ ] **Step 5: Thêm kiểu vào shared-types**

Tạo `packages/shared-types/src/auth.ts`:

```ts
/**
 * Hợp đồng xác thực giữa backend, app di động và web — PRD F11.
 */
export interface UserProfile {
  id: string;
  displayName: string | null;
  /** null với tài khoản dùng thử chưa đăng ký. */
  email: string | null;
  isGuest: boolean;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  /** Số giây còn lại của accessToken. */
  expiresIn: number;
  refreshToken: string;
  user: UserProfile;
}
```

Tạo `packages/shared-types/src/pagination.ts`:

```ts
/**
 * Phân trang theo con trỏ, không theo số trang.
 *
 * Danh sách địa điểm (F2) sắp theo điểm tổng hợp, mà điểm này đổi theo thời
 * gian. Dùng OFFSET thì giữa hai lần tải, một mục có thể bị lặp lại hoặc bị
 * nhảy qua. Con trỏ neo vào bản ghi cuối nên không bị vậy.
 */
export interface CursorPage<T> {
  items: T[];
  /** null nghĩa là đã hết dữ liệu. */
  nextCursor: string | null;
}
```

Sửa `packages/shared-types/src/index.ts`:

```ts
export * from './auth';
export * from './group';
export * from './itinerary';
export * from './pagination';
export * from './place';
export * from './region';
```

- [ ] **Step 6: Cập nhật `.env.example`**

Thêm vào cuối `apps/backend/.env.example`:

```
# Xác thực — sinh khóa bằng: openssl rand -base64 48
JWT_SECRET=
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_DAYS=60
GUEST_RETENTION_DAYS=30
```

Rồi cập nhật `.env` cục bộ của bạn:

```bash
cd apps/backend
printf '\n# Xác thực\nJWT_SECRET=%s\nACCESS_TOKEN_TTL_SECONDS=900\nREFRESH_TOKEN_TTL_DAYS=60\nGUEST_RETENTION_DAYS=30\n' "$(openssl rand -base64 48 | tr -d '\n')" >> .env
```

- [ ] **Step 7: Kiểm tra toàn bộ**

Run: `cd /d/rong && ./node_modules/.bin/turbo run build typecheck test --filter=@rong/backend --filter=@rong/shared-types`
Expected: tất cả PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared-types apps/backend/src/config apps/backend/.env.example
git commit -F - <<'EOF'
feat: add auth contract types and auth configuration

AuthTokens and UserProfile are the shape the mobile app and web viewer
consume, so they live in shared-types alongside the other contracts.

CursorPage lands here too. Place lists sort by a composite score that
moves over time, so OFFSET paging would duplicate or skip rows between
loads; every list endpoint from S2 onward uses cursors instead.

The backend now refuses to boot without a JWT_SECRET of at least 32
characters, rather than starting with a weak key.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Entity và migration

**Files:**
- Create: `apps/backend/src/modules/users/entities/user.entity.ts`
- Create: `apps/backend/src/modules/auth/entities/auth-identity.entity.ts`
- Create: `apps/backend/src/modules/auth/entities/refresh-token.entity.ts`
- Create: `apps/backend/src/database/migrations/1758100000000-CreateUsersAndAuth.ts`

**Interfaces:**
- Consumes: không có.
- Produces: entity `User`, `AuthIdentity`, `RefreshToken`; kiểu `AuthProvider = 'password' | 'google' | 'apple'`.

- [ ] **Step 1: Viết `user.entity.ts`**

```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'display_name', type: 'text', nullable: true })
  displayName!: string | null;

  @Column({ name: 'is_guest', type: 'boolean', default: false })
  isGuest!: boolean;

  /** FR-6.5 — hạn mức 2 lượt tạo lịch trình AI mỗi tháng. Thực thi ở S6. */
  @Column({ name: 'ai_generations_used', type: 'int', default: 0 })
  aiGenerationsUsed!: number;

  @Column({ name: 'ai_quota_period_start', type: 'date', nullable: true })
  aiQuotaPeriodStart!: string | null;

  /** Dùng để dọn tài khoản guest bỏ hoang. */
  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
```

- [ ] **Step 2: Viết `auth-identity.entity.ts`**

```ts
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from '../../users/entities/user.entity.js';

export type AuthProvider = 'password' | 'google' | 'apple';

/**
 * Cách một người chứng minh danh tính. Tách khỏi `users` để thêm Google sau
 * này chỉ là insert thêm một dòng trỏ về cùng user_id, không phải migration.
 */
@Entity('auth_identities')
export class AuthIdentity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'provider', type: 'enum', enum: ['password', 'google', 'apple'], enumName: 'auth_provider' })
  provider!: AuthProvider;

  /** Email đã chuẩn hóa với `password`; `sub` của nhà cung cấp với OAuth. */
  @Column({ name: 'provider_account_id', type: 'text' })
  providerAccountId!: string;

  @Column({ name: 'email', type: 'text', nullable: true })
  email!: string | null;

  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt!: Date | null;

  @Column({ name: 'password_hash', type: 'text', nullable: true })
  passwordHash!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
```

- [ ] **Step 3: Viết `refresh-token.entity.ts`**

```ts
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from '../../users/entities/user.entity.js';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  /** SHA-256 của token. Token gốc không bao giờ chạm tới database. */
  @Column({ name: 'token_hash', type: 'text', unique: true })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'replaced_by', type: 'uuid', nullable: true })
  replacedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
```

- [ ] **Step 4: Viết migration**

Tạo `apps/backend/src/database/migrations/1758100000000-CreateUsersAndAuth.ts`:

```ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bảng người dùng và xác thực — spec S1 mục 3.
 *
 * Enum auth_provider khai báo sẵn cả ba giá trị ngay từ đầu, để khi thêm
 * Google OAuth không phải ALTER TYPE trên database đang chạy.
 */
export class CreateUsersAndAuth1758100000000 implements MigrationInterface {
  name = 'CreateUsersAndAuth1758100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "display_name" text,
        "is_guest" boolean NOT NULL DEFAULT false,
        "ai_generations_used" integer NOT NULL DEFAULT 0,
        "ai_quota_period_start" date,
        "last_seen_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_users_guest_last_seen" ON "users" ("is_guest", "last_seen_at")`,
    );

    await queryRunner.query(
      `CREATE TYPE "auth_provider" AS ENUM ('password', 'google', 'apple')`,
    );

    await queryRunner.query(`
      CREATE TABLE "auth_identities" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
        "provider" "auth_provider" NOT NULL,
        "provider_account_id" text NOT NULL,
        "email" text,
        "email_verified_at" timestamptz,
        "password_hash" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_identity_provider_account" UNIQUE ("provider", "provider_account_id"),
        CONSTRAINT "chk_password_needs_hash"
          CHECK ("provider" <> 'password' OR "password_hash" IS NOT NULL)
      )
    `);

    // Index thường, KHÔNG unique: một người có thể có hai danh tính cùng email
    // (một password, một google) — đó chính là cơ chế gắn tài khoản.
    await queryRunner.query(`CREATE INDEX "idx_identity_email" ON "auth_identities" ("email")`);
    await queryRunner.query(`CREATE INDEX "idx_identity_user" ON "auth_identities" ("user_id")`);

    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
        "token_hash" text NOT NULL UNIQUE,
        "expires_at" timestamptz NOT NULL,
        "revoked_at" timestamptz,
        "replaced_by" uuid REFERENCES "refresh_tokens" ("id") ON DELETE SET NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_refresh_user_active" ON "refresh_tokens" ("user_id", "revoked_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "auth_identities"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "auth_provider"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}
```

- [ ] **Step 5: Chạy migration trên database thật**

```bash
cd /d/rong
pnpm infra:up
pnpm --filter @rong/backend migration:run
```

Expected: `Migration CreateUsersAndAuth1758100000000 has been executed successfully.`

- [ ] **Step 6: Xác minh schema đúng như ý**

```bash
docker exec rong-postgres psql -U rong -d rong -c "\d auth_identities"
```

Expected: thấy ràng buộc `uq_identity_provider_account`, `chk_password_needs_hash`, và cột `provider` kiểu `auth_provider`.

- [ ] **Step 7: Kiểm tra migration lùi được**

```bash
pnpm --filter @rong/backend migration:revert
docker exec rong-postgres psql -U rong -d rong -c "\dt"
pnpm --filter @rong/backend migration:run
```

Expected: lần `\dt` ở giữa không còn ba bảng mới; sau đó chạy lại thành công. Migration không lùi được là migration không dám sửa.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/modules/users/entities apps/backend/src/modules/auth/entities apps/backend/src/database/migrations
git commit -F - <<'EOF'
feat(backend): add users, auth identities and refresh token tables

Identities are a separate table from users, so a user can prove who they
are in more than one way. Adding Google later inserts a row instead of
migrating columns.

The email index is deliberately not unique: one person may hold both a
password identity and a Google identity on the same address, which is
how the two get linked. Uniqueness that matters is on
(provider, provider_account_id).

Refresh tokens store a hash, never the token itself.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Chuẩn hóa email và băm mật khẩu

**Files:**
- Create: `apps/backend/src/modules/auth/email.ts`
- Create: `apps/backend/src/modules/auth/email.spec.ts`
- Create: `apps/backend/src/modules/auth/password.service.ts`
- Create: `apps/backend/src/modules/auth/password.service.spec.ts`
- Modify: `apps/backend/package.json` (thêm `@node-rs/argon2`)

**Interfaces:**
- Consumes: không có.
- Produces: `normalizeEmail(raw: string): string`; `PasswordService` với `hash(plain: string): Promise<string>` và `verify(hashed: string, plain: string): Promise<boolean>`.

- [ ] **Step 1: Cài dependency**

```bash
cd /d/rong
pnpm --filter @rong/backend add @node-rs/argon2
```

Expected: cài xong không cần biên dịch native — gói này phát hành sẵn binary cho từng nền tảng.

- [ ] **Step 2: Viết test thất bại**

Tạo `apps/backend/src/modules/auth/email.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { normalizeEmail } from './email.js';

describe('normalizeEmail', () => {
  it('hạ chữ thường và cắt khoảng trắng', () => {
    expect(normalizeEmail('  Linh@Example.COM ')).toBe('linh@example.com');
  });

  it('giữ nguyên email vốn đã chuẩn', () => {
    expect(normalizeEmail('ha@rong.vn')).toBe('ha@rong.vn');
  });
});
```

Tạo `apps/backend/src/modules/auth/password.service.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('xác minh đúng mật khẩu vừa băm', async () => {
    const hashed = await service.hash('mat-khau-rat-dai-va-kho-doan');

    await expect(service.verify(hashed, 'mat-khau-rat-dai-va-kho-doan')).resolves.toBe(true);
  });

  it('từ chối mật khẩu sai', async () => {
    const hashed = await service.hash('mat-khau-dung');

    await expect(service.verify(hashed, 'mat-khau-sai')).resolves.toBe(false);
  });

  it('sinh hash khác nhau cho cùng một mật khẩu', async () => {
    const [a, b] = await Promise.all([service.hash('trung-nhau'), service.hash('trung-nhau')]);

    expect(a).not.toBe(b);
  });

  it('trả về false thay vì ném lỗi khi hash hỏng', async () => {
    await expect(service.verify('khong-phai-hash-argon2', 'bat-ky')).resolves.toBe(false);
  });
});
```

- [ ] **Step 3: Chạy test để xác nhận nó thất bại**

Run: `pnpm --filter @rong/backend test src/modules/auth`
Expected: FAIL — không resolve được `./email.js` và `./password.service.js`.

- [ ] **Step 4: Viết `email.ts`**

```ts
/**
 * Chuẩn hóa email ở tầng ứng dụng thay vì dùng extension citext: một quy tắc
 * nằm trong code thì đọc được, test được và không phụ thuộc vào hành vi ẩn của
 * kiểu dữ liệu.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
```

- [ ] **Step 5: Viết `password.service.ts`**

```ts
import { Algorithm, hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';

/** Tham số theo khuyến nghị OWASP cho argon2id. */
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return hash(plain, ARGON2_OPTIONS);
  }

  /**
   * Trả về false thay vì ném lỗi khi hash không đọc được. Gọi bên ngoài chỉ
   * quan tâm "mật khẩu có đúng không", và một hash hỏng trong database thì câu
   * trả lời vẫn là không.
   */
  async verify(hashed: string, plain: string): Promise<boolean> {
    try {
      return await verify(hashed, plain, ARGON2_OPTIONS);
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 6: Chạy test để xác nhận nó pass**

Run: `pnpm --filter @rong/backend test src/modules/auth`
Expected: PASS — 6 test.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/modules/auth apps/backend/package.json pnpm-lock.yaml
git commit -F - <<'EOF'
feat(backend): add password hashing and email normalisation

argon2id through @node-rs/argon2, which ships prebuilt binaries, so
neither dev machines nor CI need a native toolchain.

verify() returns false on an unreadable hash rather than throwing:
callers only ask whether the password is right, and for a corrupt hash
the answer is still no.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Dịch vụ access token

**Files:**
- Create: `apps/backend/src/modules/auth/token.service.ts`
- Create: `apps/backend/src/modules/auth/token.service.spec.ts`
- Modify: `apps/backend/package.json` (thêm `@nestjs/jwt`)

**Interfaces:**
- Consumes: `AuthConfig` từ Task 2; `AppError` từ Task 1.
- Produces: `TokenService` với `signAccessToken(payload: AccessTokenPayload): string`, `verifyAccessToken(token: string): AccessTokenPayload`, và getter `accessTokenTtlSeconds: number`; kiểu `AccessTokenPayload { sub: string; isGuest: boolean }`.

- [ ] **Step 1: Cài dependency**

```bash
cd /d/rong
pnpm --filter @rong/backend add @nestjs/jwt
```

- [ ] **Step 2: Viết test thất bại**

Tạo `apps/backend/src/modules/auth/token.service.spec.ts`:

```ts
import { JwtService } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';

import { AppError } from '../../common/errors/app-error.js';
import { TokenService } from './token.service.js';

const SECRET = 'khoa-bi-mat-du-dai-cho-test-32-ky-tu';

function buildService(ttlSeconds = 900): TokenService {
  return new TokenService(new JwtService({ secret: SECRET }), {
    jwtSecret: SECRET,
    accessTokenTtlSeconds: ttlSeconds,
    refreshTokenTtlDays: 60,
    guestRetentionDays: 30,
  });
}

describe('TokenService', () => {
  it('ký rồi đọc lại được đúng nội dung', () => {
    const service = buildService();

    const token = service.signAccessToken({ sub: 'user-1', isGuest: true });

    expect(service.verifyAccessToken(token)).toMatchObject({ sub: 'user-1', isGuest: true });
  });

  it('từ chối token đã hết hạn', async () => {
    const service = buildService(-1);
    const token = service.signAccessToken({ sub: 'user-1', isGuest: false });

    expect(() => service.verifyAccessToken(token)).toThrow(AppError);
  });

  it('từ chối token bị sửa chữ ký', () => {
    const service = buildService();
    const token = service.signAccessToken({ sub: 'user-1', isGuest: false });
    const tampered = `${token.slice(0, -3)}abc`;

    expect(() => service.verifyAccessToken(tampered)).toThrow(AppError);
  });

  it('không nhét email hay tên vào token', () => {
    const service = buildService();

    const payload = service.verifyAccessToken(
      service.signAccessToken({ sub: 'user-1', isGuest: false }),
    );

    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('displayName');
  });
});
```

- [ ] **Step 3: Chạy test để xác nhận nó thất bại**

Run: `pnpm --filter @rong/backend test src/modules/auth/token`
Expected: FAIL — không resolve được `./token.service.js`.

- [ ] **Step 4: Viết `token.service.ts`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { AppError } from '../../common/errors/app-error.js';
import type { AuthConfig } from '../../config/configuration.js';

export const AUTH_CONFIG = 'AUTH_CONFIG';

export interface AccessTokenPayload {
  sub: string;
  isGuest: boolean;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  get accessTokenTtlSeconds(): number {
    return this.config.accessTokenTtlSeconds;
  }

  /**
   * Chỉ đưa vào token những gì không đổi trong vòng đời của nó. Email và tên
   * hiển thị đổi được, mà token thì sống tiếp tới khi hết hạn.
   */
  signAccessToken(payload: AccessTokenPayload): string {
    return this.jwt.sign(payload, {
      secret: this.config.jwtSecret,
      expiresIn: this.config.accessTokenTtlSeconds,
    });
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      const payload = this.jwt.verify<AccessTokenPayload>(token, {
        secret: this.config.jwtSecret,
      });
      return { sub: payload.sub, isGuest: payload.isGuest };
    } catch {
      throw new AppError('UNAUTHORIZED', 401, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
    }
  }
}
```

- [ ] **Step 5: Chạy test để xác nhận nó pass**

Run: `pnpm --filter @rong/backend test src/modules/auth/token`
Expected: PASS — 4 test.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/modules/auth/token.service.ts apps/backend/src/modules/auth/token.service.spec.ts apps/backend/package.json pnpm-lock.yaml
git commit -F - <<'EOF'
feat(backend): add access token service

Signs and verifies the 15-minute JWT. The payload carries only the user
id and the guest flag: anything mutable, such as email or display name,
would go stale inside a token that stays valid until it expires.

Verification failures all surface as one UNAUTHORIZED error, so the
caller cannot tell an expired token from a forged one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Vòng đời refresh token

**Files:**
- Create: `apps/backend/src/modules/auth/refresh-token.service.ts`
- Create: `apps/backend/src/modules/auth/refresh-token.service.spec.ts`

**Interfaces:**
- Consumes: entity `RefreshToken` (Task 3), `AuthConfig` và hằng `AUTH_CONFIG` (Task 2, 5), `AppError` (Task 1).
- Produces: `RefreshTokenService` với `issue(userId: string): Promise<string>`, `rotate(rawToken: string): Promise<{ userId: string; token: string }>`, `revoke(rawToken: string): Promise<void>`, `revokeAllForUser(userId: string): Promise<void>`.

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/backend/src/modules/auth/refresh-token.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../common/errors/app-error.js';
import { RefreshToken } from './entities/refresh-token.entity.js';
import { AUTH_CONFIG } from './token.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

/** Repository giả lập đủ dùng: giữ các dòng trong một mảng. */
function buildFakeRepo() {
  const rows: RefreshToken[] = [];

  return {
    rows,
    create: vi.fn((data: Partial<RefreshToken>) => ({ ...data }) as RefreshToken),
    save: vi.fn(async (row: RefreshToken) => {
      row.id ??= `id-${rows.length + 1}`;
      if (!rows.includes(row)) rows.push(row);
      return row;
    }),
    findOne: vi.fn(async ({ where }: { where: { tokenHash: string } }) =>
      rows.find((row) => row.tokenHash === where.tokenHash) ?? null,
    ),
    update: vi.fn(async (criteria: { userId: string; revokedAt: unknown }, patch: Partial<RefreshToken>) => {
      for (const row of rows) {
        if (row.userId === criteria.userId && row.revokedAt === null) {
          Object.assign(row, patch);
        }
      }
      return { affected: 0 };
    }),
  };
}

async function buildService(repo: ReturnType<typeof buildFakeRepo>) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      RefreshTokenService,
      { provide: getRepositoryToken(RefreshToken), useValue: repo },
      {
        provide: AUTH_CONFIG,
        useValue: {
          jwtSecret: 'x'.repeat(32),
          accessTokenTtlSeconds: 900,
          refreshTokenTtlDays: 60,
          guestRetentionDays: 30,
        },
      },
    ],
  }).compile();

  return moduleRef.get(RefreshTokenService);
}

describe('RefreshTokenService', () => {
  let repo: ReturnType<typeof buildFakeRepo>;

  beforeEach(() => {
    repo = buildFakeRepo();
  });

  it('không bao giờ lưu token gốc vào database', async () => {
    const service = await buildService(repo);

    const token = await service.issue('user-1');

    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0].tokenHash).not.toBe(token);
    expect(JSON.stringify(repo.rows[0])).not.toContain(token);
  });

  it('xoay vòng: token cũ bị thu hồi và trỏ sang token mới', async () => {
    const service = await buildService(repo);
    const first = await service.issue('user-1');

    const result = await service.rotate(first);

    expect(result.userId).toBe('user-1');
    expect(result.token).not.toBe(first);
    expect(repo.rows[0].revokedAt).toBeInstanceOf(Date);
    expect(repo.rows[0].replacedBy).toBe(repo.rows[1].id);
  });

  it('từ chối token không tồn tại', async () => {
    const service = await buildService(repo);

    await expect(service.rotate('khong-co-that')).rejects.toThrow(AppError);
  });

  it('dùng lại token đã thu hồi thì thu hồi toàn bộ phiên của người đó', async () => {
    const service = await buildService(repo);
    const first = await service.issue('user-1');
    const second = await service.issue('user-1');
    await service.rotate(first);

    await expect(service.rotate(first)).rejects.toThrow(AppError);

    // Token thứ hai, vốn vẫn hợp lệ, cũng phải bị thu hồi theo.
    const secondRow = repo.rows.find((row) => row.tokenHash !== repo.rows[0].tokenHash);
    expect(secondRow?.revokedAt).not.toBeNull();
    await expect(service.rotate(second)).rejects.toThrow(AppError);
  });

  it('từ chối token đã hết hạn', async () => {
    const service = await buildService(repo);
    const token = await service.issue('user-1');
    repo.rows[0].expiresAt = new Date(Date.now() - 1000);

    await expect(service.rotate(token)).rejects.toThrow(AppError);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận nó thất bại**

Run: `pnpm --filter @rong/backend test src/modules/auth/refresh`
Expected: FAIL — không resolve được `./refresh-token.service.js`.

- [ ] **Step 3: Viết `refresh-token.service.ts`**

```ts
import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { AppError } from '../../common/errors/app-error.js';
import type { AuthConfig } from '../../config/configuration.js';
import { RefreshToken } from './entities/refresh-token.entity.js';
import { AUTH_CONFIG } from './token.service.js';

const TOKEN_BYTES = 32;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class RefreshTokenService {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly repository: Repository<RefreshToken>,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  /**
   * SHA-256 chứ không phải argon2: đây là chuỗi ngẫu nhiên 256 bit do máy
   * sinh, không có không gian nhỏ để dò. Băm chậm ở đây chỉ làm chậm mọi lần
   * refresh mà không thêm được gì.
   */
  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  async issue(userId: string): Promise<string> {
    const raw = randomBytes(TOKEN_BYTES).toString('base64url');

    const row = this.repository.create({
      userId,
      tokenHash: this.hashToken(raw),
      expiresAt: new Date(Date.now() + this.config.refreshTokenTtlDays * MS_PER_DAY),
      revokedAt: null,
      replacedBy: null,
    });
    await this.repository.save(row);

    return raw;
  }

  async rotate(rawToken: string): Promise<{ userId: string; token: string }> {
    const existing = await this.repository.findOne({
      where: { tokenHash: this.hashToken(rawToken) },
    });

    if (existing === null) {
      throw this.invalidToken();
    }

    if (existing.revokedAt !== null) {
      // Token đã xoay vòng mà vẫn có người trình ra: bản sao đang lưu hành ở
      // đâu đó. Không biết bản nào là của người dùng thật, nên cắt hết.
      await this.revokeAllForUser(existing.userId);
      throw this.invalidToken();
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      throw this.invalidToken();
    }

    const raw = await this.issue(existing.userId);
    const replacement = await this.repository.findOne({
      where: { tokenHash: this.hashToken(raw) },
    });

    existing.revokedAt = new Date();
    existing.replacedBy = replacement?.id ?? null;
    await this.repository.save(existing);

    return { userId: existing.userId, token: raw };
  }

  async revoke(rawToken: string): Promise<void> {
    const existing = await this.repository.findOne({
      where: { tokenHash: this.hashToken(rawToken) },
    });

    if (existing === null || existing.revokedAt !== null) {
      return; // Đăng xuất một phiên đã chết vẫn là đăng xuất thành công.
    }

    existing.revokedAt = new Date();
    await this.repository.save(existing);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.repository.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  private invalidToken(): AppError {
    return new AppError(
      'INVALID_REFRESH_TOKEN',
      401,
      'Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.',
    );
  }
}
```

**Lưu ý cho người triển khai:** repository giả lập trong test so sánh `row.revokedAt === null`, còn code thật dùng `IsNull()` của TypeORM. Đó là lý do hàm `update` giả lập bỏ qua tham số `criteria.revokedAt`. Hành vi thật được test lại ở Task 13 trên database thật.

- [ ] **Step 4: Chạy test để xác nhận nó pass**

Run: `pnpm --filter @rong/backend test src/modules/auth/refresh`
Expected: PASS — 5 test.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/auth/refresh-token.service.ts apps/backend/src/modules/auth/refresh-token.service.spec.ts
git commit -F - <<'EOF'
feat(backend): add refresh token rotation and revocation

Tokens are random 256-bit strings stored as SHA-256 hashes, rotated on
every use. Fast hashing is the right call here: a machine-generated
random string has no small search space, so a slow hash would only slow
down every refresh.

Presenting an already-rotated token revokes every session the user has.
At that point the string exists in two places and there is no way to
tell which holder is the real one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Đăng ký, đăng nhập và guard

**Files:**
- Create: `apps/backend/src/modules/auth/dto/auth.dto.ts`
- Create: `apps/backend/src/modules/auth/auth.service.ts`
- Create: `apps/backend/src/modules/auth/auth.service.spec.ts`
- Create: `apps/backend/src/modules/auth/auth.controller.ts`
- Create: `apps/backend/src/modules/auth/auth.module.ts`
- Create: `apps/backend/src/modules/auth/jwt-auth.guard.ts`
- Create: `apps/backend/src/modules/auth/current-user.decorator.ts`
- Modify: `apps/backend/src/app.module.ts`

**Interfaces:**
- Consumes: `PasswordService` (Task 4), `TokenService` + `AUTH_CONFIG` (Task 5), `RefreshTokenService` (Task 6), entity `User`/`AuthIdentity` (Task 3), `AuthTokens`/`UserProfile` (Task 2).
- Produces: `AuthService.register(dto: RegisterDto): Promise<AuthTokens>`, `AuthService.login(dto: LoginDto): Promise<AuthTokens>`, `AuthService.buildTokens(user: User): Promise<AuthTokens>`, `JwtAuthGuard`, decorator `@CurrentUser()` trả về `AccessTokenPayload`.

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/backend/src/modules/auth/auth.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../common/errors/app-error.js';
import { AuthIdentity } from './entities/auth-identity.entity.js';
import { User } from '../users/entities/user.entity.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { TokenService } from './token.service.js';

function buildDeps() {
  const users: User[] = [];
  const identities: AuthIdentity[] = [];

  const userRepo = {
    create: vi.fn((data: Partial<User>) => ({ ...data }) as User),
    save: vi.fn(async (row: User) => {
      row.id ??= `user-${users.length + 1}`;
      row.createdAt ??= new Date('2026-09-21T00:00:00Z');
      if (!users.includes(row)) users.push(row);
      return row;
    }),
    findOne: vi.fn(async ({ where }: { where: { id: string } }) =>
      users.find((row) => row.id === where.id) ?? null,
    ),
  };

  const identityRepo = {
    create: vi.fn((data: Partial<AuthIdentity>) => ({ ...data }) as AuthIdentity),
    save: vi.fn(async (row: AuthIdentity) => {
      row.id ??= `identity-${identities.length + 1}`;
      if (!identities.includes(row)) identities.push(row);
      return row;
    }),
    findOne: vi.fn(
      async ({ where }: { where: { provider: string; providerAccountId: string } }) =>
        identities.find(
          (row) =>
            row.provider === where.provider &&
            row.providerAccountId === where.providerAccountId,
        ) ?? null,
    ),
  };

  return { users, identities, userRepo, identityRepo };
}

async function buildService(deps: ReturnType<typeof buildDeps>) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      AuthService,
      PasswordService,
      { provide: getRepositoryToken(User), useValue: deps.userRepo },
      { provide: getRepositoryToken(AuthIdentity), useValue: deps.identityRepo },
      {
        provide: TokenService,
        useValue: {
          accessTokenTtlSeconds: 900,
          signAccessToken: vi.fn(() => 'access-token'),
        },
      },
      {
        provide: RefreshTokenService,
        useValue: {
          issue: vi.fn(async () => 'refresh-token'),
          revokeAllForUser: vi.fn(async () => undefined),
        },
      },
    ],
  }).compile();

  return moduleRef.get(AuthService);
}

describe('AuthService', () => {
  let deps: ReturnType<typeof buildDeps>;

  beforeEach(() => {
    deps = buildDeps();
  });

  it('đăng ký tạo user kèm danh tính mật khẩu', async () => {
    const service = await buildService(deps);

    const result = await service.register({
      email: '  Linh@Example.COM ',
      password: 'mat-khau-du-dai',
      displayName: 'Linh',
    });

    expect(result.user.email).toBe('linh@example.com');
    expect(result.user.isGuest).toBe(false);
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
    expect(deps.identities[0].providerAccountId).toBe('linh@example.com');
    expect(deps.identities[0].passwordHash).not.toBe('mat-khau-du-dai');
  });

  it('từ chối email đã tồn tại bằng mã EMAIL_TAKEN', async () => {
    const service = await buildService(deps);
    await service.register({ email: 'linh@example.com', password: 'mat-khau-du-dai' });

    await expect(
      service.register({ email: 'LINH@example.com', password: 'mat-khau-khac' }),
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
  });

  it('đăng nhập đúng mật khẩu trả về token', async () => {
    const service = await buildService(deps);
    await service.register({ email: 'ha@rong.vn', password: 'mat-khau-du-dai' });

    const result = await service.login({ email: 'ha@rong.vn', password: 'mat-khau-du-dai' });

    expect(result.user.email).toBe('ha@rong.vn');
  });

  it('sai mật khẩu và email không tồn tại trả về cùng một mã lỗi', async () => {
    const service = await buildService(deps);
    await service.register({ email: 'ha@rong.vn', password: 'mat-khau-du-dai' });

    const wrongPassword = await service
      .login({ email: 'ha@rong.vn', password: 'sai-bet' })
      .catch((error: AppError) => error.code);
    const noSuchUser = await service
      .login({ email: 'khong-ton-tai@rong.vn', password: 'bat-ky' })
      .catch((error: AppError) => error.code);

    expect(wrongPassword).toBe('INVALID_CREDENTIALS');
    expect(noSuchUser).toBe('INVALID_CREDENTIALS');
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận nó thất bại**

Run: `pnpm --filter @rong/backend test src/modules/auth/auth.service`
Expected: FAIL — không resolve được `./auth.service.js`.

- [ ] **Step 3: Viết DTO**

Tạo `apps/backend/src/modules/auth/dto/auth.dto.ts`:

```ts
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const MIN_PASSWORD_LENGTH = 8;

export class RegisterDto {
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  email!: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `Mật khẩu phải dài ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`,
  })
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  displayName?: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  email!: string;

  @IsString()
  password!: string;
}
```

- [ ] **Step 4: Viết `auth.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AuthTokens, UserProfile } from '@rong/shared-types';

import { AppError } from '../../common/errors/app-error.js';
import { User } from '../users/entities/user.entity.js';
import { AuthIdentity } from './entities/auth-identity.entity.js';
import type { LoginDto, RegisterDto } from './dto/auth.dto.js';
import { normalizeEmail } from './email.js';
import { PasswordService } from './password.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { TokenService } from './token.service.js';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AuthIdentity) private readonly identities: Repository<AuthIdentity>,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokens> {
    const email = normalizeEmail(dto.email);
    await this.assertEmailFree(email);

    const user = await this.users.save(
      this.users.create({
        displayName: dto.displayName ?? null,
        isGuest: false,
        lastSeenAt: new Date(),
      }),
    );

    await this.attachPasswordIdentity(user.id, email, dto.password);

    return this.buildTokens(user, email);
  }

  async login(dto: LoginDto): Promise<AuthTokens> {
    const email = normalizeEmail(dto.email);
    const identity = await this.identities.findOne({
      where: { provider: 'password', providerAccountId: email },
    });

    // Luôn trả về cùng một lỗi dù email không tồn tại hay mật khẩu sai: phân
    // biệt hai trường hợp biến form đăng nhập thành công cụ dò xem ai đã có
    // tài khoản.
    if (identity?.passwordHash == null) {
      throw this.invalidCredentials();
    }

    const matches = await this.passwords.verify(identity.passwordHash, dto.password);
    if (!matches) {
      throw this.invalidCredentials();
    }

    const user = await this.users.findOne({ where: { id: identity.userId } });
    if (user === null) {
      throw this.invalidCredentials();
    }

    user.lastSeenAt = new Date();
    await this.users.save(user);

    return this.buildTokens(user, identity.email);
  }

  async buildTokens(user: User, email: string | null = null): Promise<AuthTokens> {
    return {
      accessToken: this.tokens.signAccessToken({ sub: user.id, isGuest: user.isGuest }),
      expiresIn: this.tokens.accessTokenTtlSeconds,
      refreshToken: await this.refreshTokens.issue(user.id),
      user: toProfile(user, email),
    };
  }

  protected async assertEmailFree(email: string): Promise<void> {
    const existing = await this.identities.findOne({
      where: { provider: 'password', providerAccountId: email },
    });

    if (existing !== null) {
      throw new AppError('EMAIL_TAKEN', 409, 'Email này đã được đăng ký.');
    }
  }

  protected async attachPasswordIdentity(
    userId: string,
    email: string,
    password: string,
  ): Promise<void> {
    await this.identities.save(
      this.identities.create({
        userId,
        provider: 'password',
        providerAccountId: email,
        email,
        passwordHash: await this.passwords.hash(password),
        emailVerifiedAt: null,
      }),
    );
  }

  private invalidCredentials(): AppError {
    return new AppError('INVALID_CREDENTIALS', 401, 'Email hoặc mật khẩu không đúng.');
  }
}

export function toProfile(user: User, email: string | null): UserProfile {
  return {
    id: user.id,
    displayName: user.displayName,
    email,
    isGuest: user.isGuest,
    createdAt: user.createdAt.toISOString(),
  };
}
```

- [ ] **Step 5: Chạy test để xác nhận nó pass**

Run: `pnpm --filter @rong/backend test src/modules/auth/auth.service`
Expected: PASS — 4 test.

- [ ] **Step 6: Viết guard và decorator**

Tạo `apps/backend/src/modules/auth/jwt-auth.guard.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';

import { AppError } from '../../common/errors/app-error.js';
import { TokenService, type AccessTokenPayload } from './token.service.js';

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AccessTokenPayload;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;

    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new AppError('UNAUTHORIZED', 401, 'Yêu cầu này cần đăng nhập.');
    }

    request.user = this.tokens.verifyAccessToken(header.slice('Bearer '.length));
    return true;
  }
}
```

Tạo `apps/backend/src/modules/auth/current-user.decorator.ts`:

```ts
import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest } from './jwt-auth.guard.js';
import type { AccessTokenPayload } from './token.service.js';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessTokenPayload => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (request.user === undefined) {
      throw new Error('CurrentUser dùng trên route chưa gắn JwtAuthGuard.');
    }

    return request.user;
  },
);
```

- [ ] **Step 7: Viết controller và module**

Tạo `apps/backend/src/modules/auth/auth.controller.ts`:

```ts
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { AuthTokens } from '@rong/shared-types';

import { AuthService } from './auth.service.js';
import { LoginDto, RegisterDto } from './dto/auth.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthTokens> {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<AuthTokens> {
    return this.auth.login(dto);
  }
}
```

Tạo `apps/backend/src/modules/auth/auth.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import type { AppConfig } from '../../config/configuration.js';
import { User } from '../users/entities/user.entity.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthIdentity } from './entities/auth-identity.entity.js';
import { RefreshToken } from './entities/refresh-token.entity.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PasswordService } from './password.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { AUTH_CONFIG, TokenService } from './token.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, AuthIdentity, RefreshToken]),
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    RefreshTokenService,
    JwtAuthGuard,
    {
      provide: AUTH_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const auth = config.get<AppConfig['auth']>('auth');
        if (auth === undefined) {
          throw new Error('Chưa nạp được cấu hình auth.');
        }
        return auth;
      },
    },
  ],
  exports: [AuthService, TokenService, RefreshTokenService, JwtAuthGuard],
})
export class AuthModule {}
```

- [ ] **Step 8: Gắn `AuthModule` vào `app.module.ts`**

Thêm import `AuthModule` từ `./modules/auth/auth.module.js` và đưa vào mảng `imports` ngay sau `DatabaseModule`.

- [ ] **Step 9: Thử tay trên server đang chạy**

```bash
cd /d/rong
pnpm infra:up
pnpm --filter @rong/backend build && node apps/backend/dist/main.js &
sleep 8
curl -s -X POST http://localhost:3001/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"Linh@Example.COM","password":"mat-khau-du-dai","displayName":"Linh"}'
echo
curl -s -X POST http://localhost:3001/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"linh@example.com","password":"mat-khau-khac"}'
echo
curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"linh@example.com","password":"sai-bet"}'
```

Expected: lần 1 trả về `accessToken`, `refreshToken`, `user.email` là `linh@example.com`; lần 2 trả về `409` kèm `"code":"EMAIL_TAKEN"`; lần 3 trả về `401` kèm `"code":"INVALID_CREDENTIALS"`. Nhớ tắt tiến trình sau khi thử.

- [ ] **Step 10: Kiểm tra toàn bộ và commit**

Run: `pnpm --filter @rong/backend typecheck && pnpm --filter @rong/backend lint && pnpm --filter @rong/backend test`

```bash
git add apps/backend/src/modules/auth apps/backend/src/app.module.ts
git commit -F - <<'EOF'
feat(backend): add registration, login and the JWT guard

A failed login returns the same error whether the address has an account
or not. Telling the two apart would turn the login form into a way to
check who has signed up.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Làm mới token và đăng xuất

**Files:**
- Modify: `apps/backend/src/modules/auth/dto/auth.dto.ts`
- Modify: `apps/backend/src/modules/auth/auth.service.ts`
- Modify: `apps/backend/src/modules/auth/auth.service.spec.ts`
- Modify: `apps/backend/src/modules/auth/auth.controller.ts`

**Interfaces:**
- Consumes: `RefreshTokenService.rotate` / `.revoke` (Task 6), `AuthService.buildTokens` (Task 7).
- Produces: `AuthService.refresh(rawToken: string): Promise<AuthTokens>`, `AuthService.logout(rawToken: string): Promise<void>`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối khối `describe('AuthService', ...)` trong `auth.service.spec.ts`:

```ts
  it('refresh trả về cặp token mới cho đúng người dùng', async () => {
    const service = await buildService(deps);
    await service.register({ email: 'ha@rong.vn', password: 'mat-khau-du-dai' });

    const result = await service.refresh('refresh-token');

    expect(result.user.id).toBe('user-1');
    expect(result.accessToken).toBe('access-token');
  });
```

Và sửa provider giả lập `RefreshTokenService` trong `buildService` thành:

```ts
      {
        provide: RefreshTokenService,
        useValue: {
          issue: vi.fn(async () => 'refresh-token'),
          rotate: vi.fn(async () => ({ userId: 'user-1', token: 'refresh-token-2' })),
          revoke: vi.fn(async () => undefined),
          revokeAllForUser: vi.fn(async () => undefined),
        },
      },
```

- [ ] **Step 2: Chạy test để xác nhận nó thất bại**

Run: `pnpm --filter @rong/backend test src/modules/auth/auth.service`
Expected: FAIL — `service.refresh is not a function`.

- [ ] **Step 3: Thêm DTO**

Thêm vào `apps/backend/src/modules/auth/dto/auth.dto.ts`:

```ts
export class RefreshDto {
  @IsString()
  refreshToken!: string;
}
```

- [ ] **Step 4: Thêm phương thức vào `auth.service.ts`**

```ts
  async refresh(rawToken: string): Promise<AuthTokens> {
    const { userId, token } = await this.refreshTokens.rotate(rawToken);

    const user = await this.users.findOne({ where: { id: userId } });
    if (user === null) {
      throw new AppError(
        'INVALID_REFRESH_TOKEN',
        401,
        'Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.',
      );
    }

    user.lastSeenAt = new Date();
    await this.users.save(user);

    const identity = await this.identities.findOne({
      where: { provider: 'password', userId },
    });

    return {
      accessToken: this.tokens.signAccessToken({ sub: user.id, isGuest: user.isGuest }),
      expiresIn: this.tokens.accessTokenTtlSeconds,
      // rotate() đã cấp token mới rồi, dùng lại chứ không cấp thêm lần nữa.
      refreshToken: token,
      user: toProfile(user, identity?.email ?? null),
    };
  }

  async logout(rawToken: string): Promise<void> {
    await this.refreshTokens.revoke(rawToken);
  }
```

**Lưu ý:** `identities.findOne` giờ được gọi với `{ provider, userId }`, nên repository giả lập trong test phải hỗ trợ cả hai dạng truy vấn. Sửa `identityRepo.findOne` thành:

```ts
    findOne: vi.fn(
      async ({ where }: { where: { provider?: string; providerAccountId?: string; userId?: string } }) =>
        identities.find(
          (row) =>
            (where.provider === undefined || row.provider === where.provider) &&
            (where.providerAccountId === undefined ||
              row.providerAccountId === where.providerAccountId) &&
            (where.userId === undefined || row.userId === where.userId),
        ) ?? null,
    ),
```

- [ ] **Step 5: Thêm route vào `auth.controller.ts`**

```ts
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }
```

Nhớ thêm `RefreshDto` vào dòng import DTO.

- [ ] **Step 6: Chạy test để xác nhận nó pass**

Run: `pnpm --filter @rong/backend test src/modules/auth`
Expected: PASS — toàn bộ test của module auth.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/modules/auth
git commit -F - <<'EOF'
feat(backend): add token refresh and logout

Refresh reuses the token that rotation already issued rather than
minting a second one, so a single call leaves exactly one live refresh
token behind.

Logging out with an already-dead token succeeds quietly: the caller
wanted the session gone, and it is.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Tài khoản dùng thử và nâng cấp

**Files:**
- Modify: `apps/backend/src/modules/auth/auth.service.ts`
- Modify: `apps/backend/src/modules/auth/auth.service.spec.ts`
- Modify: `apps/backend/src/modules/auth/auth.controller.ts`

**Interfaces:**
- Consumes: `AuthService.assertEmailFree` / `.attachPasswordIdentity` / `.buildTokens` (Task 7), `JwtAuthGuard` + `@CurrentUser()` (Task 7).
- Produces: `AuthService.createGuest(): Promise<AuthTokens>`, `AuthService.upgradeGuest(userId: string, dto: RegisterDto): Promise<AuthTokens>`.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `describe('AuthService', ...)`:

```ts
  it('tạo guest không cần email', async () => {
    const service = await buildService(deps);

    const result = await service.createGuest();

    expect(result.user.isGuest).toBe(true);
    expect(result.user.email).toBeNull();
    expect(deps.identities).toHaveLength(0);
  });

  it('nâng cấp guest giữ nguyên user id', async () => {
    const service = await buildService(deps);
    const guest = await service.createGuest();

    const upgraded = await service.upgradeGuest(guest.user.id, {
      email: 'linh@example.com',
      password: 'mat-khau-du-dai',
      displayName: 'Linh',
    });

    expect(upgraded.user.id).toBe(guest.user.id);
    expect(upgraded.user.isGuest).toBe(false);
    expect(upgraded.user.email).toBe('linh@example.com');
    expect(deps.users).toHaveLength(1);
  });

  it('nâng cấp thu hồi mọi phiên cũ của guest', async () => {
    const service = await buildService(deps);
    const guest = await service.createGuest();

    await service.upgradeGuest(guest.user.id, {
      email: 'linh@example.com',
      password: 'mat-khau-du-dai',
    });

    const refreshTokens = (service as unknown as { refreshTokens: { revokeAllForUser: unknown } })
      .refreshTokens.revokeAllForUser as ReturnType<typeof vi.fn>;
    expect(refreshTokens).toHaveBeenCalledWith(guest.user.id);
  });

  it('từ chối nâng cấp tài khoản không phải guest', async () => {
    const service = await buildService(deps);
    const registered = await service.register({
      email: 'ha@rong.vn',
      password: 'mat-khau-du-dai',
    });

    await expect(
      service.upgradeGuest(registered.user.id, {
        email: 'khac@rong.vn',
        password: 'mat-khau-du-dai',
      }),
    ).rejects.toMatchObject({ code: 'NOT_A_GUEST' });
  });
```

- [ ] **Step 2: Chạy test để xác nhận nó thất bại**

Run: `pnpm --filter @rong/backend test src/modules/auth/auth.service`
Expected: FAIL — `service.createGuest is not a function`.

- [ ] **Step 3: Thêm phương thức vào `auth.service.ts`**

```ts
  async createGuest(): Promise<AuthTokens> {
    const user = await this.users.save(
      this.users.create({
        displayName: null,
        isGuest: true,
        lastSeenAt: new Date(),
      }),
    );

    return this.buildTokens(user);
  }

  /**
   * Gắn danh tính mật khẩu vào CHÍNH dòng user của guest, thay vì tạo user
   * mới rồi chuyển dữ liệu. Vì user_id không đổi, mọi thứ guest đã tạo tự
   * nhiên thuộc về tài khoản mới — không có bước di chuyển nào để mà hỏng.
   */
  async upgradeGuest(userId: string, dto: RegisterDto): Promise<AuthTokens> {
    const user = await this.users.findOne({ where: { id: userId } });

    if (user === null || !user.isGuest) {
      throw new AppError('NOT_A_GUEST', 409, 'Tài khoản này đã được đăng ký rồi.');
    }

    const email = normalizeEmail(dto.email);
    await this.assertEmailFree(email);
    await this.attachPasswordIdentity(user.id, email, dto.password);

    user.isGuest = false;
    user.displayName = dto.displayName ?? user.displayName;
    user.lastSeenAt = new Date();
    await this.users.save(user);

    // Quyền hạn của tài khoản vừa đổi, nên cấp lại phiên.
    await this.refreshTokens.revokeAllForUser(user.id);

    return this.buildTokens(user, email);
  }
```

- [ ] **Step 4: Thêm route vào `auth.controller.ts`**

```ts
  @Post('guest')
  createGuest(): Promise<AuthTokens> {
    return this.auth.createGuest();
  }

  @Post('upgrade')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  upgrade(
    @CurrentUser() current: AccessTokenPayload,
    @Body() dto: RegisterDto,
  ): Promise<AuthTokens> {
    return this.auth.upgradeGuest(current.sub, dto);
  }
```

Thêm vào phần import của controller:

```ts
import { UseGuards } from '@nestjs/common';
import { CurrentUser } from './current-user.decorator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import type { AccessTokenPayload } from './token.service.js';
```

- [ ] **Step 5: Chạy test để xác nhận nó pass**

Run: `pnpm --filter @rong/backend test src/modules/auth`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/modules/auth
git commit -F - <<'EOF'
feat(backend): add guest accounts and in-place upgrade

A guest is a real user row. Registering attaches a password identity to
that same row and clears the guest flag, so the trial itinerary survives
signup without anything being copied between accounts.

Upgrading revokes the guest's existing sessions, since what the account
can do has just changed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 10: Hồ sơ và xóa tài khoản

**Files:**
- Create: `apps/backend/src/modules/users/users.service.ts`
- Create: `apps/backend/src/modules/users/users.service.spec.ts`
- Create: `apps/backend/src/modules/users/users.controller.ts`
- Create: `apps/backend/src/modules/users/users.module.ts`
- Create: `apps/backend/src/modules/users/dto/update-profile.dto.ts`
- Modify: `apps/backend/src/app.module.ts`

**Interfaces:**
- Consumes: entity `User`/`AuthIdentity` (Task 3), `toProfile` (Task 7), `JwtAuthGuard` + `@CurrentUser()` (Task 7), `AuthModule` exports (Task 7).
- Produces: `UsersService.getProfile(userId: string): Promise<UserProfile>`, `UsersService.updateProfile(userId: string, displayName: string): Promise<UserProfile>`, `UsersService.deleteAccount(userId: string): Promise<void>`.

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/backend/src/modules/users/users.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AuthIdentity } from '../auth/entities/auth-identity.entity.js';
import { User } from './entities/user.entity.js';
import { UsersService } from './users.service.js';

function buildService(user: User | null) {
  const userRepo = {
    findOne: vi.fn(async () => user),
    save: vi.fn(async (row: User) => row),
    delete: vi.fn(async () => ({ affected: 1 })),
  };
  const identityRepo = {
    findOne: vi.fn(async () => ({ email: 'linh@example.com' }) as AuthIdentity),
  };

  return Test.createTestingModule({
    providers: [
      UsersService,
      { provide: getRepositoryToken(User), useValue: userRepo },
      { provide: getRepositoryToken(AuthIdentity), useValue: identityRepo },
    ],
  })
    .compile()
    .then(async (moduleRef) => ({
      service: moduleRef.get(UsersService),
      userRepo,
    }));
}

const SAMPLE: User = {
  id: 'user-1',
  displayName: 'Linh',
  isGuest: false,
  aiGenerationsUsed: 0,
  aiQuotaPeriodStart: null,
  lastSeenAt: new Date('2026-09-21T00:00:00Z'),
  createdAt: new Date('2026-09-21T00:00:00Z'),
  updatedAt: new Date('2026-09-21T00:00:00Z'),
};

describe('UsersService', () => {
  it('trả về hồ sơ kèm email lấy từ danh tính', async () => {
    const { service } = await buildService({ ...SAMPLE });

    await expect(service.getProfile('user-1')).resolves.toMatchObject({
      id: 'user-1',
      displayName: 'Linh',
      email: 'linh@example.com',
      isGuest: false,
    });
  });

  it('báo NOT_FOUND khi người dùng không còn', async () => {
    const { service } = await buildService(null);

    await expect(service.getProfile('user-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('đổi tên hiển thị', async () => {
    const { service } = await buildService({ ...SAMPLE });

    await expect(service.updateProfile('user-1', 'Linh Nguyễn')).resolves.toMatchObject({
      displayName: 'Linh Nguyễn',
    });
  });

  it('xóa tài khoản là xóa cứng dòng users', async () => {
    const { service, userRepo } = await buildService({ ...SAMPLE });

    await service.deleteAccount('user-1');

    expect(userRepo.delete).toHaveBeenCalledWith({ id: 'user-1' });
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận nó thất bại**

Run: `pnpm --filter @rong/backend test src/modules/users`
Expected: FAIL — không resolve được `./users.service.js`.

- [ ] **Step 3: Viết DTO**

Tạo `apps/backend/src/modules/users/dto/update-profile.dto.ts`:

```ts
import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @MinLength(1, { message: 'Tên hiển thị không được để trống.' })
  @MaxLength(60)
  displayName!: string;
}
```

- [ ] **Step 4: Viết `users.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { UserProfile } from '@rong/shared-types';

import { AppError } from '../../common/errors/app-error.js';
import { AuthIdentity } from '../auth/entities/auth-identity.entity.js';
import { toProfile } from '../auth/auth.service.js';
import { User } from './entities/user.entity.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AuthIdentity) private readonly identities: Repository<AuthIdentity>,
  ) {}

  async getProfile(userId: string): Promise<UserProfile> {
    const user = await this.requireUser(userId);
    const identity = await this.identities.findOne({
      where: { provider: 'password', userId },
    });

    return toProfile(user, identity?.email ?? null);
  }

  async updateProfile(userId: string, displayName: string): Promise<UserProfile> {
    const user = await this.requireUser(userId);

    user.displayName = displayName;
    user.lastSeenAt = new Date();
    await this.users.save(user);

    const identity = await this.identities.findOne({
      where: { provider: 'password', userId },
    });

    return toProfile(user, identity?.email ?? null);
  }

  /**
   * Xóa cứng — PRD F11 hứa "xóa tài khoản và toàn bộ dữ liệu". Các bảng con
   * khai báo ON DELETE CASCADE nên danh tính và refresh token đi theo.
   */
  async deleteAccount(userId: string): Promise<void> {
    await this.requireUser(userId);
    await this.users.delete({ id: userId });
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId } });

    if (user === null) {
      throw new AppError('NOT_FOUND', 404, 'Không tìm thấy tài khoản.');
    }

    return user;
  }
}
```

- [ ] **Step 5: Viết controller và module**

Tạo `apps/backend/src/modules/users/users.controller.ts`:

```ts
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, UseGuards } from '@nestjs/common';
import type { UserProfile } from '@rong/shared-types';

import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AccessTokenPayload } from '../auth/token.service.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UsersService } from './users.service.js';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() current: AccessTokenPayload): Promise<UserProfile> {
    return this.users.getProfile(current.sub);
  }

  @Patch('me')
  updateMe(
    @CurrentUser() current: AccessTokenPayload,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfile> {
    return this.users.updateProfile(current.sub, dto.displayName);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMe(@CurrentUser() current: AccessTokenPayload): Promise<void> {
    await this.users.deleteAccount(current.sub);
  }
}
```

Tạo `apps/backend/src/modules/users/users.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { AuthIdentity } from '../auth/entities/auth-identity.entity.js';
import { User } from './entities/user.entity.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([User, AuthIdentity]), AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 6: Gắn `UsersModule` vào `app.module.ts`**

Thêm import và đưa `UsersModule` vào mảng `imports` ngay sau `AuthModule`.

- [ ] **Step 7: Chạy test để xác nhận nó pass**

Run: `pnpm --filter @rong/backend typecheck && pnpm --filter @rong/backend test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/modules/users apps/backend/src/app.module.ts
git commit -F - <<'EOF'
feat(backend): add profile endpoints and account deletion

Deleting an account is a hard delete. PRD F11 promises the data is gone,
and the child tables cascade, so identities and refresh tokens go with
it.

Note the window this leaves: an access token already issued stays valid
until it expires, at most fifteen minutes. The session cannot be renewed
because the refresh tokens are gone with the row.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 11: Chặn tần suất

**Files:**
- Modify: `apps/backend/package.json` (thêm `@nestjs/throttler`, `@nest-lab/throttler-storage-redis`, `ioredis`)
- Create: `apps/backend/src/common/throttler/throttler.config.ts`
- Modify: `apps/backend/src/common/errors/all-exceptions.filter.ts`
- Modify: `apps/backend/src/modules/auth/auth.controller.ts`
- Modify: `apps/backend/src/app.module.ts`

**Interfaces:**
- Consumes: `AppConfig.redis` (đã có sẵn), `AllExceptionsFilter` (Task 1).
- Produces: `buildThrottlerOptions(redis: RedisConfig)`; các decorator `@Throttle` đặt trên route auth.

- [ ] **Step 1: Cài dependency**

```bash
cd /d/rong
pnpm --filter @rong/backend add @nestjs/throttler @nest-lab/throttler-storage-redis ioredis
```

- [ ] **Step 2: Viết cấu hình throttler**

Tạo `apps/backend/src/common/throttler/throttler.config.ts`:

```ts
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';

import type { RedisConfig } from '../../config/configuration.js';

const SECOND = 1000;

/**
 * Hạn mức theo IP đặt rộng có chủ ý.
 *
 * Người dùng Việt Nam vào app chủ yếu qua mạng di động, mà các nhà mạng đều
 * dùng CGNAT — hàng nghìn thuê bao chia nhau một IP công cộng. Chặn chặt theo
 * IP sẽ chặn nhầm người thật vào giờ cao điểm, mà không cản nổi kẻ tấn công có
 * sẵn một dải IP.
 *
 * Tuyến phòng thủ thật cho đăng nhập là hạn mức theo email, đặt bằng decorator
 * @Throttle ngay trên route (xem auth.controller.ts).
 */
export function buildThrottlerOptions(redis: RedisConfig): ThrottlerModuleOptions {
  return {
    throttlers: [{ name: 'default', ttl: 60 * SECOND, limit: 100 }],
    storage: new ThrottlerStorageRedisService(
      new Redis({ host: redis.host, port: redis.port }),
    ),
  };
}
```

- [ ] **Step 3: Gắn `ThrottlerModule` vào `app.module.ts`**

Thêm vào mảng `imports`, đặt trước `DatabaseModule`:

```ts
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redis = config.get<AppConfig['redis']>('redis');
        if (redis === undefined) {
          throw new Error('Chưa nạp được cấu hình redis.');
        }
        return buildThrottlerOptions(redis);
      },
    }),
```

Và đăng ký guard toàn cục trong `providers` của `AppModule`:

```ts
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
```

Thêm các import cần thiết: `APP_GUARD` từ `@nestjs/core`, `ThrottlerGuard` và `ThrottlerModule` từ `@nestjs/throttler`, `ConfigService` từ `@nestjs/config`, `AppConfig` từ `./config/configuration.js`, `buildThrottlerOptions` từ `./common/throttler/throttler.config.js`.

- [ ] **Step 4: Đặt hạn mức riêng cho các route auth**

Thêm vào `auth.controller.ts`:

```ts
import { Throttle } from '@nestjs/throttler';
```

Rồi gắn decorator:

```ts
  @Post('register')
  @Throttle({ default: { ttl: 60 * 60 * 1000, limit: 30 } })
  register(@Body() dto: RegisterDto): Promise<AuthTokens> { … }

  @Post('login')
  @Throttle({ default: { ttl: 15 * 60 * 1000, limit: 100 } })
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<AuthTokens> { … }

  @Post('guest')
  @Throttle({ default: { ttl: 60 * 60 * 1000, limit: 60 } })
  createGuest(): Promise<AuthTokens> { … }

  @Post('refresh')
  @Throttle({ default: { ttl: 60 * 60 * 1000, limit: 300 } })
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto): Promise<AuthTokens> { … }
```

- [ ] **Step 5: Thêm hạn mức theo email cho đăng nhập**

Đây mới là tuyến phòng thủ chính. Thêm vào `auth.service.ts` một hàm đếm dựa trên chính `ThrottlerStorage`:

Tạo `apps/backend/src/modules/auth/login-attempt.guard.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';

import { AppError } from '../../common/errors/app-error.js';
import { normalizeEmail } from './email.js';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

/**
 * Đếm số lần thử đăng nhập theo email chứ không theo IP.
 *
 * CGNAT khiến hạn mức theo IP vừa chặn nhầm người thật vừa không cản được kẻ
 * tấn công đổi IP. Còn dò mật khẩu của một tài khoản cụ thể thì dù đổi bao
 * nhiêu IP cũng vẫn đụng cùng một bộ đếm này.
 */
@Injectable()
export class LoginAttemptGuard implements CanActivate {
  constructor(@Inject(ThrottlerStorage) private readonly storage: ThrottlerStorage) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ body?: { email?: unknown } }>();
    const rawEmail = request.body?.email;

    if (typeof rawEmail !== 'string') {
      return true; // Không có email thì ValidationPipe sẽ từ chối ở bước sau.
    }

    const key = `login:${normalizeEmail(rawEmail)}`;
    const record = await this.storage.increment(key, WINDOW_MS, MAX_ATTEMPTS, 0, 'login');

    if (record.totalHits > MAX_ATTEMPTS) {
      throw new AppError(
        'RATE_LIMITED',
        429,
        'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng đợi ít phút rồi thử lại.',
      );
    }

    return true;
  }
}
```

Gắn vào route login trong `auth.controller.ts`:

```ts
  @Post('login')
  @UseGuards(LoginAttemptGuard)
  @Throttle({ default: { ttl: 15 * 60 * 1000, limit: 100 } })
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<AuthTokens> { … }
```

Và thêm `LoginAttemptGuard` vào `providers` của `AuthModule`.

- [ ] **Step 6: Map `ThrottlerException` sang mã `RATE_LIMITED`**

Sửa `all-exceptions.filter.ts` — thêm import và một nhánh trong `toBody`, đặt **trước** nhánh `HttpException`:

```ts
import { ThrottlerException } from '@nestjs/throttler';
```

```ts
    if (exception instanceof ThrottlerException) {
      return {
        statusCode: 429,
        code: 'RATE_LIMITED',
        message: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.',
        requestId,
      };
    }
```

- [ ] **Step 7: Thử tay để xác nhận hạn mức theo email thật sự chặn**

```bash
cd /d/rong
pnpm infra:up
pnpm --filter @rong/backend build && node apps/backend/dist/main.js &
sleep 8
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:3001/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"nan-nhan@rong.vn","password":"doan-mo"}'
done
echo
```

Expected: mười lần đầu trả `401`, các lần sau trả `429`. Nhớ tắt tiến trình sau khi thử.

- [ ] **Step 8: Kiểm tra toàn bộ và commit**

Run: `pnpm --filter @rong/backend typecheck && pnpm --filter @rong/backend lint && pnpm --filter @rong/backend test`

```bash
git add apps/backend/src apps/backend/package.json pnpm-lock.yaml
git commit -F - <<'EOF'
feat(backend): add rate limiting backed by Redis

Login is limited per email, not per IP. Vietnamese mobile carriers put
thousands of subscribers behind one public address, so a tight IP limit
would lock out real users at peak hours while an attacker with a range
of addresses walked straight past it. Guessing one account's password
hits the same email counter no matter how many addresses it comes from.

IP limits stay in place but are set wide, to stop crude scripted abuse
rather than to police individual users.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 12: Dọn tài khoản guest bỏ hoang

**Files:**
- Modify: `apps/backend/package.json` (thêm `@nestjs/schedule`)
- Create: `apps/backend/src/modules/users/guest-cleanup.service.ts`
- Create: `apps/backend/src/modules/users/guest-cleanup.service.spec.ts`
- Modify: `apps/backend/src/modules/users/users.module.ts`
- Modify: `apps/backend/src/app.module.ts`

**Interfaces:**
- Consumes: entity `User` (Task 3), `AuthConfig.guestRetentionDays` (Task 2), `AUTH_CONFIG` (Task 5).
- Produces: `GuestCleanupService.removeStaleGuests(): Promise<number>` — trả về số dòng đã xóa.

- [ ] **Step 1: Cài dependency**

```bash
cd /d/rong
pnpm --filter @rong/backend add @nestjs/schedule
```

- [ ] **Step 2: Viết test thất bại**

Tạo `apps/backend/src/modules/users/guest-cleanup.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AUTH_CONFIG } from '../auth/token.service.js';
import { GuestCleanupService } from './guest-cleanup.service.js';
import { User } from './entities/user.entity.js';

async function buildService(affected: number) {
  const execute = vi.fn(async () => ({ affected }));
  const builder = {
    delete: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    execute,
  };
  const repo = { createQueryBuilder: vi.fn(() => builder) };

  const moduleRef = await Test.createTestingModule({
    providers: [
      GuestCleanupService,
      { provide: getRepositoryToken(User), useValue: repo },
      {
        provide: AUTH_CONFIG,
        useValue: {
          jwtSecret: 'x'.repeat(32),
          accessTokenTtlSeconds: 900,
          refreshTokenTtlDays: 60,
          guestRetentionDays: 30,
        },
      },
    ],
  }).compile();

  return { service: moduleRef.get(GuestCleanupService), builder };
}

describe('GuestCleanupService', () => {
  it('chỉ xóa guest, và chỉ guest đã cũ', async () => {
    const { service, builder } = await buildService(3);

    const removed = await service.removeStaleGuests();

    expect(removed).toBe(3);
    expect(builder.where).toHaveBeenCalledWith('is_guest = true');
    const [condition, params] = builder.andWhere.mock.calls[0];
    expect(condition).toContain('last_seen_at');
    expect(params.threshold).toBeInstanceOf(Date);
  });

  it('không có gì để xóa thì trả về 0', async () => {
    const { service } = await buildService(0);

    await expect(service.removeStaleGuests()).resolves.toBe(0);
  });
});
```

- [ ] **Step 3: Chạy test để xác nhận nó thất bại**

Run: `pnpm --filter @rong/backend test src/modules/users/guest-cleanup`
Expected: FAIL — không resolve được `./guest-cleanup.service.js`.

- [ ] **Step 4: Viết `guest-cleanup.service.ts`**

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AuthConfig } from '../../config/configuration.js';
import { AUTH_CONFIG } from '../auth/token.service.js';
import { User } from './entities/user.entity.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * POST /auth/guest tạo một dòng users mỗi lần gọi, nên bảng sẽ phình vô hạn
 * nếu không dọn. Guest còn đang dùng app thì last_seen_at được cập nhật, nên
 * không bị đụng tới.
 */
@Injectable()
export class GuestCleanupService {
  private readonly logger = new Logger(GuestCleanupService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleCron(): Promise<void> {
    const removed = await this.removeStaleGuests();

    if (removed > 0) {
      this.logger.log(`Đã xóa ${removed} tài khoản dùng thử bỏ hoang.`);
    }
  }

  async removeStaleGuests(): Promise<number> {
    const threshold = new Date(Date.now() - this.config.guestRetentionDays * MS_PER_DAY);

    const result = await this.users
      .createQueryBuilder()
      .delete()
      .from(User)
      .where('is_guest = true')
      .andWhere('last_seen_at < :threshold', { threshold })
      .execute();

    return result.affected ?? 0;
  }
}
```

- [ ] **Step 5: Đăng ký service và bật scheduler**

Thêm `GuestCleanupService` vào `providers` của `UsersModule`, và thêm `AuthModule` vào `imports` nếu chưa có (cần `AUTH_CONFIG`). Vì `AUTH_CONFIG` do `AuthModule` cung cấp, thêm nó vào mảng `exports` của `AuthModule`:

```ts
  exports: [AuthService, TokenService, RefreshTokenService, JwtAuthGuard, AUTH_CONFIG],
```

Trong `app.module.ts`, thêm `ScheduleModule.forRoot()` vào mảng `imports` (import từ `@nestjs/schedule`).

- [ ] **Step 6: Chạy test để xác nhận nó pass**

Run: `pnpm --filter @rong/backend typecheck && pnpm --filter @rong/backend test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src apps/backend/package.json pnpm-lock.yaml
git commit -F - <<'EOF'
feat(backend): remove abandoned guest accounts nightly

Every call to POST /auth/guest writes a user row, so without a sweep the
table grows without bound. Guests still using the app keep refreshing
last_seen_at and are left alone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 13: Test e2e hành trình đầy đủ

**Files:**
- Create: `apps/backend/test/auth-journey.e2e-spec.ts`

**Interfaces:**
- Consumes: toàn bộ các endpoint từ Task 7–11.
- Produces: không có (đây là test).

- [ ] **Step 1: Viết test e2e**

Tạo `apps/backend/test/auth-journey.e2e-spec.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter.js';

/**
 * Cần `pnpm infra:up` và migration đã chạy. Không nằm trong `pnpm test`.
 */
describe('Hành trình xác thực (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  // Email duy nhất mỗi lần chạy, để test chạy lại được mà không cần dọn DB.
  const email = `e2e-${Date.now()}@rong.vn`;
  const password = 'mat-khau-du-dai-cho-e2e';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('guest tạo được tài khoản ẩn danh', async () => {
    const response = await request(app.getHttpServer()).post('/api/auth/guest').expect(201);

    expect(response.body.user.isGuest).toBe(true);
    expect(response.body.user.email).toBeNull();
    expect(response.body.refreshToken).toBeTruthy();
  });

  it('chạy hết hành trình: guest → upgrade → login → refresh → xóa', async () => {
    const server = app.getHttpServer();

    // 1. Guest
    const guest = await request(server).post('/api/auth/guest').expect(201);
    const guestUserId = guest.body.user.id;

    // 2. Nâng cấp — user id phải giữ nguyên
    const upgraded = await request(server)
      .post('/api/auth/upgrade')
      .set('Authorization', `Bearer ${guest.body.accessToken}`)
      .send({ email, password, displayName: 'Người dùng E2E' })
      .expect(200);

    expect(upgraded.body.user.id).toBe(guestUserId);
    expect(upgraded.body.user.isGuest).toBe(false);
    expect(upgraded.body.user.email).toBe(email);

    // 3. Refresh token của guest phải chết sau khi nâng cấp
    await request(server)
      .post('/api/auth/refresh')
      .send({ refreshToken: guest.body.refreshToken })
      .expect(401);

    // 4. Đăng nhập lại bằng mật khẩu vừa đặt
    const login = await request(server)
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);

    expect(login.body.user.id).toBe(guestUserId);

    // 5. Refresh xoay vòng: token cũ không dùng lại được
    const refreshed = await request(server)
      .post('/api/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);

    expect(refreshed.body.refreshToken).not.toBe(login.body.refreshToken);

    await request(server)
      .post('/api/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);

    // 6. Dùng lại token đã thu hồi thì mọi phiên bị cắt
    await request(server)
      .post('/api/auth/refresh')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(401);

    // 7. Hồ sơ
    const relogin = await request(server)
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);

    const profile = await request(server)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${relogin.body.accessToken}`)
      .expect(200);

    expect(profile.body.email).toBe(email);

    // 8. Xóa tài khoản
    await request(server)
      .delete('/api/users/me')
      .set('Authorization', `Bearer ${relogin.body.accessToken}`)
      .expect(204);

    // Refresh token chết ngay. LƯU Ý: không khẳng định access token bị từ
    // chối — nó là JWT stateless, còn hiệu lực tới 15 phút. Xem spec mục 2.2.
    await request(server)
      .post('/api/auth/refresh')
      .send({ refreshToken: relogin.body.refreshToken })
      .expect(401);

    // Dữ liệu đã biến mất thật, kể cả các bảng con
    const users = await dataSource.query('SELECT 1 FROM users WHERE id = $1', [guestUserId]);
    const identities = await dataSource.query(
      'SELECT 1 FROM auth_identities WHERE user_id = $1',
      [guestUserId],
    );
    const tokens = await dataSource.query('SELECT 1 FROM refresh_tokens WHERE user_id = $1', [
      guestUserId,
    ]);

    expect(users).toHaveLength(0);
    expect(identities).toHaveLength(0);
    expect(tokens).toHaveLength(0);
  });

  it('không cho đăng ký trùng email', async () => {
    const taken = `dup-${Date.now()}@rong.vn`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: taken, password })
      .expect(201);

    const conflict = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: taken.toUpperCase(), password })
      .expect(409);

    expect(conflict.body.code).toBe('EMAIL_TAKEN');
    expect(conflict.body.requestId).toBeTruthy();
  });
});
```

- [ ] **Step 2: Chạy e2e**

```bash
cd /d/rong
pnpm infra:up
pnpm --filter @rong/backend migration:run
pnpm --filter @rong/backend test:e2e
```

Expected: toàn bộ PASS, gồm cả test health sẵn có.

- [ ] **Step 3: Chạy lại lần hai để chắc chắn test không phụ thuộc trạng thái**

Run: `pnpm --filter @rong/backend test:e2e`
Expected: PASS lần nữa mà không cần dọn database — email có gắn timestamp nên mỗi lần chạy là một tài khoản khác.

- [ ] **Step 4: Chạy toàn bộ kiểm tra của monorepo**

```bash
cd /d/rong
./node_modules/.bin/turbo run build typecheck lint test --force
```

Expected: tất cả task PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/test
git commit -F - <<'EOF'
test(backend): cover the whole auth journey end to end

Walks guest → upgrade → login → refresh → delete against a real
database, then reads the tables directly to confirm the rows are gone
rather than trusting the API's word for it.

The test deliberately does not assert that an access token is rejected
right after deletion. It stays valid until it expires, and a test
claiming otherwise would be describing behaviour the system does not
have.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Self-review

**Spec coverage.** Đối chiếu từng mục của spec với task:

| Mục spec | Task |
| --- | --- |
| 2.1 Tách danh tính | 3 |
| 2.2 JWT + refresh trong DB | 5, 6 |
| 2.3 Chỉ lưu hash | 6 |
| 2.4 Xoay vòng và phát hiện đánh cắp | 6 |
| 2.5 Chặn tần suất | 11 |
| 2.6 argon2id | 4 |
| 2.7 Chuẩn hóa email | 4 |
| 3.1–3.3 Ba bảng | 3 |
| 3.4 Xóa tài khoản | 10 |
| 3.5 Dọn guest | 12 |
| 4.1 Endpoint auth | 7, 8, 9 |
| 4.2 Endpoint user | 10 |
| 4.3 Kiểu trả về | 2 |
| 4.4 Nội dung JWT | 5 |
| 4.5 Mã lỗi | 1 (khuôn) + 7–11 (từng mã) |
| 5 Guest và nâng cấp | 9 |
| 6.1 Khuôn lỗi | 1 |
| 6.2 Request id | 1 |
| 6.3 Phân trang con trỏ | 2 (chỉ kiểu) |
| 6.4 Hạn mức | 11 |
| 7.1 Unit test | 1, 2, 4, 5, 6, 7, 10, 12 |
| 7.2 E2E | 13 |

Không có mục nào thiếu task.

**Một sai lệch có chủ ý so với spec.** Spec mục 6.3 mô tả quy ước phân trang con trỏ như một phần của lớp nền. Plan này chỉ đưa **kiểu** `CursorPage<T>` vào shared-types, chưa viết hàm mã hóa/giải mã con trỏ. Lý do: S1 không có endpoint nào trả về danh sách, nên viết bộ mã hóa bây giờ là viết code không ai gọi và không test được bằng ca dùng thật. Hàm mã hóa sẽ ra đời ở S3, nơi danh sách địa điểm cần tới nó thật sự. Kiểu vẫn đặt ở đây vì nó là hợp đồng, và các lát sau cần nó để thống nhất.

**Một sai lệch so với README.** README ghi tầng xác thực là "NestJS + Passport/JWT". Plan này dùng `@nestjs/jwt` cộng một guard tự viết, bỏ Passport. Passport chỉ có ích khi phải ghép nhiều chiến lược đăng nhập khác nhau; với một chiến lược Bearer token, nó thêm ba dependency và một lớp gián tiếp mà không đổi lại được gì. Khi thêm Google OAuth ở lát sau, cân nhắc lại là hợp lý. Cần sửa lại dòng đó trong README ở Task 7 nếu muốn tài liệu khớp code.

**Kiểm tra nhất quán kiểu.** Tên và chữ ký dùng xuyên các task:

- `AppError(code, status, message)` — Task 1, dùng ở 5, 6, 7, 9, 10, 11.
- `AccessTokenPayload { sub, isGuest }` — Task 5, dùng ở 7, 9, 10.
- `AUTH_CONFIG` — khai báo ở Task 5 (`token.service.ts`), dùng ở 6, 7, 12. Task 12 yêu cầu thêm nó vào `exports` của `AuthModule`.
- `RefreshTokenService.issue / rotate / revoke / revokeAllForUser` — Task 6, dùng ở 7, 8, 9.
- `toProfile(user, email)` — khai báo ở Task 7 (`auth.service.ts`), dùng ở 8, 10.
- `AuthTokens` / `UserProfile` — Task 2, dùng ở 7, 8, 9, 10.
- `normalizeEmail` — Task 4, dùng ở 7, 9, 11.

Tất cả khớp.
