import type { FactoryProvider } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GeminiChatProvider } from './gemini-chat.js';

describe('GeminiChatProvider', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('tạo model Gemini khi có GEMINI_API_KEY', () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const { useFactory } = GeminiChatProvider as FactoryProvider;
    expect(useFactory()).toBeDefined();
  });

  it('thiếu GEMINI_API_KEY thì báo lỗi ngay khi khởi động', () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const { useFactory } = GeminiChatProvider as FactoryProvider;
    expect(() => useFactory()).toThrow('GEMINI_API_KEY');
  });
});
