import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import type { AppConfig } from '../config/configuration.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const database = configService.get<AppConfig['database']>('database');
        const nodeEnv = configService.get<AppConfig['nodeEnv']>('nodeEnv');

        if (!database) {
          throw new Error('Chưa nạp được cấu hình database.');
        }

        return {
          type: 'postgres' as const,
          ...database,
          // Schema chỉ đổi qua migration — xem ghi chú ở data-source.ts.
          synchronize: false,
          autoLoadEntities: true,
          logging: nodeEnv === 'development',
          migrations: ['dist/database/migrations/*.js'],
        };
      },
    }),
  ],
})
export class DatabaseModule {}
