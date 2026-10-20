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
  url?: string;
}

export interface RedisConfig {
  host: string;
  port: number;
}

export interface AuthConfig {
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  /** Không mở app chừng này ngày thì phải đăng nhập lại; mỗi lần đổi token thì tính lại từ đầu. */
  refreshTokenTtlDays: number;
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
  resendApiKey: string | null;
}

/** Nguồn dữ liệu mở (OSM, Wikidata) — mục 7.1 PRD. */
export interface OpenDataConfig {
  nominatimUrl: string;
  /** Nominatim bắt buộc User-Agent có thông tin liên hệ. */
  contactEmail: string;
}

/** Google Maps Platform — chỉ module `google/` được dùng (PRD 7.4). */
export interface GoogleConfig {
  /** Để trống thì màn hình chi tiết chỉ có dữ liệu riêng, không có phần Google. */
  mapsApiKey: string | null;
  placesUrl: string;
}

/** Chia sẻ vào app (F4). */
export interface ShareImportConfig {
  /** Số lượt chia sẻ tối đa mỗi người trong 24 giờ: giữ chi phí Gemini và Google. */
  dailyLimit: number;
  /** Token Meta (app|client) cho oEmbed Facebook/Instagram; trống thì đọc Open Graph. */
  metaOembedToken: string | null;
}

/** Danh sách địa điểm từ bài viết (spec 2026-10-14-web-places). */
export interface WebPlacesConfig {
  /** Sau bao nhiêu ngày thì tổng hợp lại danh sách của một vùng (khớp hạn tọa độ Google). */
  refreshDays: number;
  /** Lần đầu mở vùng: chờ pipeline tối đa chừng này rồi trả `building`. */
  waitMs: number;
  /**
   * Ghép địa điểm từ bài viết với Google Places để lấy tọa độ. Tắt mặc định: Việt Nam nằm trong
   * Prohibited Territories của Google Maps Platform, Places trả 403; tắt thì dùng tọa độ AI ("Vị trí gần đúng").
   */
  googleMatch: boolean;
}

/** Tìm địa điểm theo tên trong màn vùng. */
export interface PlaceSearchConfig {
  /** Số lượt tìm Google Maps tối đa mỗi người trong 24 giờ. */
  dailyLimit: number;
  /** Số lượt xem trước/lưu địa điểm Google (gọi Google thật) mỗi người trong 24 giờ. */
  detailsDailyLimit: number;
}

/** Link mời nhóm (F10): xác minh Android App Links cho `/invite/:token`. */
export interface InviteLinksConfig {
  /** SHA-256 chứng chỉ ký APK, cho `/.well-known/assetlinks.json`. Rỗng thì Android mở trang web thay vì app. */
  androidSha256: string[];
}

/** Gợi ý lịch trình trang chủ (spec 2026-10-19-home-recommendations). */
export interface RecommendationsConfig {
  /** Dùng BullMQ + Redis. Tắt (hoặc NODE_ENV=test) thì job chạy ngay trong process, không có lịch cron. */
  queueEnabled: boolean;
  /** Unsplash Search API; trống thì chỉ dùng ảnh từ bài viết. */
  unsplashAccessKey: string | null;
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  database: DatabaseConfig;
  redis: RedisConfig;
  auth: AuthConfig;
  mail: MailConfig;
  openData: OpenDataConfig;
  google: GoogleConfig;
  shareImport: ShareImportConfig;
  placeSearch: PlaceSearchConfig;
  webPlaces: WebPlacesConfig;
  inviteLinks: InviteLinksConfig;
  recommendations: RecommendationsConfig;
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

/** Số nguyên ≥ 1; để trống thì dùng mặc định, sai thì dừng khi khởi động. */
function positiveInt(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < 1) {
    throw new Error(`${key} phải là số nguyên ≥ 1 (đang là "${raw}").`);
  }
  return value;
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
      url: process.env.DATABASE_URL || undefined,
    },
    redis: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: toInt(process.env.REDIS_PORT, 6379),
    },
    auth: {
      jwtSecret: requireStrongSecret(process.env.JWT_SECRET as string),
      accessTokenTtlSeconds: toInt(process.env.ACCESS_TOKEN_TTL_SECONDS, 900),
      refreshTokenTtlDays: toInt(process.env.REFRESH_TOKEN_TTL_DAYS, 60),
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
      resendApiKey: process.env.RESEND_API_KEY || null,
    },
    openData: {
      nominatimUrl:
        process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org',
      contactEmail: process.env.OPEN_DATA_CONTACT_EMAIL || 'dev@rong.local',
    },
    google: {
      mapsApiKey: process.env.GOOGLE_MAPS_API_KEY || null,
      placesUrl:
        process.env.GOOGLE_PLACES_URL || 'https://places.googleapis.com/v1',
    },
    shareImport: {
      dailyLimit: toInt(process.env.SHARE_IMPORT_DAILY_LIMIT, 30),
      metaOembedToken: process.env.META_OEMBED_TOKEN || null,
    },
    webPlaces: {
      refreshDays: positiveInt('WEB_PLACES_REFRESH_DAYS', 30),
      waitMs: positiveInt('WEB_PLACES_WAIT_MS', 25000),
      googleMatch: process.env.WEB_PLACES_GOOGLE_MATCH === 'true',
    },
    placeSearch: {
      dailyLimit: positiveInt('PLACE_SEARCH_DAILY_LIMIT', 60),
      detailsDailyLimit: positiveInt('PLACE_DETAILS_DAILY_LIMIT', 150),
    },
    inviteLinks: {
      androidSha256: (process.env.ANDROID_APP_LINK_SHA256 ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    },
    recommendations: {
      queueEnabled: recommendationsQueueEnabled(process.env),
      unsplashAccessKey: process.env.UNSPLASH_ACCESS_KEY || null,
    },
  };
}

/**
 * e2e (vitest đặt NODE_ENV=test) luôn chạy job trong process, không cần Redis. Production
 * chỉ bật khi có REDIS_HOST: compose production chưa có Redis, không để mặc định
 * "localhost" khiến hàng đợi bật mà không bao giờ nối được.
 */
export function recommendationsQueueEnabled(env: NodeJS.ProcessEnv): boolean {
  return (
    env.NODE_ENV !== 'test' &&
    env.RECOMMENDATIONS_ENABLED !== 'false' &&
    (env.NODE_ENV !== 'production' || Boolean(env.REDIS_HOST))
  );
}
