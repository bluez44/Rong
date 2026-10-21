import { ToolMessage } from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';

import {
  createWebSearchTool,
  extractImages,
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
        images: [],
      },
      // Không có raw_content thì dùng đoạn trích.
      {
        title: 'Blog B',
        uri: 'https://b.vn',
        content: 'Chợ Đà Lạt',
        publishedAt: '2024-02-01',
        images: [],
      },
    ]);

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(url).toBe('https://api.tavily.com/search');
    expect(JSON.parse(init?.body as string)).toMatchObject({
      query: 'địa điểm Đà Lạt',
      include_raw_content: 'markdown',
    });
  });

  it('rút gọn bài quá dài (bài không có tiêu đề: 6.000 ký tự đầu)', async () => {
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
    expect(source.content.length).toBeLessThanOrEqual(6001);
    expect(source.content.length).toBeGreaterThan(2501);
  });

  it('HTTP lỗi thì ném lỗi', async () => {
    await expect(searchWeb('key', 'x', json({}, 401))).rejects.toThrow(
      'HTTP 401',
    );
  });

  it('tách ảnh từ raw_content trước khi cắt, nội dung gửi model không còn cú pháp ảnh', async () => {
    const fetchImpl = json({
      results: [
        {
          title: 'Top check-in',
          url: 'https://c.vn/top',
          content: 'tóm tắt',
          raw_content:
            '## 1. Dinh Tỉnh trưởng\n![Dinh Tỉnh trưởng](https://c.vn/dinh.jpg)\nDinh nằm trên đồi.',
        },
      ],
    });

    const [source] = await searchWeb('key', 'check-in Đà Lạt', fetchImpl);
    expect(source.images).toEqual([
      {
        url: 'https://c.vn/dinh.jpg',
        alt: 'Dinh Tỉnh trưởng',
        heading: '1. Dinh Tỉnh trưởng',
      },
    ]);
    expect(source.content).not.toContain('![');
    expect(source.content).toContain('Dinh nằm trên đồi.');
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
      {
        title: 'A',
        uri: 'https://a.vn',
        content: 'Thác A',
        publishedAt: null,
        images: [],
      },
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
        images: [],
      },
      {
        title: 'B',
        uri: 'https://b.vn',
        content: 'Nội dung B',
        publishedAt: null,
        images: [],
      },
    ]);
    expect(text).toContain('[1] A\nURL: https://a.vn\nNội dung A');
    expect(text).toContain('[2] B\nURL: https://b.vn\nNội dung B');
  });
});

describe('extractImages', () => {
  const ARTICLE = [
    '![Ảnh bìa Đà Lạt](https://cdn.zlp.test/top.jpg)',
    '![Logo ZaloPay](https://cdn.zlp.test/brand.png)',
    '![](https://cdn.zlp.test/empty.jpg)',
    '# Check in Đà Lạt',
    '![Đà Lạt mùa hoa](https://cdn.zlp.test/cover.jpg?w=800)',
    '**1. Nhà mục vụ Don Bosco - Địa điểm check in siêu đẹp**',
    'Nhà mục vụ nằm ở phường 7.',
    '![Nhà mục vụ Don Bosco](https://cdn.zlp.test/1.jpg "ảnh 1")',
    '## 2. Dinh Tỉnh trưởng',
    '[![Dinh Tỉnh trưởng](https://cdn.zlp.test/2.jpg)](https://zlp.test/dinh)',
    '![Dinh Tỉnh trưởng](https://cdn.zlp.test/2.jpg)',
    '![icon](data:image/gif;base64,R0lGOD)',
    '![Bản đồ](https://cdn.zlp.test/map.svg)',
    '![Ảnh động](https://cdn.zlp.test/anim.gif?x=1)',
    '![Tác giả](https://cdn.zlp.test/avatar/a.jpg)',
  ].join('\n');

  it('lấy ảnh thật kèm alt và tiêu đề mục gần nhất, bỏ logo/icon/svg/gif/data:, alt rỗng và ảnh trùng', () => {
    expect(extractImages(ARTICLE)).toEqual([
      {
        url: 'https://cdn.zlp.test/top.jpg',
        alt: 'Ảnh bìa Đà Lạt',
        heading: null,
      },
      {
        url: 'https://cdn.zlp.test/cover.jpg?w=800',
        alt: 'Đà Lạt mùa hoa',
        heading: 'Check in Đà Lạt',
      },
      {
        url: 'https://cdn.zlp.test/1.jpg',
        alt: 'Nhà mục vụ Don Bosco',
        heading: '1. Nhà mục vụ Don Bosco - Địa điểm check in siêu đẹp',
      },
      {
        url: 'https://cdn.zlp.test/2.jpg',
        alt: 'Dinh Tỉnh trưởng',
        heading: '2. Dinh Tỉnh trưởng',
      },
    ]);
  });

  it('giữ tối đa 60 ảnh mỗi bài', () => {
    const many = Array.from(
      { length: 70 },
      (_, i) => `![Ảnh ${i}](https://cdn.test/${i}.jpg)`,
    ).join('\n');
    expect(extractImages(many)).toHaveLength(60);
  });

  it('dòng in đậm không đánh số (nhãn "Giá vé") không thay tiêu đề mục', () => {
    const md = [
      '## 3. Hồ Xuân Hương',
      '**Giá vé**',
      'Miễn phí.',
      '![Ảnh hồ](https://cdn.test/ho.jpg)',
      '**4) Chợ Đà Lạt**',
      '![Ảnh chợ](https://cdn.test/cho.jpg)',
    ].join('\n');
    expect(extractImages(md).map((i) => i.heading)).toEqual([
      '3. Hồ Xuân Hương',
      '4) Chợ Đà Lạt',
    ]);
  });

  it('không có ảnh thì rỗng', () => {
    expect(extractImages('Chỉ có chữ.')).toEqual([]);
  });
});
