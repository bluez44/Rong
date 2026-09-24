import { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthConfig } from '../../config/configuration.js';
import type { MailService } from '../mail/mail.service.js';
import { User } from '../users/entities/user.entity.js';
import { AuthService } from './auth.service.js';
import { AuthIdentity } from './entities/auth-identity.entity.js';
import type { OneTimeTokenService } from './one-time-token.service.js';
import { PasswordService } from './password.service.js';

const CONFIG: AuthConfig = {
  jwtSecret: 'khoa-bi-mat-du-dai-cho-test-32-ky-tu',
  accessTokenTtlSeconds: 900,
  emailVerificationTtlHours: 24,
  emailVerificationUrl: 'https://rong.test/verify-email',
};

/** Database giả trong bộ nhớ, đủ cho các nhánh logic của AuthService. */
function buildHarness() {
  const users: User[] = [];
  const identities: AuthIdentity[] = [];
  const tokens = new Map<string, string>(); // token gốc → identityId

  const manager = {
    create: (_entity: unknown, data: object) => ({ ...data }),
    save: vi.fn(async (row: Partial<User & AuthIdentity>) => {
      if ('providerAccountId' in row) {
        const identity = Object.assign(new AuthIdentity(), row, {
          id: `identity-${identities.length + 1}`,
        });
        identities.push(identity);
        return identity;
      }
      const user = Object.assign(new User(), row, {
        id: `user-${users.length + 1}`,
        createdAt: new Date('2026-09-21T00:00:00Z'),
      });
      users.push(user);
      return user;
    }),
  };

  const dataSource = {
    transaction: vi.fn(async (work: (m: typeof manager) => unknown) =>
      work(manager),
    ),
  };
  const userRepo = {
    findOneByOrFail: vi.fn(async ({ id }: { id: string }) => {
      const user = users.find((row) => row.id === id);
      if (!user) throw new Error('not found');
      return user;
    }),
    update: vi.fn(async () => undefined),
  };
  const identityRepo = {
    findOneBy: vi.fn(
      async (where: { provider: string; providerAccountId: string }) =>
        identities.find(
          (row) =>
            row.provider === where.provider &&
            row.providerAccountId === where.providerAccountId,
        ) ?? null,
    ),
    update: vi.fn(
      async ({ id }: { id: string }, patch: Partial<AuthIdentity>) => {
        const identity = identities.find((row) => row.id === id);
        if (identity && identity.emailVerifiedAt === null)
          Object.assign(identity, patch);
      },
    ),
  };
  const oneTimeTokens = {
    issue: vi.fn(async (identityId: string) => {
      const raw = `token-${tokens.size + 1}`;
      tokens.set(raw, identityId);
      return raw;
    }),
    consume: vi.fn(async (raw: string) => {
      const identityId = tokens.get(raw) ?? null;
      tokens.delete(raw);
      return identityId;
    }),
    issuedRecently: vi.fn(async () => false),
  };
  const mail = { send: vi.fn(async () => undefined) };
  const jwt = new JwtService({ secret: CONFIG.jwtSecret });

  const service = new AuthService(
    dataSource as never,
    userRepo as never,
    identityRepo as never,
    new PasswordService(),
    oneTimeTokens as unknown as OneTimeTokenService,
    jwt,
    mail as unknown as MailService,
    CONFIG,
  );

  /** Lấy token từ link trong email gần nhất, như người dùng bấm link. */
  const lastEmailedToken = (): string => {
    const calls = mail.send.mock.calls as unknown as Array<[{ text: string }]>;
    const text = calls.at(-1)![0].text;
    return new URL(text.match(/https:\/\/\S+/)![0]).searchParams.get('token')!;
  };

  return {
    service,
    users,
    identities,
    mail,
    oneTimeTokens,
    jwt,
    lastEmailedToken,
  };
}

const errorCode = (promise: Promise<unknown>) =>
  promise.then(
    () => 'không có lỗi',
    (error: { getResponse(): { code: string } }) => error.getResponse().code,
  );

