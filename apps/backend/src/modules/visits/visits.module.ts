import { Module } from '@nestjs/common';

import { GroupsModule } from '../groups/groups.module.js';
import { VisitsController } from './visits.controller.js';
import { VisitsService } from './visits.service.js';

@Module({
  imports: [GroupsModule],
  controllers: [VisitsController],
  providers: [VisitsService],
  exports: [VisitsService],
})
export class VisitsModule {}
