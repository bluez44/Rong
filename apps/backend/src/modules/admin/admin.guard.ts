import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import type { AdminConfig } from '../../config/configuration.js';
import type { AuthUser } from '../auth/auth.constants.js';
import { isAdminEmail, keyMatches } from './admin-access.js';

export const ADMIN_CONFIG = 'ADMIN_CONFIG';

type AdminRequest = {
  user?: AuthUser;
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
};

/**
 * Route quản trị. Chạy sau JwtAuthGuard toàn cục (không có JWT thì đã 401). Lần lượt:
 * 1. Tắt (thiếu `ADMIN_EMAILS` hoặc `ADMIN_API_KEY`) → 404.
 * 2. Người gọi phải có một email đã xác minh nằm trong `ADMIN_EMAILS` → không thì 404.
 * 3. Header `X-Admin-Key` phải khớp `ADMIN_API_KEY` → không thì 404.
 * Mọi lần từ chối đều trả 404 như route không tồn tại, và được ghi log (không ghi khóa).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger('Admin');

  constructor(
    @Inject(ADMIN_CONFIG) private readonly config: AdminConfig,
    @InjectDataSource() private readonly db: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const userId = request.user?.userId ?? null;
    const { emails, apiKey } = this.config;

    if (emails.length === 0 || !apiKey)
      return this.reject('route quản trị đang tắt', userId, request);
    if (!userId || !(await this.isAdmin(userId, emails))) {
      return this.reject('không phải admin', userId, request);
    }
    if (!keyMatches(request.headers['x-admin-key'], apiKey)) {
      return this.reject('sai hoặc thiếu X-Admin-Key', userId, request);
    }
    return true;
  }

  private async isAdmin(
    userId: string,
    emails: readonly string[],
  ): Promise<boolean> {
    const identities = (await this.db.query(
      `SELECT email, email_verified_at IS NOT NULL AS verified FROM auth_identities WHERE user_id = $1`,
      [userId],
    )) as Array<{ email: string | null; verified: boolean }>;
    return identities.some((i) =>
      isAdminEmail({ email: i.email, emailVerified: i.verified }, emails),
    );
  }

  private reject(
    reason: string,
    userId: string | null,
    request: AdminRequest,
  ): never {
    this.logger.warn(
      `Từ chối route quản trị: ${reason} (user ${userId ?? '-'}, IP ${request.ip ?? '-'})`,
    );
    throw new NotFoundException({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Không tìm thấy.',
    });
  }
}
