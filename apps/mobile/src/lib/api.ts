/**
 * Gọi backend NestJS (prefix /api). Lỗi luôn được đổi thành ApiError có
 * `code` ổn định để màn hình rẽ nhánh, và `message` tiếng Việt để hiển thị.
 */

const BASE_URL = `${(process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '')}/api`;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** Mã lỗi của backend (ví dụ `EMAIL_TAKEN`), `NETWORK_ERROR` khi không tới được máy chủ, `VALIDATION_ERROR` khi DTO từ chối. */
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  token?: string | null;
};

export async function apiFetch<T>(path: string, { method = 'GET', body, token }: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(BASE_URL + path, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.');
  }

  if (response.status === 204) return undefined as T;

  const data: unknown = await response.json().catch(() => null);
  if (response.ok) return data as T;

  throw toApiError(response.status, data);
}

function toApiError(status: number, data: unknown): ApiError {
  const payload = (data ?? {}) as { code?: unknown; message?: unknown };
  // ValidationPipe trả `message` là mảng các lỗi theo từng trường.
  if (Array.isArray(payload.message)) {
    return new ApiError(status, 'VALIDATION_ERROR', String(payload.message[0] ?? 'Dữ liệu chưa hợp lệ.'));
  }
  const message = typeof payload.message === 'string' ? payload.message : 'Máy chủ đang gặp sự cố. Thử lại sau ít phút.';
  const code = typeof payload.code === 'string' ? payload.code : `HTTP_${status}`;
  return new ApiError(status, code, message);
}
