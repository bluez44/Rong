import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import type { AppConfig } from '../../config/configuration.js';
import { LangchainModule } from '../../langchain/langchain.module.js';
import { GoogleModule } from '../google/google.module.js';
import { OpenDataModule } from '../open-data/open-data.module.js';
import { RegionsModule } from '../regions/regions.module.js';
import { SavedPlacesModule } from '../saved-places/saved-places.module.js';
import { Place } from './entities/place.entity.js';
import { GoogleLocationJanitor } from './google-location-janitor.js';
import { GooglePlaceRowsService } from './google-place-rows.service.js';
import { PlaceLocationService } from './place-location.service.js';
import {
  PLACE_SEARCH_CONFIG,
  PlaceSearchService,
} from './place-search.service.js';
import { PlacesV2Controller } from './places-v2.controller.js';
import { PlacesV2Service } from './places-v2.service.js';
import {
  PlaceDetailController,
  PlacesController,
} from './places.controller.js';
import { PlacesWarmer } from './places-warmer.js';
import { PlacesService } from './places.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Place]),
    OpenDataModule,
    RegionsModule,
    GoogleModule,
    LangchainModule,
    SavedPlacesModule,
  ],
  controllers: [PlacesController, PlaceDetailController, PlacesV2Controller],
  providers: [
    PlacesService,
    PlacesV2Service,
    PlacesWarmer,
    PlaceLocationService,
    GoogleLocationJanitor,
    GooglePlaceRowsService,
    PlaceSearchService,
    {
      provide: PLACE_SEARCH_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<AppConfig['placeSearch']>('placeSearch'),
    },
  ],
  exports: [PlaceLocationService, GooglePlaceRowsService],
})
export class PlacesModule {}
