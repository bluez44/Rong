import { Module } from '@nestjs/common';

import { SavedPlacesController } from './saved-places.controller.js';
import { SavedPlacesService } from './saved-places.service.js';

@Module({
  controllers: [SavedPlacesController],
  providers: [SavedPlacesService],
  exports: [SavedPlacesService],
})
export class SavedPlacesModule {}
