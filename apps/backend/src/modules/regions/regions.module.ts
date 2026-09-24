import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OpenDataModule } from '../open-data/open-data.module.js';
import { RegionAlias } from './entities/region-alias.entity.js';
import { Region } from './entities/region.entity.js';
import { RegionAreaService } from './region-area.service.js';
import { RegionSeeder } from './region-seeder.js';
import { RegionsController } from './regions.controller.js';
import { RegionsService } from './regions.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Region, RegionAlias]), OpenDataModule],
  controllers: [RegionsController],
  providers: [RegionsService, RegionAreaService, RegionSeeder],
  exports: [RegionsService, RegionAreaService],
})
export class RegionsModule {}
