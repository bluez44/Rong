import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';

import type { AuthUser } from '../auth/auth.constants.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ItinerariesService } from './itineraries.service.js';

/**
 * Lịch trình nhìn từ phía nhóm. Nằm ở module itineraries (không phải `GroupsController`) vì
 * `ItinerariesModule` đã import `GroupsModule`.
 */
@Controller('groups')
export class GroupItinerariesController {
  constructor(private readonly itineraries: ItinerariesService) {}

  /** Gỡ lịch trình khỏi nhóm (người tạo hoặc chủ nhóm). Không xóa lịch trình. */
  @Delete(':groupId/itineraries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('groupId', new ParseUUIDPipe()) groupId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    return this.itineraries.removeFromGroup(user.userId, groupId, id);
  }
}
