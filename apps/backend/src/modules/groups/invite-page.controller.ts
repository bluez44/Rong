import {
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import type { InviteLinksConfig } from '../../config/configuration.js';
import { Public } from '../auth/public.decorator.js';
import { assetLinks, renderInvitePage } from './invite-page.js';
import { InvitesService } from './invites.service.js';

export const INVITE_LINKS_CONFIG = 'INVITE_LINKS_CONFIG';

/**
 * Trang mời mở từ link chia sẻ (`https://<domain>/invite/<token>`) và file xác
 * minh Android App Links. Đứng ngoài prefix `api` (xem `global-prefix.ts`).
 */
@Public()
@Controller()
export class InvitePageController {
  constructor(
    private readonly invites: InvitesService,
    @Inject(INVITE_LINKS_CONFIG) private readonly config: InviteLinksConfig,
  ) {}

  @Get('invite/:token')
  async page(
    @Param('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    let status = 200;
    let html: string;
    try {
      html = renderInvitePage({
        kind: 'ok',
        token,
        preview: await this.invites.preview(token),
      });
    } catch (error) {
      // 404 (không có) và 410 (hết hạn, thu hồi): vẫn là trang có nút tải app.
      if (
        !(error instanceof HttpException) ||
        ![404, 410].includes(error.getStatus())
      )
        throw error;
      status = error.getStatus();
      html = renderInvitePage({ kind: 'invalid' });
    }
    res.status(status).type('html').set('Cache-Control', 'no-store').send(html);
  }

  @Get('.well-known/assetlinks.json')
  assetLinks(): object[] {
    return assetLinks(this.config.androidSha256);
  }
}
