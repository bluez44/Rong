import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type {
  SaveShareImportResponse,
  ShareImport,
  ShareImportSummary,
} from '@rong/shared-types';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CreateShareImportDto } from './dto/create-share-import.dto.js';
import { SaveShareImportDto } from './dto/save-share-import.dto.js';
import { ShareImportsService } from './share-imports.service.js';

/** Chia sẻ vào app (F4). Nhận diện chạy nền: POST trả 202, client hỏi lại GET /:id. */
@Controller('share-imports')
export class ShareImportsController {
  constructor(private readonly imports: ShareImportsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateShareImportDto,
  ): Promise<{ id: string }> {
    return this.imports.create(user.userId, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ShareImportSummary[]> {
    return this.imports.list(user.userId);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ShareImport> {
    return this.imports.get(user.userId, id);
  }

  @Post(':id/save')
  @HttpCode(HttpStatus.OK)
  save(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SaveShareImportDto,
  ): Promise<SaveShareImportResponse> {
    return this.imports.save(user.userId, id, dto);
  }
}
