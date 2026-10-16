import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { PlaceCategory } from '@rong/shared-types';
import * as z from 'zod';

import { createGeminiModel } from '../../chat-models/gemini-model.factory.js';
import { articlesMentioning, normalizeForMatch } from '../places/web-grounding.js';
import type { LinkMetadata } from './link-metadata.service.js';

export const MAX_EXTRACTED = 15;
const MAX_QUOTE = 200;

export const PLACE_EXTRACTOR = 'PLACE_EXTRACTOR';

/** strict structured output không cho null: chuỗi rỗng nghĩa là không có. */
export const ExtractedPlacesSchema = z.object({
  places: z
    .array(
      z.object({
        name: z.string().describe('Tên riêng của địa điểm, viết đúng như trong nội dung'),
        category: z
          .enum(['check_in', 'food', 'cafe', 'nature', 'kids', 'culture', 'nightlife', 'stay'])
          .describe(
            'check_in = điểm check-in/ngắm cảnh, food = ăn uống, cafe = cà phê, nature = thiên nhiên, kids = vui chơi cho trẻ em, culture = văn hóa - lịch sử, nightlife = về đêm, stay = lưu trú',
          ),
        regionHint: z
          .string()
          .describe('Tỉnh/thành phố/điểm đến nội dung nói địa điểm nằm ở; chuỗi rỗng nếu không nói'),
        address: z.string().describe('Địa chỉ đúng như nội dung ghi; chuỗi rỗng nếu không có'),
        quote: z.string().describe('Câu ngắn trong nội dung có nhắc tới địa điểm'),
      }),
    )
    .describe('Các địa điểm cụ thể được nhắc tới'),
});

export type ExtractFn = (
  system: string,
  request: string,
) => Promise<z.infer<typeof ExtractedPlacesSchema>>;

export interface ExtractedPlace {
  name: string;
  category: PlaceCategory;
  regionHint: string | null;
  address: string | null;
  quote: string;
}

export const EXTRACTION_PROMPT = `Bạn đọc nội dung một video hoặc bài viết về du lịch Việt Nam mà người dùng vừa chia sẻ, và liệt kê các địa điểm cụ thể (có tên riêng) được nhắc tới: quán ăn, quán cà phê, điểm tham quan, check-in, chợ, chùa, thác, khu vui chơi…
Quy tắc:
- CHỈ dùng tên xuất hiện trong nội dung. Không thêm từ hiểu biết riêng — hệ thống đối chiếu từng tên với nội dung và loại tên không có.
- Không liệt kê tên tỉnh, thành phố, quận, phường đứng riêng (ví dụ "Đà Lạt") như một địa điểm.
- Tối đa ${MAX_EXTRACTED} địa điểm, theo thứ tự xuất hiện.
- Không có địa điểm nào thì trả mảng rỗng.`;

/** Ghép các phần metadata và lời người dùng thành một văn bản để model đọc. */
export function buildExtractionInput(
  meta: LinkMetadata | null,
  sharedText: string | null,
): string {
  const parts: Array<[string, string | null | undefined]> = [
    ['Tiêu đề', meta?.title],
    ['Tác giả', meta?.authorName],
    ['Mô tả', meta?.description],
    ['Người dùng viết', sharedText],
  ];
  return parts
    .filter(([, value]) => value?.trim())
    .map(([label, value]) => `${label}: ${value!.trim()}`)
    .join('\n');
}

/**
 * Một lượt Gemini, rồi chỉ giữ tên thực sự có trong nội dung (FR-4.3), gộp
 * trùng theo tên đã bỏ dấu, tối đa MAX_EXTRACTED.
 */
export async function extractPlaces(
  input: string,
  extract: ExtractFn,
): Promise<ExtractedPlace[]> {
  if (!input.trim()) return [];
  const { places } = await extract(EXTRACTION_PROMPT, `Nội dung:\n${input}`);
  const source = [{ title: '', uri: '', content: input, publishedAt: null, images: [] }];
  const seen = new Set<string>();
  const result: ExtractedPlace[] = [];
  for (const place of places) {
    const name = place.name.trim();
    const key = normalizeForMatch(name);
    if (!key || seen.has(key)) continue;
    if (articlesMentioning(name, place.regionHint, source).length === 0) continue;
    seen.add(key);
    result.push({
      name,
      category: place.category,
      regionHint: place.regionHint.trim() || null,
      address: place.address.trim() || null,
      quote: place.quote.trim().slice(0, MAX_QUOTE),
    });
    if (result.length === MAX_EXTRACTED) break;
  }
  return result;
}

export function createPlaceExtractor(): ExtractFn {
  const model = createGeminiModel({
    thinkingConfig: { thinkingLevel: 'LOW' as const },
  }).withStructuredOutput(ExtractedPlacesSchema, { strict: true });
  return (system, request) =>
    model.invoke([new SystemMessage(system), new HumanMessage(request)]);
}
