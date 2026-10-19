import type { INestApplication } from '@nestjs/common';

/** `@nestjs/common` không export `GlobalPrefixOptions` ở gốc. */
type GlobalPrefixOptions = NonNullable<
  Parameters<INestApplication['setGlobalPrefix']>[1]
>;

/** Mọi API nằm dưới `/api`. */
export const API_PREFIX = 'api';

/**
 * Route không nằm dưới `/api`: trang mời mở từ link chia sẻ và file xác minh
 * Android App Links (cả hai phải ở đúng đường dẫn trên domain). e2e tests dựng
 * lại prefix bằng chính hằng số này.
 */
export const API_PREFIX_OPTIONS: GlobalPrefixOptions = {
  exclude: ['invite/:token', '.well-known/assetlinks.json'],
};
