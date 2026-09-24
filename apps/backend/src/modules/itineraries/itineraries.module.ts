import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LangchainModule } from '../../langchain/langchain.module.js';
import { RegionsModule } from '../regions/regions.module.js';
import { Itinerary } from './entities/itinerary.entity.js';
import { ItinerariesController } from './itineraries.controller.js';
import { ItinerariesService } from './itineraries.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Itinerary]),
    RegionsModule,
    LangchainModule,
  ],
  controllers: [ItinerariesController],
  providers: [ItinerariesService],
})
export class ItinerariesModule {}
