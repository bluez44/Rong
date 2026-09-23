import { Provider } from '@nestjs/common';
import { createGeminiModel } from './gemini-model.factory.js';
import { Places } from './schema.js';

export const GeminiChatStructuredOutputProvider: Provider = {
  provide: 'GEMINI_STRUCTURED_OUTPUT_MODEL',
  useFactory: () =>
    createGeminiModel().withStructuredOutput(Places, { strict: true }),
};
