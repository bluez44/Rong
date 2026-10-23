import { ApiError } from '@/lib/api';

import { toApiError, UNKNOWN_ERROR_MESSAGE } from './client';

describe('toApiError', () => {
  it('giữ nguyên ApiError', () => {
    const error = new ApiError(404, 'NOT_FOUND', 'Không thấy');
    expect(toApiError(error)).toBe(error);
  });

  it('lỗi khác thành UNKNOWN với thông báo chung', () => {
    const wrapped = toApiError(new TypeError('boom'));
    expect(wrapped).toBeInstanceOf(ApiError);
    expect(wrapped).toMatchObject({ status: 0, code: 'UNKNOWN', message: UNKNOWN_ERROR_MESSAGE });
    expect(toApiError('chuỗi lạ')).toMatchObject({ code: 'UNKNOWN' });
  });
});
