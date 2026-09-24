import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { loadConfig } from './config/configuration.js';
import { DatabaseModule } from './database/database.module.js';
import { LangchainModule } from './langchain/langchain.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { UsersModule } from './modules/users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [loadConfig],
      envFilePath: ['.env.local', '.env'],
    }),
    DatabaseModule,
    // AuthModule gắn JwtAuthGuard toàn cục: mọi route khác đều cần access token.
    AuthModule,
    UsersModule,
    HealthModule,
    LangchainModule,
  ],
})
export class AppModule {}
