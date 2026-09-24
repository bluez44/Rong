import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/configuration.js';
import { OPEN_DATA_CONFIG, OpenDataService } from './open-data.service.js';

@Module({
  providers: [
    OpenDataService,
    {
      provide: OPEN_DATA_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const openData = config.get<AppConfig['openData']>('openData');
        if (openData === undefined) {
          throw new Error('Chưa nạp được cấu hình openData.');
        }
        return openData;
      },
    },
  ],
  exports: [OpenDataService, OPEN_DATA_CONFIG],
})
export class OpenDataModule {}
