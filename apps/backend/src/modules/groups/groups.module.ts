import { Module } from '@nestjs/common';

import { AccessService } from './access.service.js';
import { ActivityService } from './activity.service.js';
import { GroupsController } from './groups.controller.js';
import { GroupsService } from './groups.service.js';

/** Nhóm & chia sẻ — F10, spec S8. */
@Module({
  controllers: [GroupsController],
  providers: [AccessService, ActivityService, GroupsService],
  exports: [AccessService, ActivityService],
})
export class GroupsModule {}
