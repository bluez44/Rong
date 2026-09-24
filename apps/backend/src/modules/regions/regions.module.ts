import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OpenDataModule } from '../open-data/open-data.module.js';
import { BoundaryService } from './boundary.service.js';
import { RegionAlias } from './entities/region-alias.entity.js';
import { Region } from './entities/region.entity.js';
import { RegionSeeder } from './region-seeder.js';
import { RegionsController } from './regions.controller.js';
import { RegionsService } from './regions.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Region, RegionAlias]), OpenDataModule],
  controllers: [RegionsController],
  providers: [RegionsService, BoundaryService, RegionSeeder],
  exports: [RegionsService, BoundaryService],
})
export class RegionsModule {}
