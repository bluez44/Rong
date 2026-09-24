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
  emailVerificationTtlMinutes: 15,
};

/** Database giả trong bộ nhớ, đủ cho các nhánh logic của AuthService. */
function buildHarness() {
  const users: User[] = [];
  const identities: AuthIdentity[] = [];
  const codes = new Map<string, string>(); // identityId → mã còn hiệu lực

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
    issueCode: vi.fn(async (identityId: string) => {
      const code = String(100000 + codes.size);
      codes.set(identityId, code);
      return code;
    }),
    verifyCode: vi.fn(
      async (identityId: string, _purpose: string, code: string) => {
        if (codes.get(identityId) !== code) return false;
        codes.delete(identityId);
        return true;
      },
    ),
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

  /** Đọc mã từ tiêu đề email gần nhất, như người dùng nhìn thông báo trên điện thoại. */
  const lastEmailedCode = (): string => {
    const calls = mail.send.mock.calls as unknown as Array<
      [{ subject: string }]
    >;
    return calls.at(-1)![0].subject.match(/\d{6}/)![0];
  };

  return {
    service,
    users,
    identities,
    mail,
    oneTimeTokens,
    jwt,
    lastEmailedCode,
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
    expect(h.lastEmailedCode()).toBe('100000');
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

  it('nhập đúng mã thì được đăng nhập luôn, và sau đó đăng nhập bằng mật khẩu được', async () => {
    await h.service.register({
      email: 'ha@rong.vn',
      password: 'mat-khau-du-dai',
    });

    const verified = await h.service.verifyEmail({
      email: ' HA@rong.vn',
      code: h.lastEmailedCode(),
    });
    expect(verified.user.emailVerified).toBe(true);
    expect(h.jwt.verify(verified.accessToken)).toMatchObject({ sub: 'user-1' });

    const result = await h.service.login({
      email: 'HA@rong.vn',
      password: 'mat-khau-du-dai',
    });

    expect(result.expiresIn).toBe(900);
    expect(result.user.emailVerified).toBe(true);
    expect(h.jwt.verify(result.accessToken)).toMatchObject({ sub: 'user-1' });
  });

  it('mã sai, mã dùng lại và email lạ đều trả cùng một mã lỗi', async () => {
    await h.service.register({
      email: 'ha@rong.vn',
      password: 'mat-khau-du-dai',
    });
    const code = h.lastEmailedCode();

    await expect(
      errorCode(h.service.verifyEmail({ email: 'ha@rong.vn', code: '999999' })),
    ).resolves.toBe('INVALID_VERIFICATION_CODE');

    await h.service.verifyEmail({ email: 'ha@rong.vn', code });
    await expect(
      errorCode(h.service.verifyEmail({ email: 'ha@rong.vn', code })),
    ).resolves.toBe('INVALID_VERIFICATION_CODE');

    await expect(
      errorCode(h.service.verifyEmail({ email: 'khong-co@rong.vn', code })),
    ).resolves.toBe('INVALID_VERIFICATION_CODE');
  });

  it('không so mã với tài khoản đã xác minh', async () => {
    await h.service.register({
      email: 'ha@rong.vn',
      password: 'mat-khau-du-dai',
    });
    await h.service.verifyEmail({
      email: 'ha@rong.vn',
      code: h.lastEmailedCode(),
    });
    h.oneTimeTokens.verifyCode.mockClear();

    await errorCode(
      h.service.verifyEmail({ email: 'ha@rong.vn', code: '123456' }),
    );

    expect(h.oneTimeTokens.verifyCode).not.toHaveBeenCalled();
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

    await h.service.verifyEmail({
      email: 'ha@rong.vn',
      code: h.lastEmailedCode(),
    });
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
