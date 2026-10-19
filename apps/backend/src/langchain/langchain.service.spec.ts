import { Test, TestingModule } from '@nestjs/testing';
import { GEMINI_ITINERARY_MODEL } from '../chat-models/gemini-itinerary.js';
import { GEMINI_USER_THEMES_MODEL } from '../chat-models/gemini-user-themes.js';
import { LangchainService } from './langchain.service.js';

describe('LangchainService', () => {
  let service: LangchainService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LangchainService,
        { provide: 'GEMINI_CHAT_MODEL', useValue: {} },
        { provide: 'GEMINI_STRUCTURED_OUTPUT_MODEL', useValue: {} },
        { provide: GEMINI_ITINERARY_MODEL, useValue: {} },
        { provide: GEMINI_USER_THEMES_MODEL, useValue: {} },
      ],
    }).compile();

    service = module.get<LangchainService>(LangchainService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
