import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OpenDataModule } from '../open-data/open-data.module.js';
import { RegionsModule } from '../regions/regions.module.js';
import { Place } from './entities/place.entity.js';
import { PlacesController } from './places.controller.js';
import { PlacesService } from './places.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Place]), OpenDataModule, RegionsModule],
  controllers: [PlacesController],
  providers: [PlacesService],
})
export class PlacesModule {}
