import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/configuration.js';
import { GOOGLE_CONFIG, GooglePlacesService } from './google-places.service.js';

@Module({
  providers: [
    GooglePlacesService,
    {
      provide: GOOGLE_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const google = config.get<AppConfig['google']>('google');
        if (google === undefined) {
          throw new Error('Chưa nạp được cấu hình google.');
        }
        return google;
      },
    },
  ],
  exports: [GooglePlacesService],
})
export class GoogleModule {}
