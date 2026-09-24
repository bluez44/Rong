/**
 * Đọc và kiểm tra biến môi trường một lần lúc khởi động.
 *
 * Thiếu biến bắt buộc thì app phải chết ngay khi boot, chứ không phải chết lúc
 * 2 giờ sáng ở request đầu tiên chạm tới nó.
 */

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

export interface RedisConfig {
  host: string;
  port: number;
}

export interface AuthConfig {
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  emailVerificationTtlMinutes: number;
}

export interface MailConfig {
  /** Để trống thì không gửi thật mà chỉ ghi nội dung email ra log (dùng khi dev). */
  smtpHost: string | null;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string | null;
  smtpPassword: string | null;
  from: string;
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  database: DatabaseConfig;
  redis: RedisConfig;
  auth: AuthConfig;
  mail: MailConfig;
}

class MissingEnvError extends Error {
  constructor(keys: string[]) {
    super(
      `Thiếu biến môi trường bắt buộc: ${keys.join(', ')}.\n` +
        `Sao chép apps/backend/.env.example thành apps/backend/.env rồi điền giá trị.`,
    );
    this.name = 'MissingEnvError';
  }
}

function requireEnv(keys: string[]): void {
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new MissingEnvError(missing);
  }
}

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

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function loadConfig(): AppConfig {
  requireEnv([
    'DB_HOST',
    'DB_PORT',
    'DB_USERNAME',
    'DB_PASSWORD',
    'DB_DATABASE',
    'JWT_SECRET',
  ]);

  const nodeEnv = (process.env.NODE_ENV ??
    'development') as AppConfig['nodeEnv'];

  return {
    nodeEnv,
    port: toInt(process.env.PORT, 3001),
    database: {
      host: process.env.DB_HOST as string,
      port: toInt(process.env.DB_PORT, 5432),
      username: process.env.DB_USERNAME as string,
      password: process.env.DB_PASSWORD as string,
      database: process.env.DB_DATABASE as string,
    },
    redis: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: toInt(process.env.REDIS_PORT, 6379),
    },
    auth: {
      jwtSecret: requireStrongSecret(process.env.JWT_SECRET as string),
      accessTokenTtlSeconds: toInt(process.env.ACCESS_TOKEN_TTL_SECONDS, 900),
      emailVerificationTtlMinutes: toInt(
        process.env.EMAIL_VERIFICATION_TTL_MINUTES,
        15,
      ),
    },
    mail: {
      smtpHost: process.env.SMTP_HOST || null,
      smtpPort: toInt(process.env.SMTP_PORT, 587),
      smtpSecure: process.env.SMTP_SECURE === 'true',
      smtpUser: process.env.SMTP_USER || null,
      smtpPassword: process.env.SMTP_PASSWORD || null,
      from: process.env.MAIL_FROM || 'Rong <no-reply@rong.local>',
    },
  };
}
