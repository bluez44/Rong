import { describe, expect, it, vi } from 'vitest';

import type { WebSource } from '../../langchain/web-search.js';
import {
  articlesMentioning,
  extractPublishedDate,
  fetchPublishedDate,
  normalizeForMatch,
} from './web-grounding.js';

const source = (uri: string, content: string, title = 'Bài viết'): WebSource => ({
  title,
  uri,
  content,
  publishedAt: null,
});

describe('normalizeForMatch', () => {
  it('bỏ dấu, đ, hoa thường và dấu câu', () => {
    expect(normalizeForMatch('Hồ Xuân Hương, ĐÀ LẠT!')).toBe('ho xuan huong da lat');
  });
});

describe('articlesMentioning', () => {
  const sources = [
    source('a', 'Buổi sáng dạo quanh hồ Xuân Hương rồi ghé Chợ Đà Lạt ăn bánh căn.'),
    source('b', 'Thiền viện Trúc Lâm nằm trên đồi Phụng Hoàng.'),
  ];

  it('trả các bài có nhắc tên, không phân biệt dấu và hoa thường', () => {
    expect(articlesMentioning('Hồ Xuân Hương', 'Đà Lạt, Lâm Đồng', sources).map((s) => s.uri)).toEqual(['a']);
    expect(articlesMentioning('THIỀN VIỆN TRÚC LÂM', 'Đà Lạt', sources).map((s) => s.uri)).toEqual(['b']);
  });

  it('địa điểm không có trong bài nào thì rỗng — model tự thêm', () => {
    expect(articlesMentioning('Dinh Bảo Đại', 'Đà Lạt', sources)).toEqual([]);
  });

  it('chấp nhận tên kèm tên vùng ở cuối hoặc phần trong ngoặc', () => {
    expect(articlesMentioning('Thiền viện Trúc Lâm Đà Lạt', 'Đà Lạt, Lâm Đồng', sources)).toHaveLength(1);
    expect(articlesMentioning('Chợ Đà Lạt (chợ Âm Phủ)', 'Đà Lạt', sources)).toHaveLength(1);
  });

  it('chỉ khớp nguyên từ, không khớp một phần của từ khác', () => {
    expect(articlesMentioning('Hồ Xuân', 'Đà Lạt', [source('c', 'hồ xuânhương')])).toEqual([]);
  });

  it('tên của bài viết cũng tính', () => {
    expect(articlesMentioning('Ga Đà Lạt', 'Lâm Đồng', [source('d', '...', 'Review Ga Đà Lạt cổ kính')])).toHaveLength(1);
  });
});

describe('extractPublishedDate', () => {
  it('meta article:published_time, thứ tự thuộc tính bất kỳ', () => {
    expect(
      extractPublishedDate('<meta content="2024-03-12T08:00:00+07:00" property="article:published_time">'),
    ).toBe('2024-03-12T01:00:00.000Z');
  });

  it('itemprop datePublished và JSON-LD', () => {
    expect(extractPublishedDate('<time itemprop="datePublished" datetime="2023-05-01">1/5</time>')).toBe(
      '2023-05-01T00:00:00.000Z',
    );
    expect(
      extractPublishedDate('<script type="application/ld+json">{"@type":"Article","datePublished": "2022-11-20T10:00:00Z"}</script>'),
    ).toBe('2022-11-20T10:00:00.000Z');
  });

  it('bỏ ngày hỏng, ngày tương lai và thẻ time không rõ nghĩa', () => {
    expect(extractPublishedDate('<meta property="article:published_time" content="không rõ">')).toBeNull();
    expect(extractPublishedDate('<meta property="article:published_time" content="2999-01-01">')).toBeNull();
    expect(extractPublishedDate('<time datetime="2024-01-01">bình luận</time>')).toBeNull();
  });
});

describe('fetchPublishedDate', () => {
  it('đọc ngày từ trang HTML', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('<head><meta name="pubdate" content="2021-06-15"></head>', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    ) as unknown as typeof fetch;
    await expect(fetchPublishedDate('https://a.vn', fetchImpl)).resolves.toBe('2021-06-15T00:00:00.000Z');
  });

  it('lỗi mạng, HTTP lỗi hay không phải HTML đều trả null', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('timeout')) as unknown as typeof fetch;
    await expect(fetchPublishedDate('https://a.vn', failing)).resolves.toBeNull();

    const notFound = vi.fn().mockResolvedValue(new Response('', { status: 404 })) as unknown as typeof fetch;
    await expect(fetchPublishedDate('https://a.vn', notFound)).resolves.toBeNull();

    const pdf = vi.fn().mockResolvedValue(
      new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }),
    ) as unknown as typeof fetch;
    await expect(fetchPublishedDate('https://a.vn/x.pdf', pdf)).resolves.toBeNull();
  });
});
