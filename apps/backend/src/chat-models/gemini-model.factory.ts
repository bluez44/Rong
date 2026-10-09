import {
  ChatGoogleGenerativeAI,
  type GoogleGenerativeAIChatInput,
} from '@langchain/google-genai';

/**
 * `thinkingConfig`: Gemini 3 mặc định tự chọn mức suy nghĩ, có thể sinh rất
 * nhiều token trước khi trả lời. Việc chỉ là trích xuất (như đọc bài viết lấy
 * địa điểm) thì hạ xuống `LOW` để nhanh hơn hẳn.
 */
export function createGeminiModel(
  options: Pick<GoogleGenerativeAIChatInput, 'thinkingConfig'> = {},
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not defined in your .env file. Ensure @nestjs/config is set up.',
    );
  }

  return new ChatGoogleGenerativeAI({
    apiKey,
    model: 'gemini-3-flash-preview',
    temperature: 0,
    maxRetries: 0,
    ...options,
  });
}
