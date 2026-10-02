import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type {
  CursorPage,
  GroupActivity,
  GroupDetail,
  GroupSummary,
} from '@rong/shared-types';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import {
  ActivityQueryDto,
  GroupNameDto,
  MemberRoleDto,
} from './dto/groups.dto.js';
import { GroupsService } from './groups.service.js';

/** Nhóm, thành viên, nhật ký hoạt động — F10. */
@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: GroupNameDto,
  ): Promise<GroupDetail> {
    return this.groups.create(user.userId, dto.name);
  }

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<GroupSummary[]> {
    return this.groups.list(user.userId);
  }

  @Get(':id')
  detail(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<GroupDetail> {
    return this.groups.detail(user.userId, id);
  }

  @Patch(':id')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: GroupNameDto,
  ): Promise<GroupDetail> {
    return this.groups.rename(user.userId, id, dto.name);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.groups.remove(user.userId, id);
  }

  @Patch(':id/members/:userId')
  changeRole(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: MemberRoleDto,
  ): Promise<GroupDetail> {
    return this.groups.changeRole(user.userId, id, userId, dto.role);
  }

  /** Owner xóa thành viên (FR-10.7), hoặc tự rời nhóm khi `userId` là chính mình. */
  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    return this.groups.removeMember(user.userId, id, userId);
  }

  @Get(':id/activity')
  activity(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ActivityQueryDto,
  ): Promise<CursorPage<GroupActivity>> {
    return this.groups.activity(user.userId, id, query.cursor);
  }
}
