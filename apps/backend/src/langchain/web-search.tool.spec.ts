import { ToolMessage } from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';

import { createWebSearchTool, WEB_SEARCH_TOOL_NAME } from './web-search.tool.js';

function call(fetchImpl: typeof fetch, query = 'địa điểm Đà Lạt') {
  return createWebSearchTool('key', fetchImpl).invoke({
    type: 'tool_call',
    id: 'call-1',
    name: WEB_SEARCH_TOOL_NAME,
    args: { query },
  }) as Promise<ToolMessage>;
}

const json = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;

describe('createWebSearchTool', () => {
  it('gửi nội dung bài viết cho model, nguồn đi theo artifact', async () => {
    const fetchImpl = json({
      results: [
        {
          title: 'Top địa điểm Đà Lạt',
          url: 'https://a.vn/da-lat',
          content: 'tóm tắt',
          raw_content: 'Hồ Xuân Hương nằm giữa thành phố.',
        },
        {
          title: 'Blog B',
          url: 'https://b.vn',
          content: 'Chợ Đà Lạt',
          published_date: '2024-02-01',
        },
      ],
    });

    const message = await call(fetchImpl);

    expect(message.content).toContain('Hồ Xuân Hương nằm giữa thành phố.');
    expect(message.content).toContain('URL: https://a.vn/da-lat');
    // Không có raw_content thì dùng đoạn trích.
    expect(message.content).toContain('Chợ Đà Lạt');
    // Artifact giữ đúng nội dung model đã đọc, để server đối chiếu sau.
    expect(message.artifact).toEqual([
      {
        title: 'Top địa điểm Đà Lạt',
        uri: 'https://a.vn/da-lat',
        content: 'Hồ Xuân Hương nằm giữa thành phố.',
        publishedAt: null,
      },
      {
        title: 'Blog B',
        uri: 'https://b.vn',
        content: 'Chợ Đà Lạt',
        publishedAt: '2024-02-01',
      },
    ]);

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(url).toBe('https://api.tavily.com/search');
    expect(JSON.parse(init?.body as string)).toMatchObject({
      query: 'địa điểm Đà Lạt',
      include_raw_content: 'markdown',
    });
  });

  it('cắt bài quá dài', async () => {
    const message = await call(
      json({
        results: [
          { title: 'Dài', url: 'https://x.vn', content: '', raw_content: 'a'.repeat(10_000) },
        ],
      }),
    );
    expect((message.content as string).length).toBeLessThan(4200);
  });

  it('không có kết quả thì báo cho model', async () => {
    const message = await call(json({ results: [] }));
    expect(message.content).toContain('Không tìm thấy');
    expect(message.artifact).toEqual([]);
  });

  it('HTTP lỗi thì ném lỗi', async () => {
    await expect(call(json({}, 401))).rejects.toThrow('HTTP 401');
  });
});
