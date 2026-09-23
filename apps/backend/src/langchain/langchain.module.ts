import { Module } from '@nestjs/common';
import { GeminiChatProvider } from '../chat-models/gemini-chat.js';
import { LangchainService } from './langchain.service.js';
import { LangchainController } from './langchain.controller.js';

@Module({
  providers: [GeminiChatProvider, LangchainService],
  exports: [GeminiChatProvider],
  controllers: [LangchainController],
})
export class LangchainModule {}
