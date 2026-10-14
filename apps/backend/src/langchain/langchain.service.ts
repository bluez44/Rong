import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { Inject, Injectable } from '@nestjs/common';
import { GEMINI_ITINERARY_MODEL } from '../chat-models/gemini-itinerary.js';
import type { ItineraryPlanType } from '../chat-models/itinerary-schema.js';

@Injectable()
export class LangchainService {
  constructor(
    @Inject('GEMINI_CHAT_MODEL') private readonly llm: BaseChatModel,
    @Inject('GEMINI_STRUCTURED_OUTPUT_MODEL')
    private readonly structuredOutputModel: BaseChatModel,
    @Inject(GEMINI_ITINERARY_MODEL)
    private readonly itineraryModel: BaseChatModel,
  ) {}

  async ask(question: string): Promise<any> {
    const messages: BaseMessage[] = [
      new SystemMessage(
        'Bạn là một trợ lý AI thông minh và thân thiện. Hãy trả lời câu hỏi một cách rõ ràng, chi tiết và bằng tiếng Việt.',
      ),
      new HumanMessage(question),
    ];

    const response = await this.llm.invoke(messages);

    console.dir(response.response_metadata?.groundingMetadata, { depth: null });

    const structuredResponse = await this.structuredOutputModel.invoke(
      response.content,
    );

    console.log('Structured Response:', structuredResponse);

    return structuredResponse;

    // if (typeof structuredResponse.content === 'string') {
    //   return structuredResponse.content;
    // } else if (Array.isArray(structuredResponse.content)) {
    //   let textContent = '';
    //   for (const part of structuredResponse.content) {
    //     if (part.type === 'text') {
    //       textContent += (part as any).text;
    //     }
    //   }
    //   if (textContent) {
    //     return textContent;
    //   }
    // }

    // return 'Xin lỗi, tôi không thể xử lý phản hồi hoặc không nhận được nội dung văn bản mong muốn từ AI.';
  }

  /**
   * Sắp xếp lịch trình: Gemini có công cụ Google Maps (được tra giờ mở cửa,
   * thời điểm đẹp) viết phương án, rồi ép về cấu trúc ItineraryPlan. Đây là
   * mục đích duy nhất PRD 7.4 nguyên tắc 5 cho phép đưa dữ liệu Google vào AI.
   * Kết quả chỉ là đề xuất — ItinerariesService kiểm tra lại toàn bộ.
   */
  async planItinerary(
    system: string,
    request: string,
  ): Promise<ItineraryPlanType> {
    const draft = await this.llm.invoke([
      new SystemMessage(system),
      new HumanMessage(request),
    ]);
    return (await this.itineraryModel.invoke(
      `${request}\n\nPhương án đề xuất:\n${typeof draft.content === 'string' ? draft.content : JSON.stringify(draft.content)}`,
    )) as unknown as ItineraryPlanType;
  }
}
