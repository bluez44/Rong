import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/configuration.js';
import { RegionsModule } from '../regions/regions.module.js';
import { OpenMeteoClient, WEATHER_CONFIG } from './open-meteo.client.js';
import { WeatherController } from './weather.controller.js';
import { WeatherService } from './weather.service.js';

@Module({
  imports: [RegionsModule],
  controllers: [WeatherController],
  providers: [
    WeatherService,
    OpenMeteoClient,
    {
      provide: WEATHER_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const weather = config.get<AppConfig['weather']>('weather');
        if (weather === undefined)
          throw new Error('Chưa nạp được cấu hình weather.');
        return weather;
      },
    },
  ],
  exports: [WeatherService],
})
export class WeatherModule {}
