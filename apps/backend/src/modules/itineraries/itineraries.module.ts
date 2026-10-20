import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import type { AppConfig } from '../../config/configuration.js';
import { LangchainModule } from '../../langchain/langchain.module.js';
import { GroupsModule } from '../groups/groups.module.js';
import { PlacesModule } from '../places/places.module.js';
import { RegionsModule } from '../regions/regions.module.js';
import { Itinerary } from './entities/itinerary.entity.js';
import { ItinerariesController } from './itineraries.controller.js';
import { ItinerariesService } from './itineraries.service.js';
import { ItineraryPlanner } from './itinerary-planner.js';
import { ShareLinksController } from './share-links.controller.js';
import {
  SHARE_LINKS_CONFIG,
  ShareLinksService,
} from './share-links.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Itinerary]),
    RegionsModule,
    LangchainModule,
    GroupsModule,
    PlacesModule,
  ],
  controllers: [ItinerariesController, ShareLinksController],
  providers: [
    {
      provide: SHARE_LINKS_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<AppConfig['shareLinks']>('shareLinks'),
    },
    ItinerariesService,
    ShareLinksService,
    ItineraryPlanner,
  ],
  exports: [ItinerariesService, ItineraryPlanner],
})
export class ItinerariesModule {}
