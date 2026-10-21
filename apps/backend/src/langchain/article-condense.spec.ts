import { describe, expect, it } from 'vitest';

import { condenseArticle } from './article-condense.js';

const para = (n: number) => `Đoạn mô tả ${'rất dài '.repeat(n)}kết thúc.`;

describe('condenseArticle', () => {
  it('bài "Top 20" dài giữ đủ 20 tiêu đề', () => {
    const md = [
      '# Top 20 địa điểm du lịch Phước Hải',
      para(40),
      ...Array.from(
        { length: 20 },
        (_, i) => `## ${i + 1}. Địa điểm số ${i + 1}\n${para(200)}`,
      ),
    ].join('\n\n');
    const { text, headings } = condenseArticle(md);
    expect(md.length).toBeGreaterThan(30_000);
    for (let i = 1; i <= 20; i++) expect(text).toContain(`Địa điểm số ${i}`);
    expect(headings).toBe(21);
    expect(text.length).toBeLessThanOrEqual(12_000);
  });

  it('nhận các dạng tiêu đề: **1. Tên**, 1) Tên, ### **2. Tên**', () => {
    const md = [
      '**1. Bãi Kiwuki**',
      para(5),
      '2) Chợ hải sản',
      para(5),
      '### **3. Hồ Cốc**',
      para(5),
    ].join('\n');
    const { text, headings } = condenseArticle(md);
    expect(headings).toBe(3);
    expect(text).toContain('Bãi Kiwuki');
    expect(text).toContain('Chợ hải sản');
    // Không còn dấu * dính vào tên (kiểm chứng tên so theo ranh giới từ).
    expect(text).toMatch(/3\. Hồ Cốc/);
    expect(text).not.toContain('**3. Hồ Cốc**');
  });

  it('bỏ menu dạng link, dòng trùng, cụm rác và mục "Bài viết liên quan" / "Bình luận"', () => {
    const md = [
      '[Trang chủ](/) | [Du lịch](/du-lich) | [Ẩm thực](/am-thuc)',
      '## 1. Bãi biển Phước Hải',
      'Bãi biển dài, cát mịn.',
      'Bãi biển dài, cát mịn.',
      'Xem thêm: 10 quán ăn ngon',
      '## Bài viết liên quan',
      'Top 5 homestay Vũng Tàu',
      '## 2. Dinh Cô',
      'Di tích nổi tiếng.',
      '## Bình luận',
      'Bài viết hay quá!',
      '© 2026 Bản quyền thuộc về abc.vn',
    ].join('\n');
    const { text } = condenseArticle(md);
    expect(text).not.toContain('Trang chủ');
    expect(text.match(/Bãi biển dài, cát mịn\./g)).toHaveLength(1);
    expect(text).not.toContain('Xem thêm');
    expect(text).not.toContain('Top 5 homestay');
    expect(text).not.toContain('Bài viết hay');
    expect(text).not.toContain('Bản quyền');
    expect(text).toContain('Dinh Cô');
  });

  it('mỗi mục giữ tối đa 400 ký tự nội dung, cắt ở ranh giới từ', () => {
    const md = [
      '## 1. A địa điểm',
      'chữ '.repeat(500),
      '## 2. B',
      'x',
      '## 3. C',
      'y',
    ].join('\n');
    const { text } = condenseArticle(md);
    const body = text.split('\n')[1];
    expect(body.length).toBeLessThanOrEqual(401);
    expect(body.endsWith('chữ…') || body.endsWith('chữ')).toBe(true);
  });

  it('bài không có cấu trúc lấy 6.000 ký tự đầu', () => {
    const md = 'Một bài báo viết liền. '.repeat(1000);
    const { text, headings } = condenseArticle(md);
    expect(headings).toBe(0);
    expect(text.length).toBeLessThanOrEqual(6_001);
    expect(text.length).toBeGreaterThan(5_000);
  });

  it('tiêu đề không bao giờ bị cắt khi vượt trần', () => {
    const md = Array.from(
      { length: 60 },
      (_, i) => `## ${i + 1}. Quán số ${i + 1}\n${para(80)}`,
    ).join('\n');
    const { text } = condenseArticle(md);
    for (let i = 1; i <= 60; i++) expect(text).toContain(`Quán số ${i}`);
    expect(text.length).toBeLessThanOrEqual(12_000);
  });
});
