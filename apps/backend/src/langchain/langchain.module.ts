import { Module } from '@nestjs/common';
import { GeminiChatProvider } from '../chat-models/gemini-chat.js';
import { LangchainService } from './langchain.service.js';
import { LangchainController } from './langchain.controller.js';
import { GeminiChatStructuredOutputProvider } from '../chat-models/gemini-chat-structured-output.js';
import { GeminiItineraryProvider } from '../chat-models/gemini-itinerary.js';
import { GeminiUserThemesProvider } from '../chat-models/gemini-user-themes.js';
import { PlaceSearchService } from './place-search.service.js';

@Module({
  providers: [
    GeminiChatProvider,
    GeminiChatStructuredOutputProvider,
    GeminiItineraryProvider,
    GeminiUserThemesProvider,
    LangchainService,
    PlaceSearchService,
  ],
  exports: [
    GeminiChatProvider,
    GeminiChatStructuredOutputProvider,
    LangchainService,
    PlaceSearchService,
  ],
  controllers: [LangchainController],
})
export class LangchainModule {}
