import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

export function createGeminiModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not defined in your .env file. Ensure @nestjs/config is set up.',
    );
  }

  return new ChatGoogleGenerativeAI({
    apiKey,
    model: 'gemini-3.7-flash',
    temperature: 0,
    maxRetries: 0,
  });
}
