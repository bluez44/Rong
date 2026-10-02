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
  Put,
  Query,
} from '@nestjs/common';
import type {
  CursorPage,
  GroupActivity,
  GroupDetail,
  GroupPlace,
  GroupSummary,
} from '@rong/shared-types';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SavePlaceDto } from '../saved-places/dto/save-place.dto.js';
import {
  ActivityQueryDto,
  GroupNameDto,
  MemberRoleDto,
} from './dto/groups.dto.js';
import { GroupPlacesService } from './group-places.service.js';
import { GroupsService } from './groups.service.js';

/** Nhóm, thành viên, nhật ký hoạt động, địa điểm chung — F10. */
@Controller('groups')
export class GroupsController {
  constructor(
    private readonly groups: GroupsService,
    private readonly places: GroupPlacesService,
  ) {}

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

  /** Địa điểm chung của nhóm — FR-10.9. PUT/DELETE idempotent như "Muốn đi". */
  @Get(':id/places')
  listPlaces(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<GroupPlace[]> {
    return this.places.list(user.userId, id);
  }

  @Put(':id/places/:placeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  addPlace(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('placeId', new ParseUUIDPipe()) placeId: string,
    @Body() dto: SavePlaceDto,
  ): Promise<void> {
    return this.places.add(user.userId, id, placeId, dto.regionId);
  }

  @Delete(':id/places/:placeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removePlace(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('placeId', new ParseUUIDPipe()) placeId: string,
  ): Promise<void> {
    return this.places.remove(user.userId, id, placeId);
  }
}
