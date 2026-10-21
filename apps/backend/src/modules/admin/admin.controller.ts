import {
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { WebPlacesService } from '../places/web-places.service.js';
import { AdminGuard } from './admin.guard.js';
import { AdminRefreshLimiter } from './admin-refresh-limiter.js';

@Controller('regions')
@UseGuards(AdminGuard)
export class AdminController {
  private readonly logger = new Logger('Admin');

  constructor(
    private readonly webPlaces: WebPlacesService,
    private readonly limiter: AdminRefreshLimiter,
  ) {}

  /**
   * Admin reset danh sách địa điểm của vùng: chạy lại pipeline ở nền, trả 202 ngay. Người dùng vẫn thấy danh sách
   * cũ tới khi bản mới xong; bản mới luôn thay bản cũ, trừ khi ra 0 địa điểm hoặc lỗi.
   */
  @Post(':id/places/refresh')
  @HttpCode(HttpStatus.ACCEPTED)
  async refreshPlaces(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ status: 'building' }> {
    // Kiểm tra vùng và Tavily trước khi tính lượt: gõ sai id không tốn hạn mức.
    const { regionName, running } = await this.webPlaces.prepareRefresh(id);
    const limit = this.limiter.tryConsume(id);
    if (limit !== 'ok') {
      this.logger.warn(
        `Từ chối reset "${regionName}" (user ${user.userId}): quá giới hạn ${limit === 'region' ? 'của vùng' : 'trong ngày'}`,
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'REFRESH_RATE_LIMITED',
          message:
            limit === 'region'
              ? 'Vùng này vừa được reset. Thử lại sau 10 phút.'
              : 'Đã hết lượt reset trong 24 giờ.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.logger.log(
      `User ${user.userId} reset địa điểm "${regionName}" (${id})${running ? ', nhập vào lượt đang chạy' : ''}`,
    );
    void this.webPlaces
      .refresh(id, regionName, { force: true })
      .then((outcome) =>
        this.logger.log(
          `Reset "${regionName}" xong: ${JSON.stringify(outcome)}`,
        ),
      );
    return { status: 'building' };
  }
}
