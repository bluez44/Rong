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
import type { LoginDto, RegisterDto } from './dto/auth.dto.js';
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
   * Tạo tài khoản ở trạng thái chưa xác minh và gửi link xác minh. Không cấp
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
          'Tài khoản chưa được kích hoạt. Hãy bấm link xác minh trong email.',
      });
    }

    const user = await this.users.findOneByOrFail({ id: identity.userId });
    await this.users.update(user.id, { lastSeenAt: new Date() });

    return this.issueAccessToken(user, [identity]);
  }

  /** Kích hoạt tài khoản bằng token trong link email. Token chỉ dùng được một lần. */
  async verifyEmail(token: string): Promise<void> {
    const identityId = await this.oneTimeTokens.consume(
      token,
      'email_verification',
    );
    if (identityId === null) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_VERIFICATION_TOKEN',
        message: 'Link xác minh không hợp lệ, đã hết hạn hoặc đã được dùng.',
      });
    }

    await this.identities.update(
      { id: identityId, emailVerifiedAt: IsNull() },
      { emailVerifiedAt: new Date() },
    );
  }

  /**
   * Gửi lại link xác minh. Luôn im lặng thành công dù email không tồn tại hay
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
    const token = await this.oneTimeTokens.issue(
      identity.id,
      'email_verification',
      this.config.emailVerificationTtlHours * 60 * 60 * 1000,
    );

    const link = new URL(this.config.emailVerificationUrl);
    link.searchParams.set('token', token);

    try {
      await this.mail.send({
        to: email,
        subject: 'Xác minh email tài khoản Rong',
        text:
          `Chào bạn,\n\n` +
          `Bấm vào link dưới đây để kích hoạt tài khoản Rong:\n${link.toString()}\n\n` +
          `Link có hiệu lực trong ${this.config.emailVerificationTtlHours} giờ. ` +
          `Nếu bạn không đăng ký tài khoản này, hãy bỏ qua email.`,
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