describe('AuthService', () => {
  let h: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    h = buildHarness();
  });

  it('đăng ký tạo user + identity password chưa xác minh và gửi email xác minh', async () => {
    const result = await h.service.register({
      email: '  Linh@Example.COM ',
      password: 'mat-khau-du-dai',
      displayName: 'Linh',
    });

    expect(result.verificationEmailSentTo).toBe('linh@example.com');
    expect(result.user).toMatchObject({
      email: 'linh@example.com',
      emailVerified: false,
      displayName: 'Linh',
    });
    expect(h.identities[0]).toMatchObject({
      provider: 'password',
      providerAccountId: 'linh@example.com',
      emailVerifiedAt: null,
    });
    expect(h.identities[0].passwordHash).not.toContain('mat-khau-du-dai');
    expect(h.mail.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'linh@example.com' }),
    );
    expect(h.lastEmailedToken()).toBe('token-1');
  });

  it('từ chối email đã đăng ký (không phân biệt hoa thường)', async () => {
    await h.service.register({
      email: 'linh@example.com',
      password: 'mat-khau-du-dai',
    });

    await expect(
      errorCode(
        h.service.register({
          email: 'LINH@example.com',
          password: 'mat-khau-khac',
        }),
      ),
    ).resolves.toBe('EMAIL_TAKEN');
  });

  it('không cho đăng nhập trước khi xác minh email', async () => {
    await h.service.register({
      email: 'ha@rong.vn',
      password: 'mat-khau-du-dai',
    });

    await expect(
      errorCode(
        h.service.login({ email: 'ha@rong.vn', password: 'mat-khau-du-dai' }),
      ),
    ).resolves.toBe('EMAIL_NOT_VERIFIED');
  });

  it('xác minh xong thì đăng nhập được và nhận JWT chứa user id', async () => {
    await h.service.register({
      email: 'ha@rong.vn',
      password: 'mat-khau-du-dai',
    });
    await h.service.verifyEmail(h.lastEmailedToken());

    const result = await h.service.login({
      email: 'HA@rong.vn',
      password: 'mat-khau-du-dai',
    });

    expect(result.expiresIn).toBe(900);
    expect(result.user.emailVerified).toBe(true);
    expect(h.jwt.verify(result.accessToken)).toMatchObject({ sub: 'user-1' });
  });

  it('token xác minh sai hoặc dùng lại bị từ chối', async () => {
    await h.service.register({
      email: 'ha@rong.vn',
      password: 'mat-khau-du-dai',
    });
    const token = h.lastEmailedToken();
    await h.service.verifyEmail(token);

    await expect(errorCode(h.service.verifyEmail(token))).resolves.toBe(
      'INVALID_VERIFICATION_TOKEN',
    );
    await expect(errorCode(h.service.verifyEmail('bia-dat'))).resolves.toBe(
      'INVALID_VERIFICATION_TOKEN',
    );
  });

  it('sai mật khẩu và email không tồn tại trả về cùng một mã lỗi', async () => {
    await h.service.register({
      email: 'ha@rong.vn',
      password: 'mat-khau-du-dai',
    });

    await expect(
      errorCode(h.service.login({ email: 'ha@rong.vn', password: 'sai-bet' })),
    ).resolves.toBe('INVALID_CREDENTIALS');
    await expect(
      errorCode(
        h.service.login({ email: 'khong-co@rong.vn', password: 'bat-ky' }),
      ),
    ).resolves.toBe('INVALID_CREDENTIALS');
  });

  it('gửi lại email chỉ khi tài khoản tồn tại và chưa xác minh', async () => {
    await h.service.register({
      email: 'ha@rong.vn',
      password: 'mat-khau-du-dai',
    });
    h.mail.send.mockClear();

    await h.service.resendVerification('khong-co@rong.vn');
    expect(h.mail.send).not.toHaveBeenCalled();

    await h.service.resendVerification('ha@rong.vn');
    expect(h.mail.send).toHaveBeenCalledTimes(1);

    await h.service.verifyEmail(h.lastEmailedToken());
    h.mail.send.mockClear();
    await h.service.resendVerification('ha@rong.vn');
    expect(h.mail.send).not.toHaveBeenCalled();
  });

  it('không gửi lại email khi vừa gửi trong vòng một phút', async () => {
    await h.service.register({
      email: 'ha@rong.vn',
      password: 'mat-khau-du-dai',
    });
    h.mail.send.mockClear();
    h.oneTimeTokens.issuedRecently.mockResolvedValueOnce(true);

    await h.service.resendVerification('ha@rong.vn');

    expect(h.mail.send).not.toHaveBeenCalled();
  });

  it('gửi mail lỗi không làm hỏng việc đăng ký', async () => {
    h.mail.send.mockRejectedValueOnce(new Error('SMTP sập'));

    await expect(
      h.service.register({ email: 'ha@rong.vn', password: 'mat-khau-du-dai' }),
    ).resolves.toMatchObject({ verificationEmailSentTo: 'ha@rong.vn' });
  });
});
