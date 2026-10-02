import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type {
  CreatedGroupInvite,
  GroupDetail,
  GroupInvite,
  InvitePreview,
} from '@rong/shared-types';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/public.decorator.js';
import { CreateInviteDto } from './dto/groups.dto.js';
import { InvitesService } from './invites.service.js';

/** Link mời nhóm — FR-10.2, 10.4, 10.7. */
@Controller()
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Post('groups/:id/invites')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateInviteDto,
  ): Promise<CreatedGroupInvite> {
    return this.invites.create(user.userId, id, dto.role ?? 'viewer');
  }

  @Get('groups/:id/invites')
  list(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<GroupInvite[]> {
    return this.invites.listActive(user.userId, id);
  }

  @Delete('groups/:id/invites/:inviteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('inviteId', new ParseUUIDPipe()) inviteId: string,
  ): Promise<void> {
    return this.invites.revoke(user.userId, id, inviteId);
  }

  /** Xem trước lời mời trước khi đăng nhập hoặc cài app. */
  @Public()
  @Get('invites/:token')
  preview(@Param('token') token: string): Promise<InvitePreview> {
    return this.invites.preview(token);
  }

  @Post('invites/:token/accept')
  accept(
    @CurrentUser() user: AuthUser,
    @Param('token') token: string,
  ): Promise<GroupDetail> {
    return this.invites.accept(user.userId, token);
  }
}
