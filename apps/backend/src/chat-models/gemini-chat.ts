import { Provider } from '@nestjs/common';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

export const GeminiChatProvider: Provider = {
  provide: 'GEMINI_CHAT_MODEL',
  useFactory: () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not defined in your .env file. Ensure @nestjs/config is set up.');
    }

    return new ChatGoogleGenerativeAI({
      apiKey: apiKey,
      model: 'gemini-3.7-flash',
    });
  },
};
