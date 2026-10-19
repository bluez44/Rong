import * as z from 'zod';

/** Chủ đề khám phá riêng cho một người — xem modules/recommendations/theme-generator.ts. */
export const UserThemesPlan = z.object({
  themes: z
    .array(
      z.object({
        label: z.string().describe('Tên chủ đề ngắn gọn, gợi cảm hứng, tiếng Việt, dưới 40 ký tự, ví dụ "Xứ sở dừa"'),
        icon: z.string().describe('Một trong: sparkles, forest, sun, cafe, food, culture, nature, kids, nightlife, kayak, motorcycle, explore'),
        categories: z.array(z.string()).describe('Danh mục địa điểm: check_in, food, cafe, nature, kids, culture, nightlife'),
        regionIds: z.array(z.string()).describe('id vùng, chỉ dùng id có trong danh sách được cung cấp'),
      }),
    )
    .describe('Tối đa 3 chủ đề'),
});

export type UserThemesPlanType = z.infer<typeof UserThemesPlan>;
