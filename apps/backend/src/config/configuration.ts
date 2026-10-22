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
  /** Redis có ACL (Redis Cloud: `default`); trống thì chỉ gửi mật khẩu. */
  username?: string;
  password?: string;
  /** `REDIS_TLS=true`: ioredis bật TLS khi có khóa `tls`. */
  tls?: Record<string, never>;
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
  /** Lượt 1 lưu ít hơn chừng này địa điểm thì chạy lượt 2 (spec 2026-10-21-ward-search §3). */
  minCount: number;
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

/** Link xem lịch trình trên web (FR-10.3). */
export interface ShareLinksConfig {
  /** Khóa HMAC suy ra token từ id link (`share-link-token.ts`). Mặc định dùng `JWT_SECRET`. */
  secret: string;
}

/** Đăng nhập Google / Zalo (spec 2026-10-21-google-zalo-login). Thiếu giá trị = tắt nhà cung cấp đó. */
export interface OAuthConfig {
  /** Client ID được chấp nhận làm `aud` của ID token Google (Web client). */
  googleClientIds: string[];
  zaloAppId: string | null;
  zaloAppSecret: string | null;
}

/** Gợi ý lịch trình trang chủ (spec 2026-10-19-home-recommendations). */
export interface RecommendationsConfig {
  /** Dùng BullMQ + Redis. Tắt (hoặc NODE_ENV=test) thì job chạy ngay trong process, không có lịch cron. */
  queueEnabled: boolean;
  /** Unsplash Search API; trống thì chỉ dùng ảnh từ bài viết. */
  unsplashAccessKey: string | null;
}

/** Thời tiết theo ngày của chuyến (spec 2026-10-22-trip-weather). Chỉ module `weather/` gọi Open-Meteo. */
export interface WeatherConfig {
  /** Tắt thì endpoint trả `unavailable`, thẻ gợi ý `weather: null`. Mặc định tắt khi NODE_ENV=test (e2e không gọi mạng). */
  enabled: boolean;
  forecastUrl: string;
  archiveUrl: string;
  /** User-Agent có thông tin liên hệ, như Nominatim. */
  contactEmail: string;
  /** Số vùng tính khí hậu mới mỗi ngày (mỗi vùng ~260 lượt của bản miễn phí). */
  climateDailyLimit: number;
}

/**
 * Route quản trị (reset địa điểm của vùng). Tắt (route trả 404) khi thiếu `emails` hoặc `apiKey`: gọi được phải
 * đăng nhập bằng tài khoản có email đã xác minh nằm trong `emails` và gửi kèm khóa.
 */
export interface AdminConfig {
  /** `ADMIN_EMAILS`, viết thường. */
  emails: string[];
  /** `ADMIN_API_KEY` (≥ 32 ký tự), so với header `X-Admin-Key`. */
  apiKey: string | null;
  /** Số lần reset tối đa của cả hệ thống trong 24 giờ (mỗi lần tốn phí Tavily + Gemini). */
  refreshDailyLimit: number;
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
  shareLinks: ShareLinksConfig;
  oauth: OAuthConfig;
  recommendations: RecommendationsConfig;
  admin: AdminConfig;
  weather: WeatherConfig;
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

function requireStrongSecret(value: string, name = 'JWT_SECRET'): string {
  if (value.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `${name} phải dài ít nhất ${MIN_JWT_SECRET_LENGTH} ký tự. ` +
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

/**
 * `redis://[user]:[mật khẩu]@host:cổng` (Render, Redis Cloud); `rediss://` = TLS.
 * Thay cho REDIS_HOST/PORT/USERNAME/PASSWORD/TLS khi được đặt.
 */
function parseRedisUrl(raw: string): RedisConfig {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('REDIS_URL không phải URL hợp lệ.');
  }
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error('REDIS_URL phải bắt đầu bằng redis:// hoặc rediss://.');
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.username && { username: decodeURIComponent(url.username) }),
    ...(url.password && { password: decodeURIComponent(url.password) }),
    ...(url.protocol === 'rediss:' && { tls: {} }),
  };
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
    redis: process.env.REDIS_URL
      ? parseRedisUrl(process.env.REDIS_URL)
      : {
          host: process.env.REDIS_HOST || 'localhost',
          port: toInt(process.env.REDIS_PORT, 6379),
          ...(process.env.REDIS_USERNAME && {
            username: process.env.REDIS_USERNAME,
          }),
          ...(process.env.REDIS_PASSWORD && {
            password: process.env.REDIS_PASSWORD,
          }),
          ...(process.env.REDIS_TLS === 'true' && { tls: {} }),
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
      minCount: positiveInt('WEB_PLACES_MIN_COUNT', 10),
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
    shareLinks: {
      secret: process.env.SHARE_LINK_SECRET
        ? requireStrongSecret(
            process.env.SHARE_LINK_SECRET,
            'SHARE_LINK_SECRET',
          )
        : (process.env.JWT_SECRET as string),
    },
    oauth: {
      googleClientIds: (process.env.GOOGLE_OAUTH_CLIENT_IDS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      zaloAppId: process.env.ZALO_APP_ID || null,
      zaloAppSecret: process.env.ZALO_APP_SECRET || null,
    },
    recommendations: {
      queueEnabled: recommendationsQueueEnabled(process.env),
      unsplashAccessKey: process.env.UNSPLASH_ACCESS_KEY || null,
    },
    admin: {
      emails: (process.env.ADMIN_EMAILS ?? '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
      apiKey: process.env.ADMIN_API_KEY
        ? requireStrongSecret(process.env.ADMIN_API_KEY, 'ADMIN_API_KEY')
        : null,
      refreshDailyLimit: positiveInt('ADMIN_REFRESH_DAILY_LIMIT', 30),
    },
    weather: {
      enabled: process.env.WEATHER_ENABLED
        ? process.env.WEATHER_ENABLED !== 'false'
        : process.env.NODE_ENV !== 'test',
      forecastUrl:
        process.env.OPEN_METEO_FORECAST_URL || 'https://api.open-meteo.com',
      archiveUrl:
        process.env.OPEN_METEO_ARCHIVE_URL ||
        'https://archive-api.open-meteo.com',
      contactEmail: process.env.OPEN_DATA_CONTACT_EMAIL || 'dev@rong.local',
      climateDailyLimit: positiveInt('WEATHER_CLIMATE_DAILY_LIMIT', 25),
    },
  };
}

/**
 * e2e (vitest đặt NODE_ENV=test) luôn chạy job trong process, không cần Redis. Production
 * chỉ bật khi có REDIS_URL hoặc REDIS_HOST: không để mặc định "localhost" khiến hàng đợi
 * bật mà không bao giờ nối được.
 */
export function recommendationsQueueEnabled(env: NodeJS.ProcessEnv): boolean {
  return (
    env.NODE_ENV !== 'test' &&
    env.RECOMMENDATIONS_ENABLED !== 'false' &&
    (env.NODE_ENV !== 'production' ||
      Boolean(env.REDIS_URL) ||
      Boolean(env.REDIS_HOST))
  );
}
