import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/configuration.js';
import { PlacesModule } from '../places/places.module.js';
import { AdminController } from './admin.controller.js';
import { ADMIN_CONFIG, AdminGuard } from './admin.guard.js';
import { AdminRefreshLimiter } from './admin-refresh-limiter.js';

/** Route quản trị (reset địa điểm của vùng). Tắt mặc định: xem `AdminConfig`. */
@Module({
  imports: [PlacesModule],
  controllers: [AdminController],
  providers: [
    AdminGuard,
    {
      provide: ADMIN_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<AppConfig['admin']>('admin'),
    },
    {
      provide: AdminRefreshLimiter,
      inject: [ADMIN_CONFIG],
      useFactory: (config: AppConfig['admin']) =>
        new AdminRefreshLimiter(config.refreshDailyLimit),
    },
  ],
})
export class AdminModule {}
