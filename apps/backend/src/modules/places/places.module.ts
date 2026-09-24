import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LangchainModule } from '../../langchain/langchain.module.js';
import { GoogleModule } from '../google/google.module.js';
import { OpenDataModule } from '../open-data/open-data.module.js';
import { RegionsModule } from '../regions/regions.module.js';
import { Place } from './entities/place.entity.js';
import {
  PlaceDetailController,
  PlacesController,
} from './places.controller.js';
import { PlacesService } from './places.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Place]),
    OpenDataModule,
    RegionsModule,
    GoogleModule,
    LangchainModule,
  ],
  controllers: [PlacesController, PlaceDetailController],
  providers: [PlacesService],
})
export class PlacesModule {}
