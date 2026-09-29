import { ToolMessage } from '@langchain/core/messages';
import { Injectable, Logger } from '@nestjs/common';
import {
  createAgent,
  createMiddleware,
  toolCallLimitMiddleware,
  toolStrategy,
} from 'langchain';
import * as z from 'zod';

import { createGeminiModel } from '../chat-models/gemini-model.factory.js';
import { Places, type PlacesType } from '../chat-models/schema.js';
import {
  createWebSearchTool,
  WEB_SEARCH_TOOL_NAME,
  type WebSource,
} from './web-search.tool.js';

/** Số lần gọi công cụ tìm kiếm tối đa mỗi lượt — mỗi lần thêm vài giây. */
const MAX_SEARCHES = 3;

const SYSTEM_PROMPT = `Bạn là trợ lý du lịch tìm địa điểm ở Việt Nam.
Quy trình:
1. Gọi công cụ ${WEB_SEARCH_TOOL_NAME} ngay trong lượt đầu, gọi song song 2-3 truy vấn khác nhau cùng lúc (ví dụ "địa điểm tham quan nổi tiếng <khu vực>", "quán ăn ngon <khu vực>", "quán cà phê đẹp <khu vực>"). Không gọi thêm lượt tìm kiếm thứ hai trừ khi kết quả gần như trống.
2. Đọc nội dung các bài viết, chọn tối đa 20 địa điểm cụ thể (có tên riêng) được nhắc tới và nằm trong khu vực được hỏi. Ưu tiên nơi được nhiều bài nhắc tới. Đa dạng loại hình.
3. Trả kết quả theo cấu trúc yêu cầu, sắp xếp từ nổi bật nhất.
Quy tắc:
- CHỈ dùng địa điểm có tên xuất hiện trong nội dung bài viết công cụ trả về. Không thêm địa điểm từ hiểu biết riêng, kể cả nơi rất nổi tiếng — hệ thống sẽ đối chiếu từng tên với bài viết và loại mọi địa điểm không có trong bài.
- Bỏ khách sạn, homestay trừ khi được hỏi.
- title: tên riêng của địa điểm, viết đúng như trong bài viết (không dịch, không thêm tên thành phố hay mô tả).
- description: một câu tiếng Việt, chỉ dựa trên điều bài viết nói về địa điểm đó.
- address: địa chỉ (số nhà, đường, phường/xã) đúng như bài viết ghi; bài không ghi thì để chuỗi rỗng, không tự đoán.
- location: tọa độ gần đúng theo hiểu biết của bạn (hệ thống sẽ tra lại vị trí chính xác theo tên và địa chỉ).
- openHours: giờ mở cửa thông thường dạng HH:mm; không rõ thì để chuỗi rỗng. Mở cả ngày thì "00:00"-"24:00".
- tags: 2-4 từ khóa ngắn tiếng Việt.`;

const logger = new Logger('PlaceSearchAgent');

/** Ghi thời gian từng lượt gọi Gemini, để biết agent chậm ở model hay ở công cụ tìm kiếm. */
const modelTimingMiddleware = createMiddleware({
  name: 'ModelTiming',
  wrapModelCall: async (request, handler) => {
    const started = Date.now();
    const response = await handler(request);
    const calls = response.tool_calls?.map((call) => call.name) ?? [];
    logger.log(
      `Gemini lượt ${request.messages.filter((m) => m.type === 'ai').length + 1}: ${Date.now() - started} ms` +
        (calls.length ? ` → gọi ${calls.join(', ')}` : ''),
    );
    return response;
  },
});

const PlaceSearchResult = z.object({
  places: Places.describe('Các địa điểm tìm được, nổi bật nhất trước'),
});

/**
 * Tìm địa điểm của một vùng bằng agent LangChain: Gemini tự gọi công cụ tìm
 * web (kèm nội dung bài viết), phân tích rồi trả về đúng cấu trúc `Places`.
 * Thay cho việc tải hàng nghìn phần tử từ Overpass (OSM) mỗi lần mở vùng mới.
 */
@Injectable()
export class PlaceSearchAgent {
  private readonly agent = process.env.TAVILY_API_KEY
    ? createAgent({
        model: createGeminiModel(),
        tools: [createWebSearchTool(process.env.TAVILY_API_KEY)],
        systemPrompt: SYSTEM_PROMPT,
        responseFormat: toolStrategy(PlaceSearchResult),
        middleware: [
          modelTimingMiddleware,
          toolCallLimitMiddleware({
            toolName: WEB_SEARCH_TOOL_NAME,
            runLimit: MAX_SEARCHES,
          }),
        ],
      })
    : null;

  /** Thiếu TAVILY_API_KEY thì API v2 trả 503 thay vì làm app không khởi động được. */
  get enabled(): boolean {
    return this.agent !== null;
  }

  async findPlaces(
    regionName: string,
  ): Promise<{ places: PlacesType; sources: WebSource[] }> {
    if (!this.agent) throw new Error('TAVILY_API_KEY chưa được cấu hình');

    const result = await this.agent.invoke({
      messages: [
        {
          role: 'user',
          content: `Tìm các địa điểm nên ghé ở ${regionName}, Việt Nam: điểm tham quan, check-in, thiên nhiên, văn hóa - lịch sử, ăn uống, cà phê, vui chơi, về đêm.`,
        },
      ],
    });

    const sources = new Map<string, WebSource>();
    for (const message of result.messages) {
      if (!ToolMessage.isInstance(message) || !Array.isArray(message.artifact))
        continue;
      for (const source of message.artifact as WebSource[]) {
        sources.set(source.uri, source);
      }
    }

    return {
      places: result.structuredResponse?.places ?? [],
      sources: [...sources.values()],
    };
  }
}
