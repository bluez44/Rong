import { Module } from '@nestjs/common';

import { AccessService } from './access.service.js';
import { ActivityService } from './activity.service.js';
import { GroupsController } from './groups.controller.js';
import { GroupsService } from './groups.service.js';
import { InvitesController } from './invites.controller.js';
import { InvitesService } from './invites.service.js';

/** Nhóm & chia sẻ — F10, spec S8. */
@Module({
  controllers: [GroupsController, InvitesController],
  providers: [AccessService, ActivityService, GroupsService, InvitesService],
  exports: [AccessService, ActivityService],
})
export class GroupsModule {}
