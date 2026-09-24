import { Provider } from '@nestjs/common';

import { createGeminiModel } from './gemini-model.factory.js';
import { ItineraryPlan } from './itinerary-schema.js';

export const GEMINI_ITINERARY_MODEL = 'GEMINI_ITINERARY_MODEL';

export const GeminiItineraryProvider: Provider = {
  provide: GEMINI_ITINERARY_MODEL,
  useFactory: () =>
    createGeminiModel().withStructuredOutput(ItineraryPlan, { strict: true }),
};
