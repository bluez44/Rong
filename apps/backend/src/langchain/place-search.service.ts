import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { Injectable, Logger } from '@nestjs/common';
import { createAgent, toolCallLimitMiddleware, toolStrategy } from 'langchain';
import * as z from 'zod';

import { createGeminiModel } from '../chat-models/gemini-model.factory.js';
import { WebPlaces, type WebPlacesType } from '../chat-models/schema.js';
import {
  createWebSearchTool,
  formatArticles,
  searchWeb,
  WEB_SEARCH_TOOL_NAME,
  type WebSource,
} from './web-search.js';

/** Số địa điểm tối đa mỗi vùng. Mỗi địa điểm là thêm vài chục token Gemini phải sinh. */
const MAX_PLACES = 15;

/**
 * Truy vấn cố định, chạy song song: với vùng phổ biến, Gemini tự quyết định
 * truy vấn cũng ra gần đúng mấy câu này mà tốn thêm trọn một lượt gọi model.
 */
const queries = (regionName: string) => [
  `địa điểm tham quan nổi tiếng ${regionName}`,
  `quán ăn ngon ${regionName}`,
  `quán cà phê đẹp ${regionName}`,
];

const SYSTEM_PROMPT = `Bạn là trợ lý du lịch tìm địa điểm ở Việt Nam.
Đọc các bài viết được cung cấp, chọn tối đa ${MAX_PLACES} địa điểm cụ thể (có tên riêng) được nhắc tới và nằm trong khu vực được hỏi. Ưu tiên nơi được nhiều bài nhắc tới. Đa dạng loại hình. Sắp xếp từ nổi bật nhất.
Quy tắc:
- CHỈ dùng địa điểm có tên xuất hiện trong nội dung bài viết. Không thêm địa điểm từ hiểu biết riêng, kể cả nơi rất nổi tiếng — hệ thống sẽ đối chiếu từng tên với bài viết và loại mọi địa điểm không có trong bài.
- Bỏ khách sạn, homestay.
- title: tên riêng của địa điểm, viết đúng như trong bài viết (không dịch, không thêm tên thành phố hay mô tả).
- description: một câu ngắn tiếng Việt, chỉ dựa trên điều bài viết nói về địa điểm đó.
- address: địa chỉ (số nhà, đường, phường/xã) đúng như bài viết ghi; bài không ghi thì để chuỗi rỗng, không tự đoán.
- location: tọa độ gần đúng theo hiểu biết của bạn (hệ thống sẽ tra lại vị trí chính xác theo tên và địa chỉ).
- openHours: giờ mở cửa thông thường dạng HH:mm; không rõ thì để chuỗi rỗng. Mở cả ngày thì "00:00"-"24:00".`;

/**
 * Ít hơn chừng này bài (vùng hẻo lánh, tên vùng ít người viết) thì chuyển
 * sang agent để Gemini tự nghĩ truy vấn khác.
 */
const MIN_SOURCES = 3;
/** Số lần agent được gọi công cụ tìm kiếm — mỗi lần thêm vài giây. */
const AGENT_MAX_SEARCHES = 3;

const AGENT_PROMPT = `${SYSTEM_PROMPT}
Bài viết ban đầu quá ít. Gọi công cụ ${WEB_SEARCH_TOOL_NAME} (có thể gọi song song 2-3 truy vấn khác nhau cùng lúc) với cách diễn đạt khác: tên gọi khác của khu vực, tên tỉnh, các loại hình cụ thể (thác, chùa, chợ, đặc sản…). Rồi chọn địa điểm từ cả bài ban đầu lẫn bài mới tìm.`;

const PlaceSearchResult = z.object({
  places: WebPlaces.describe('Các địa điểm tìm được, nổi bật nhất trước'),
});

const logger = new Logger('PlaceSearch');

export interface PlaceSearchDeps {
  search: (query: string) => Promise<WebSource[]>;
  extract: (
    system: string,
    request: string,
  ) => Promise<z.infer<typeof PlaceSearchResult>>;
  /** Agent tự tìm thêm, nhận prompt kèm các bài đã có; trả các bài nó tìm thêm. */
  agent: (
    request: string,
  ) => Promise<{ places: WebPlacesType; sources: WebSource[] }>;
}

/**
 * Đường nhanh: tìm web song song bằng truy vấn cố định, rồi một lượt Gemini
 * đọc bài và trả đúng cấu trúc. Một truy vấn lỗi thì dùng các truy vấn còn
 * lại; lỗi hết mới ném lỗi. Ra quá ít bài thì chuyển sang agent.
 */
