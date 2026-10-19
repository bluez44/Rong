import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/configuration.js';
import { AccessService } from './access.service.js';
import { ActivityService } from './activity.service.js';
import { GroupPlacesService } from './group-places.service.js';
import { GroupsController } from './groups.controller.js';
import { GroupsService } from './groups.service.js';
import {
  INVITE_LINKS_CONFIG,
  InvitePageController,
} from './invite-page.controller.js';
import { InvitesController } from './invites.controller.js';
import { InvitesService } from './invites.service.js';

/** Nhóm & chia sẻ — F10, spec S8. */
@Module({
  controllers: [GroupsController, InvitesController, InvitePageController],
  providers: [
    {
      provide: INVITE_LINKS_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<AppConfig['inviteLinks']>('inviteLinks'),
    },
    AccessService,
    ActivityService,
    GroupsService,
    GroupPlacesService,
    InvitesService,
  ],
  exports: [AccessService, ActivityService],
})
export class GroupsModule {}
