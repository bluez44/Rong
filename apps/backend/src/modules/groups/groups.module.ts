import { Module } from '@nestjs/common';

import { AccessService } from './access.service.js';
import { ActivityService } from './activity.service.js';

/** Nhóm & chia sẻ — F10, spec S8. */
@Module({
  providers: [AccessService, ActivityService],
  exports: [AccessService, ActivityService],
})
export class GroupsModule {}