export async function findPlacesFromWeb(
  regionName: string,
  { search, extract, agent }: PlaceSearchDeps,
): Promise<{ places: WebPlacesType; sources: WebSource[] }> {
  const started = Date.now();
  const results = await Promise.allSettled(queries(regionName).map(search));
  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length === results.length) {
    throw (failures[0] as PromiseRejectedResult).reason;
  }

  const sources = new Map<string, WebSource>();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const source of result.value) {
      if (!sources.has(source.uri)) sources.set(source.uri, source);
    }
  }
  const searchMs = Date.now() - started;
  const request = (articles: WebSource[]) =>
    `Khu vực: ${regionName}, Việt Nam. Tìm các địa điểm nên ghé: điểm tham quan, check-in, thiên nhiên, văn hóa - lịch sử, ăn uống, cà phê, vui chơi, về đêm.\n\nCác bài viết:\n\n${articles.length > 0 ? formatArticles(articles) : '(chưa có bài nào)'}`;

  if (sources.size < MIN_SOURCES) {
    const found = await agent(request([...sources.values()]));
    // Bài ban đầu đã nằm trong prompt của agent, nên vẫn tính là bài model đã đọc.
    const all = new Map(sources);
    for (const source of found.sources) {
      if (!all.has(source.uri)) all.set(source.uri, source);
    }
    logger.log(
      `"${regionName}": tìm web chỉ ${sources.size} bài / ${searchMs} ms → agent thêm ${all.size - sources.size} bài, ${found.places.length} địa điểm / ${Date.now() - started - searchMs} ms`,
    );
    return {
      places: found.places.slice(0, MAX_PLACES),
      sources: [...all.values()],
    };
  }

  const { places } = await extract(
    SYSTEM_PROMPT,
    request([...sources.values()]),
  );
  logger.log(
    `"${regionName}": tìm web ${sources.size} bài / ${searchMs} ms` +
      (failures.length ? ` (${failures.length} truy vấn lỗi)` : '') +
      `; Gemini ${places.length} địa điểm / ${Date.now() - started - searchMs} ms`,
  );
  return {
    places: places.slice(0, MAX_PLACES),
    sources: [...sources.values()],
  };
}

/**
 * Tìm địa điểm của một vùng từ bài viết trên web (Tavily) và Gemini: đường
 * nhanh một lượt Gemini, agent LangChain chỉ khi đường nhanh ra quá ít bài.
 */
@Injectable()
export class PlaceSearchService {
  private readonly deps: PlaceSearchDeps | null = createDeps();

  /** Thiếu TAVILY_API_KEY thì API v2 trả 503 thay vì làm app không khởi động được. */
  get enabled(): boolean {
    return this.deps !== null;
  }

  async findPlaces(
    regionName: string,
  ): Promise<{ places: WebPlacesType; sources: WebSource[] }> {
    if (!this.deps) throw new Error('TAVILY_API_KEY chưa được cấu hình');
    return findPlacesFromWeb(regionName, this.deps);
  }
}

function createDeps(): PlaceSearchDeps | null {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;
  const thinking = { thinkingConfig: { thinkingLevel: 'LOW' as const } };
  const model = createGeminiModel(thinking).withStructuredOutput(
    PlaceSearchResult,
    { strict: true },
  );
  const agent = createAgent({
    model: createGeminiModel(thinking),
    tools: [createWebSearchTool(apiKey)],
    systemPrompt: AGENT_PROMPT,
    responseFormat: toolStrategy(PlaceSearchResult),
    middleware: [
      toolCallLimitMiddleware({
        toolName: WEB_SEARCH_TOOL_NAME,
        runLimit: AGENT_MAX_SEARCHES,
      }),
    ],
  });
  return {
    search: (query) => searchWeb(apiKey, query),
    extract: (system, request) =>
      model.invoke([new SystemMessage(system), new HumanMessage(request)]),
    agent: async (request) => {
      const result = await agent.invoke({
        messages: [{ role: 'user', content: request }],
      });
      const sources: WebSource[] = [];
      for (const message of result.messages) {
        if (
          ToolMessage.isInstance(message) &&
          Array.isArray(message.artifact)
        ) {
          sources.push(...(message.artifact as WebSource[]));
        }
      }
      return { places: result.structuredResponse?.places ?? [], sources };
    },
  };
}
