import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import * as z from 'zod';

/** Bài viết mà model đã đọc — trả kèm kết quả để kiểm chứng và hiển thị nguồn. */
export interface WebSource {
  title: string;
  uri: string;
  /** Đúng phần nội dung đã gửi cho model (đã cắt), để đối chiếu địa điểm model trả về. */
  content: string;
  /** Tavily chỉ có ngày đăng với một số trang (chủ yếu tin tức). */
  publishedAt: string | null;
}

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  raw_content?: string | null;
  published_date?: string | null;
}

export const WEB_SEARCH_TOOL_NAME = 'search_web';

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const RESULTS_PER_QUERY = 4;
/**
 * Cắt bớt mỗi bài để prompt không phình to (một bài blog du lịch thường dài
 * vài chục nghìn ký tự). Prompt càng dài, Gemini đọc càng lâu.
 */
const MAX_ARTICLE_CHARS = 2500;
const TIMEOUT_MS = 10_000;

const logger = new Logger('WebSearch');

/**
 * Tìm trên web (Tavily) và lấy luôn nội dung bài viết của từng kết quả trong
 * cùng một request, nên không phải tải từng trang riêng.
 */
export async function searchWeb(
  apiKey: string,
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WebSource[]> {
  const started = Date.now();
  const response = await fetchImpl(TAVILY_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: RESULTS_PER_QUERY,
      search_depth: 'basic',
      include_raw_content: 'markdown',
      country: 'vietnam',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    logger.warn(
      `Tavily "${query}" → HTTP ${response.status} sau ${Date.now() - started} ms`,
    );
    throw new Error(`Tavily trả HTTP ${response.status}`);
  }

  const { results = [] } = (await response.json()) as {
    results?: TavilyResult[];
  };
  logger.log(
    `Tavily "${query}": ${results.length} bài trong ${Date.now() - started} ms`,
  );
  return results.map((result) => ({
    title: result.title,
    uri: result.url,
    content: truncate(result.raw_content || result.content),
    publishedAt: result.published_date || null,
  }));
}

/** Nội dung các bài, đánh số, để đưa vào prompt. */
export function formatArticles(sources: WebSource[]): string {
  return sources
    .map(
      (source, i) =>
        `[${i + 1}] ${source.title}\nURL: ${source.uri}\n${source.content}`,
    )
    .join('\n\n---\n\n');
}

/**
 * `searchWeb` dưới dạng công cụ cho agent (đường dự phòng khi truy vấn cố
 * định ra quá ít bài). Nội dung bài là `content` gửi cho model; danh sách
 * nguồn đi theo `artifact` để server đối chiếu.
 */
export function createWebSearchTool(apiKey: string, fetchImpl = fetch) {
  return tool(
    async ({ query }): Promise<[string, WebSource[]]> => {
      const sources = await searchWeb(apiKey, query, fetchImpl);
      return sources.length > 0
        ? [formatArticles(sources), sources]
        : [`Không tìm thấy bài viết nào cho "${query}".`, []];
    },
    {
      name: WEB_SEARCH_TOOL_NAME,
      description:
        'Tìm trên web và trả về nội dung các bài viết (blog du lịch, báo, trang review) khớp với truy vấn. ' +
        'Dùng để tìm địa điểm tham quan, ăn uống, cà phê… ở một khu vực.',
      schema: z.object({
        query: z
          .string()
          .describe(
            'Truy vấn tìm kiếm tiếng Việt, ví dụ "địa điểm check-in đẹp ở Đà Lạt"',
          ),
      }),
      responseFormat: 'content_and_artifact',
    },
  );
}

function truncate(text: string): string {
  const clean = text.replace(/\n{3,}/g, '\n\n').trim();
  return clean.length > MAX_ARTICLE_CHARS
    ? `${clean.slice(0, MAX_ARTICLE_CHARS)}…`
    : clean;
}
