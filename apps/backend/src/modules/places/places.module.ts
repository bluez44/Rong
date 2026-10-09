import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LangchainModule } from '../../langchain/langchain.module.js';
import { GoogleModule } from '../google/google.module.js';
import { OpenDataModule } from '../open-data/open-data.module.js';
import { RegionsModule } from '../regions/regions.module.js';
import { Place } from './entities/place.entity.js';
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
  ],
  controllers: [PlacesController, PlaceDetailController, PlacesV2Controller],
  providers: [PlacesService, PlacesV2Service, PlacesWarmer],
})
export class PlacesModule {}
