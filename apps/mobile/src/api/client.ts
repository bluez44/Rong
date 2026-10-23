import { ApiError, type RequestOptions } from '@/lib/api';

/** Cùng chữ ký `authFetch`: module API không cần biết token hay cách làm mới phiên. */
export type Fetcher = <T>(path: string, options?: Omit<RequestOptions, 'token'>) => Promise<T>;

export const UNKNOWN_ERROR_MESSAGE = 'Có lỗi không mong muốn. Thử lại sau.';

/** Màn hình rẽ nhánh theo `code`, nên mọi lỗi đều phải là ApiError. */
export function toApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError(0, 'UNKNOWN', UNKNOWN_ERROR_MESSAGE);
}
