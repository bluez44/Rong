import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { loadConfig } from './config/configuration.js';
import { DatabaseModule } from './database/database.module.js';
import { LangchainModule } from './langchain/langchain.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { GroupsModule } from './modules/groups/groups.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { ItinerariesModule } from './modules/itineraries/itineraries.module.js';
import { PlacesModule } from './modules/places/places.module.js';
import { RecommendationsQueueModule } from './modules/recommendations/queue/recommendations-queue.module.js';
import { RecommendationsModule } from './modules/recommendations/recommendations.module.js';
import { RegionsModule } from './modules/regions/regions.module.js';
import { SavedPlacesModule } from './modules/saved-places/saved-places.module.js';
import { ShareImportModule } from './modules/share-import/share-import.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { VisitsModule } from './modules/visits/visits.module.js';

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
    RegionsModule,
    PlacesModule,
    ItinerariesModule,
    SavedPlacesModule,
    ShareImportModule,
    GroupsModule,
    VisitsModule,
    RecommendationsQueueModule,
    RecommendationsModule,
    HealthModule,
    LangchainModule,
  ],
})
export class AppModule {}
