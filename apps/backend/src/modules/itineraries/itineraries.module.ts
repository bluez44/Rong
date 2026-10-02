import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LangchainModule } from '../../langchain/langchain.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { RegionsModule } from '../regions/regions.module.js';
import { Itinerary } from './entities/itinerary.entity.js';
import { ItinerariesController } from './itineraries.controller.js';
import { ItinerariesService } from './itineraries.service.js';
import { ShareLinksController } from './share-links.controller.js';
import { ShareLinksService } from './share-links.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Itinerary]),
    RegionsModule,
    LangchainModule,
    GroupsModule,
  ],
  controllers: [ItinerariesController, ShareLinksController],
  providers: [ItinerariesService, ShareLinksService],
})
export class ItinerariesModule {}
