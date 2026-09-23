import { Provider } from '@nestjs/common';
import { createGeminiModel } from './gemini-model.factory.js';

export const GeminiChatProvider: Provider = {
  provide: 'GEMINI_CHAT_MODEL',
  useFactory: () =>
    createGeminiModel().bindTools([
      {
        googleMaps: {},
      },
    ]),
};
