import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { Inject, Injectable } from '@nestjs/common';
import type { PlacesType } from '../chat-models/schema.js';

/** Nguồn Google Maps mà Gemini dựa vào — bắt buộc hiển thị kèm kết quả grounding. */
export interface GroundingSource {
  title: string;
  uri: string;
}

@Injectable()
export class LangchainService {
  constructor(
    @Inject('GEMINI_CHAT_MODEL') private readonly llm: BaseChatModel,
    @Inject('GEMINI_STRUCTURED_OUTPUT_MODEL')
    private readonly structuredOutputModel: BaseChatModel,
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
   * Phương án dự phòng cho danh sách địa điểm khi nguồn dữ liệu mở không dùng
   * được: hỏi Gemini có công cụ Google Maps, rồi ép kết quả về cấu trúc.
   * Kết quả không được lưu lại (điều khoản grounding của Google Maps).
   */
  async findPlaces(
    regionName: string,
  ): Promise<{ places: PlacesType; sources: GroundingSource[] }> {
    const response = await this.llm.invoke([
      new SystemMessage(
        'Bạn là trợ lý du lịch. Chỉ dùng thông tin từ Google Maps, không bịa địa điểm. Trả lời bằng tiếng Việt.',
      ),
      new HumanMessage(
        `Liệt kê tối đa 15 địa điểm nổi bật nên ghé ở ${regionName}, Việt Nam: điểm tham quan, thiên nhiên, văn hóa, ăn uống, cà phê. ` +
          'Với mỗi địa điểm nêu tên, mô tả một câu, tọa độ, loại hình và giờ mở cửa thông thường.',
      ),
    ]);

    const places = (await this.structuredOutputModel.invoke(
      response.content,
    )) as unknown as PlacesType;

    const chunks = (
      response.response_metadata?.groundingMetadata as
        | {
            groundingChunks?: Array<{
              maps?: { title?: string; uri?: string };
            }>;
          }
        | undefined
    )?.groundingChunks;
    const sources = (chunks ?? [])
      .map((chunk) => chunk.maps)
      .filter((maps): maps is { title: string; uri: string } =>
        Boolean(maps?.uri && maps.title),
      );

    return { places: Array.isArray(places) ? places : [], sources };
  }
}
