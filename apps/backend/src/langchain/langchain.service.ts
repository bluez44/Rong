import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class LangchainService {
  constructor(
    @Inject('GEMINI_CHAT_MODEL') private readonly llm: BaseChatModel,
  ) {}

  async ask(question: string): Promise<string> {
    const messages: BaseMessage[] = [
      new SystemMessage(
        'Bạn là một trợ lý AI thông minh và thân thiện. Hãy trả lời câu hỏi một cách rõ ràng, chi tiết và bằng tiếng Việt.',
      ),
      new HumanMessage(question),
    ];

    const response = await this.llm.invoke(messages);

    if (typeof response.content === 'string') {
      return response.content;
    } else if (Array.isArray(response.content)) {
      let textContent = '';
      for (const part of response.content) {
        if (part.type === 'text') {
          textContent += (part as any).text;
        }
      }
      if (textContent) {
        return textContent;
      }
    }

    return 'Xin lỗi, tôi không thể xử lý phản hồi hoặc không nhận được nội dung văn bản mong muốn từ AI.';
  }
}
