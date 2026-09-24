import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { AuthTokens, RegisterResult } from '@rong/shared-types';
import { DataSource, IsNull, QueryFailedError, Repository } from 'typeorm';

import type { AuthConfig } from '../../config/configuration.js';
import { MailService } from '../mail/mail.service.js';
import { User } from '../users/entities/user.entity.js';
import { toProfile } from '../users/users.service.js';
import { AUTH_CONFIG, type AccessTokenPayload } from './auth.constants.js';
import type { LoginDto, RegisterDto, VerifyEmailDto } from './dto/auth.dto.js';
import { normalizeEmail } from './email.js';
import { AuthIdentity } from './entities/auth-identity.entity.js';
import { OneTimeTokenService } from './one-time-token.service.js';
import { PasswordService } from './password.service.js';

/** Chặn việc bấm "gửi lại email" liên tục biến backend thành máy spam hộp thư người khác. */
const RESEND_COOLDOWN_MS = 60_000;

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AuthIdentity)
    private readonly identities: Repository<AuthIdentity>,
    private readonly passwords: PasswordService,
    private readonly oneTimeTokens: OneTimeTokenService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  /**
   * Tạo tài khoản ở trạng thái chưa xác minh và gửi mã xác minh. Không cấp
   * token: tài khoản chỉ đăng nhập được sau khi chứng minh sở hữu email.
   */
  async register(dto: RegisterDto): Promise<RegisterResult> {
    const email = normalizeEmail(dto.email);
    if (await this.findPasswordIdentity(email)) {
      throw this.emailTaken();
    }

    const passwordHash = await this.passwords.hash(dto.password);

    let user: User;
    let identity: AuthIdentity;
    try {
      [user, identity] = await this.dataSource.transaction(async (manager) => {
        const createdUser = await manager.save(
          manager.create(User, {
            displayName: dto.displayName?.trim() || null,
          }),
        );
        const createdIdentity = await manager.save(
          manager.create(AuthIdentity, {
            userId: createdUser.id,
            provider: 'password',
            providerAccountId: email,
            email,
            passwordHash,
            emailVerifiedAt: null,
          }),
        );
        return [createdUser, createdIdentity] as const;
      });
    } catch (error) {
      // Hai request đăng ký cùng email chạy song song: request thua đụng unique index.
      if (
        error instanceof QueryFailedError &&
        (error as { code?: string }).code === PG_UNIQUE_VIOLATION
      ) {
        throw this.emailTaken();
      }
      throw error;
    }

    await this.sendVerificationEmail(identity);

    return {
      user: toProfile(user, [identity]),
      verificationEmailSentTo: email,
    };
  }

  async login(dto: LoginDto): Promise<AuthTokens> {
    const identity = await this.findPasswordIdentity(normalizeEmail(dto.email));

    // Email không tồn tại hay sai mật khẩu đều trả cùng một lỗi, để form đăng
    // nhập không thành công cụ dò xem ai đã có tài khoản.
    if (
      identity?.passwordHash == null ||
      !(await this.passwords.verify(identity.passwordHash, dto.password))
    ) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Email hoặc mật khẩu không đúng.',
      });
    }

    // Chỉ báo "chưa xác minh" sau khi mật khẩu đã đúng, nên không lộ thêm gì.
    if (identity.emailVerifiedAt === null) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'EMAIL_NOT_VERIFIED',
        message:
          'Tài khoản chưa được kích hoạt. Hãy nhập mã xác minh đã gửi tới email.',
      });
    }

    const user = await this.users.findOneByOrFail({ id: identity.userId });
    await this.users.update(user.id, { lastSeenAt: new Date() });

    return this.issueAccessToken(user, [identity]);
  }

  /**
   * Kích hoạt tài khoản bằng mã 6 chữ số rồi đăng nhập luôn: người dùng vừa
   * chứng minh sở hữu email, bắt nhập lại mật khẩu chỉ thêm một bước thừa.
   *
   * Email không tồn tại, đã xác minh, mã sai, hết hạn hay nhập sai quá số lần
   * đều trả cùng một lỗi, để endpoint này không dùng được để dò tài khoản.
   */
  async verifyEmail(dto: VerifyEmailDto): Promise<AuthTokens> {
    const identity = await this.findPasswordIdentity(normalizeEmail(dto.email));

    const valid =
      identity !== null &&
      identity.emailVerifiedAt === null &&
      (await this.oneTimeTokens.verifyCode(
        identity.id,
        'email_verification',
        dto.code,
      ));
    if (!valid) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_VERIFICATION_CODE',
        message:
          'Mã xác minh không đúng hoặc đã hết hạn. Hãy thử lại hoặc yêu cầu gửi mã mới.',
      });
    }

    identity.emailVerifiedAt = new Date();
    await this.identities.update(
      { id: identity.id, emailVerifiedAt: IsNull() },
      { emailVerifiedAt: identity.emailVerifiedAt },
    );

    const user = await this.users.findOneByOrFail({ id: identity.userId });
    await this.users.update(user.id, { lastSeenAt: new Date() });

    return this.issueAccessToken(user, [identity]);
  }

  /**
   * Gửi lại mã xác minh (mã cũ mất hiệu lực). Luôn im lặng thành công dù email không tồn tại hay
   * đã xác minh, để endpoint này không bị dùng để dò tài khoản.
   */
  async resendVerification(rawEmail: string): Promise<void> {
    const identity = await this.findPasswordIdentity(normalizeEmail(rawEmail));
    if (identity === null || identity.emailVerifiedAt !== null) {
      return;
    }

    const tooSoon = await this.oneTimeTokens.issuedRecently(
      identity.id,
      'email_verification',
      RESEND_COOLDOWN_MS,
    );
    if (tooSoon) {
      return;
    }

    await this.sendVerificationEmail(identity);
  }

  private issueAccessToken(user: User, identities: AuthIdentity[]): AuthTokens {
    const payload: AccessTokenPayload = { sub: user.id };
    return {
      accessToken: this.jwt.sign(payload),
      expiresIn: this.config.accessTokenTtlSeconds,
      user: toProfile(user, identities),
    };
  }

  private async sendVerificationEmail(identity: AuthIdentity): Promise<void> {
    const email = identity.email as string;
    const ttlMinutes = this.config.emailVerificationTtlMinutes;
    const code = await this.oneTimeTokens.issueCode(
      identity.id,
      'email_verification',
      ttlMinutes * 60 * 1000,
    );

    try {
      await this.mail.send({
        to: email,
        // Mã nằm ngay trong tiêu đề để người dùng đọc được từ thông báo, khỏi mở mail.
        subject: `Mã xác minh Rong: ${code}`,
        text:
          `Chào bạn,\n\n` +
          `Mã xác minh tài khoản Rong của bạn là: ${code}\n\n` +
          `Nhập mã này trong app để kích hoạt tài khoản. ` +
          `Mã có hiệu lực trong ${ttlMinutes} phút. ` +
          `Nếu bạn không đăng ký tài khoản này, hãy bỏ qua email.`,
        html: verificationEmailHtml(code, ttlMinutes),
      });
    } catch (error) {
      // Tài khoản đã tạo xong; gửi mail lỗi thì người dùng vẫn có thể bấm "gửi lại".
      this.logger.error(
        `Gửi email xác minh tới ${email} thất bại`,
        error as Error,
      );
    }
  }

  private findPasswordIdentity(email: string): Promise<AuthIdentity | null> {
    return this.identities.findOneBy({
      provider: 'password',
      providerAccountId: email,
    });
  }

  private emailTaken(): ConflictException {
    return new ConflictException({
      statusCode: 409,
      code: 'EMAIL_TAKEN',
      message: 'Email này đã được đăng ký.',
    });
  }
}

function verificationEmailHtml(code: string, ttlMinutes: number): string {
  return `<!doctype html>
<html lang="vi">
  <body style="margin:0;padding:24px;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1917">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
      <h1 style="margin:0 0 16px;font-size:20px">Xác minh email tài khoản Rong</h1>
      <p style="margin:0 0 24px;line-height:1.5">Nhập mã dưới đây trong app để kích hoạt tài khoản:</p>
      <p style="margin:0 0 24px;font-size:36px;font-weight:700;letter-spacing:8px;text-align:center;font-family:ui-monospace,Menlo,monospace">${code}</p>
      <p style="margin:0;font-size:14px;line-height:1.5;color:#57534e">Mã có hiệu lực trong ${ttlMinutes} phút. Nếu bạn không đăng ký tài khoản này, hãy bỏ qua email.</p>
    </div>
  </body>
</html>`;
}
