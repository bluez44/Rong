import { ToolMessage } from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';

import {
  createWebSearchTool,
  formatArticles,
  searchWeb,
  WEB_SEARCH_TOOL_NAME,
} from './web-search.js';

const json = (body: unknown, status = 200) =>
  vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify(body), { status }),
    ) as unknown as typeof fetch;

describe('searchWeb', () => {
  it('trả nội dung bài viết kèm nguồn', async () => {
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

    await expect(
      searchWeb('key', 'địa điểm Đà Lạt', fetchImpl),
    ).resolves.toEqual([
      {
        title: 'Top địa điểm Đà Lạt',
        uri: 'https://a.vn/da-lat',
        content: 'Hồ Xuân Hương nằm giữa thành phố.',
        publishedAt: null,
      },
      // Không có raw_content thì dùng đoạn trích.
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
    const [source] = await searchWeb(
      'key',
      'x',
      json({
        results: [
          {
            title: 'Dài',
            url: 'https://x.vn',
            content: '',
            raw_content: 'a'.repeat(10_000),
          },
        ],
      }),
    );
    expect(source.content.length).toBeLessThanOrEqual(2501);
  });

  it('HTTP lỗi thì ném lỗi', async () => {
    await expect(searchWeb('key', 'x', json({}, 401))).rejects.toThrow(
      'HTTP 401',
    );
  });
});

describe('createWebSearchTool', () => {
  const call = (fetchImpl: typeof fetch) =>
    createWebSearchTool('key', fetchImpl).invoke({
      type: 'tool_call',
      id: 'call-1',
      name: WEB_SEARCH_TOOL_NAME,
      args: { query: 'địa điểm Tà Xùa' },
    }) as Promise<ToolMessage>;

  it('gửi nội dung bài cho model, nguồn đi theo artifact', async () => {
    const message = await call(
      json({
        results: [{ title: 'A', url: 'https://a.vn', content: 'Thác A' }],
      }),
    );
    expect(message.content).toContain('URL: https://a.vn');
    expect(message.content).toContain('Thác A');
    expect(message.artifact).toEqual([
      { title: 'A', uri: 'https://a.vn', content: 'Thác A', publishedAt: null },
    ]);
  });

  it('không có kết quả thì báo cho model', async () => {
    const message = await call(json({ results: [] }));
    expect(message.content).toContain('Không tìm thấy');
    expect(message.artifact).toEqual([]);
  });
});

describe('formatArticles', () => {
  it('đánh số từng bài kèm URL', () => {
    const text = formatArticles([
      {
        title: 'A',
        uri: 'https://a.vn',
        content: 'Nội dung A',
        publishedAt: null,
      },
      {
        title: 'B',
        uri: 'https://b.vn',
        content: 'Nội dung B',
        publishedAt: null,
      },
    ]);
    expect(text).toContain('[1] A\nURL: https://a.vn\nNội dung A');
    expect(text).toContain('[2] B\nURL: https://b.vn\nNội dung B');
  });
});
