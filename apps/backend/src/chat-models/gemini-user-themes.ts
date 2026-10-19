import type { Provider } from '@nestjs/common';

import { createGeminiModel } from './gemini-model.factory.js';
import { UserThemesPlan } from './user-themes-schema.js';

export const GEMINI_USER_THEMES_MODEL = 'GEMINI_USER_THEMES_MODEL';

export const GeminiUserThemesProvider: Provider = {
  provide: GEMINI_USER_THEMES_MODEL,
  useFactory: () =>
    createGeminiModel({ thinkingConfig: { thinkingLevel: 'LOW' } }).withStructuredOutput(
      UserThemesPlan,
      { strict: true },
    ),
};
