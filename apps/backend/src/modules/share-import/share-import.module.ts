import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/configuration.js';
import { GoogleModule } from '../google/google.module.js';
import { PlacesModule } from '../places/places.module.js';
import { SavedPlacesModule } from '../saved-places/saved-places.module.js';
import {
  createLinkMetadataService,
  LinkMetadataService,
} from './link-metadata.service.js';
import { createPlaceExtractor, PLACE_EXTRACTOR } from './place-extraction.js';
import { RegionLookupService } from './region-lookup.service.js';
import { SHARE_IMPORT_CONFIG } from './share-import.constants.js';
import { ShareImportsController } from './share-imports.controller.js';
import { ShareImportsService } from './share-imports.service.js';

@Module({
  imports: [GoogleModule, PlacesModule, SavedPlacesModule],
  controllers: [ShareImportsController],
  providers: [
    ShareImportsService,
    RegionLookupService,
    {
      provide: SHARE_IMPORT_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<AppConfig['shareImport']>('shareImport'),
    },
    {
      provide: LinkMetadataService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createLinkMetadataService({
          metaOembedToken:
            config.getOrThrow<AppConfig['shareImport']>('shareImport')
              .metaOembedToken,
          contactEmail:
            config.getOrThrow<AppConfig['openData']>('openData').contactEmail,
        }),
    },
    { provide: PLACE_EXTRACTOR, useFactory: createPlaceExtractor },
  ],
})
export class ShareImportModule {}
