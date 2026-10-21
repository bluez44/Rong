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
import { PlaceNotesService } from './place-notes.service.js';
import {
  PLACE_SEARCH_CONFIG,
  PlaceSearchService,
} from './place-search.service.js';
import {
  PlaceDetailController,
  PlacesController,
} from './places.controller.js';
import { PlacesService } from './places.service.js';
import { RegionPlaceStore } from './region-place-store.js';
import { ReverseGeocodeService } from './reverse-geocode.service.js';
import { UserPlacesController } from './user-places.controller.js';
import { UserPlacesService } from './user-places.service.js';
import { WEB_PLACES_CONFIG, WebPlacesService } from './web-places.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Place]),
    OpenDataModule,
    RegionsModule,
    GoogleModule,
    LangchainModule,
    SavedPlacesModule,
  ],
  // UserPlacesController trước PlaceDetailController: route tĩnh của nó không rơi vào `GET /places/:id`.
  controllers: [PlacesController, UserPlacesController, PlaceDetailController],
  providers: [
    PlacesService,
    WebPlacesService,
    PlaceLocationService,
    GoogleLocationJanitor,
    GooglePlaceRowsService,
    PlaceSearchService,
    RegionPlaceStore,
    PlaceNotesService,
    UserPlacesService,
    ReverseGeocodeService,
    {
      provide: PLACE_SEARCH_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<AppConfig['placeSearch']>('placeSearch'),
    },
    {
      provide: WEB_PLACES_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<AppConfig['webPlaces']>('webPlaces'),
    },
  ],
  exports: [
    PlaceLocationService,
    GooglePlaceRowsService,
    RegionPlaceStore,
    WebPlacesService,
    PlaceNotesService,
  ],
})
export class PlacesModule {}
