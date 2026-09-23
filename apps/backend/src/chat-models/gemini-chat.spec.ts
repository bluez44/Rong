import { Test, TestingModule } from '@nestjs/testing';
import { GeminiChat } from './gemini-chat.js';

describe('GeminiChat', () => {
  let provider: GeminiChat;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GeminiChat],
    }).compile();

    provider = module.get<GeminiChat>(GeminiChat);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });
});
