# Tìm xã/phường và danh sách địa điểm đầy đủ hơn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tìm được mọi xã/phường sau sáp nhập (kể cả gõ không dấu), mỗi vùng mở ra có ít nhất 10 địa điểm khi nguồn cho phép, và Gemini đọc đủ các mục của bài viết thay vì 2.500 ký tự đầu.

**Architecture:**
- Bài viết được rút gọn theo cấu trúc (`condenseArticle`), giữ mọi tiêu đề mục.
- Pipeline địa điểm chạy lượt 2 bằng agent khi lượt 1 lưu được ít hơn ngưỡng.
- 3.321 xã/phường sinh một lần từ bộ dữ liệu MIT của thanglequoc thành `vietnam-wards.json` (commit), rồi `RegionSeeder` seed hàng loạt.
- Tìm kiếm dùng bí danh tên ngắn. Nominatim thử thêm bản không dấu và không nhập xã/phường. Pipeline gọi xã bằng "tên ngắn, tỉnh cũ".

**Tech Stack:** NestJS 12 ESM, TypeORM + Postgres/PostGIS (raw SQL), vitest, LangChain + Gemini, Tavily.

**Spec:** `docs/superpowers/specs/2026-10-21-ward-search-design.md`

**Lệch so với spec (đã cân nhắc):**
- Spec §1.2 để ngỏ chỗ lưu phiên bản seed. Plan **không thêm migration**: phiên bản ghi trong `regions.area_source.dataset` của từng dòng xã. Bỏ qua seed khi số dòng xã có `dataset = version` bằng số xã trong file.
- Spec §5 đặt test hai lượt ở unit với dependency giả. Plan kiểm phần agent lượt 2 bằng unit (`findMorePlacesFromWeb`), còn phần gộp/lưu/giữ danh sách cũ bằng e2e `web-places` trên database thật (logic nằm giữa service và store).

## Global Constraints

- Comment, log, chuỗi lỗi bằng tiếng Việt. Backend ESM: import tương đối có đuôi `.js`.
- `MAX_PLACES = 40` **giữ nguyên**.
- Ngưỡng tối thiểu: env `WEB_PLACES_MIN_COUNT`, mặc định 10. Tối đa 2 lượt; sau 2 lượt có ≥ 1 địa điểm thì lưu; 0 thì `PLACES_UNAVAILABLE`.
- Rút gọn bài: mở bài ≤ 600 ký tự; mỗi mục: tiêu đề (≤ 150 ký tự) + ≤ 400 ký tự nội dung; trần 12.000 ký tự/bài, giảm đều nội dung (tối thiểu 120/mục), không cắt tiêu đề; bài dưới 3 tiêu đề lấy 6.000 ký tự đầu nội dung đã lọc rác.
- Dữ liệu xã: thanglequoc/vietnamese-provinces-database **v5.2.0** (MIT). Tọa độ làm tròn 5 chữ số thập phân.
- Xã: `source_key = 'vn:ward:<code>'`, `type = 'administrative'`, `level = 'ward'`, `boundary_version = 'current'`.
- Thứ tự nhóm kết quả tìm giữ nguyên: tỉnh → điểm đến → xã/phường.
- Nominatim: tối đa 2 câu mỗi lượt tìm; không nhập kết quả có tên xã/phường/thị trấn/đặc khu.
- Tên vùng gửi pipeline cho xã: `"<tên ngắn>, <tên tỉnh cũ>"`, không có tỉnh cũ thì `"<tên ngắn>, <tên tỉnh mới>"`.
- e2e chạy trên database dev (Neon). Plan này **không** có migration.
- Commit nhỏ, mỗi task ít nhất một commit; message kết thúc bằng dòng attribution của phiên.

## Review Focus

1. **Bài viết có tiêu đề dạng `### **1. Tên**`** (heading markdown bọc in đậm, rất hay gặp ở blog Việt) — tên vẫn phải được giữ và còn khớp kiểm chứng tên (không còn dấu `*` dính vào từ). → test "heading lồng in đậm" ở Task 1.
2. **Cùng một tên xã ở hai tỉnh** (ví dụ "Phước Hải" có ở TP.HCM, cũng có làng Phước Hải ở Khánh Hòa) — cả hai xuất hiện, mỗi kết quả kèm tỉnh, không bị gộp. → e2e "xã trùng tên hai tỉnh" ở Task 4.
3. **Lượt 2 trả lại đúng các tên đã có**, chỉ khác dấu hay hoa thường — không nhân đôi trong danh sách. → e2e "lượt 2 trùng tên lượt 1" ở Task 2.
4. **Khởi động lại khi dữ liệu xã đã seed** — không chậm, không ghi lại 3.321 dòng. → e2e "seed lần hai bỏ qua" ở Task 4.
5. **Gõ "xa phuoc hai" hoặc "Xã Phước Hải"** (kèm tiền tố) — vẫn ra đúng xã ngay trong danh mục. → e2e ở Task 4.

---

## File Structure

| File | Trách nhiệm |
| --- | --- |
| `apps/backend/src/langchain/article-condense.ts` (mới) + `.spec.ts` | Rút gọn markdown bài viết theo cấu trúc |
| `apps/backend/src/langchain/web-search.ts` | Dùng `condenseArticle` thay `truncate`; log độ dài |
| `apps/backend/src/langchain/place-search.service.ts` (+ `.spec.ts`) | `findMorePlacesFromWeb`, `PlaceSearchService.findMorePlaces` |
| `apps/backend/src/modules/places/web-places.service.ts` | Hai lượt, gộp, giữ danh sách cũ, tên vùng cho xã |
| `apps/backend/src/modules/places/region-place-store.ts` | `count`, `postpone` |
| `apps/backend/src/config/configuration.ts`, `.env.example` | `WEB_PLACES_MIN_COUNT` |
| `apps/backend/src/modules/regions/seed/ward-seed-builder.ts` (mới) + `.spec.ts` | Hàm thuần: bbox từ hình học, chọn tỉnh cũ, dựng dữ liệu xã |
| `apps/backend/scripts/generate-ward-seed.ts` (mới) | Script đọc bộ dữ liệu, ghi `vietnam-wards.json` |
| `apps/backend/src/modules/regions/seed/vietnam-wards.json` (sinh, commit) | 3.321 xã |
| `apps/backend/src/modules/regions/region-seeder.ts`, `entities/region.entity.ts` | Seed xã, bí danh, bỏ qua theo phiên bản |
| `apps/backend/src/modules/regions/search-text.ts` (+ `.spec.ts`) | `stripWardPrefix`, `nominatimQueries` |
| `apps/backend/src/modules/regions/regions.service.ts` | Hai câu Nominatim, không nhập xã |
| `apps/backend/test/region-search.e2e-spec.ts`, `test/web-places.e2e-spec.ts` | e2e |
| `apps/backend/src/modules/README.md`, `CLAUDE.md` | Tài liệu |

---

### Task 1: Rút gọn bài viết theo cấu trúc

**Files:**
- Create: `apps/backend/src/langchain/article-condense.ts`
- Test: `apps/backend/src/langchain/article-condense.spec.ts`
- Modify: `apps/backend/src/langchain/web-search.ts` (`MAX_ARTICLE_CHARS`, `truncate`, chỗ dựng `content`)

**Interfaces:**
- Produces: `condenseArticle(markdown: string): { text: string; headings: number }`; các hằng `CONDENSE_LIMITS`.

- [ ] **Step 1: Viết test thất bại**

```ts
// apps/backend/src/langchain/article-condense.spec.ts
import { describe, expect, it } from 'vitest';

import { condenseArticle } from './article-condense.js';

const para = (n: number) => `Đoạn mô tả ${'rất dài '.repeat(n)}kết thúc.`;

describe('condenseArticle', () => {
  it('bài "Top 20" dài giữ đủ 20 tiêu đề', () => {
    const md = [
      '# Top 20 địa điểm du lịch Phước Hải',
      para(40),
      ...Array.from({ length: 20 }, (_, i) => `## ${i + 1}. Địa điểm số ${i + 1}\n${para(200)}`),
    ].join('\n\n');
    const { text, headings } = condenseArticle(md);
    expect(md.length).toBeGreaterThan(30_000);
    for (let i = 1; i <= 20; i++) expect(text).toContain(`Địa điểm số ${i}`);
    expect(headings).toBe(21);
    expect(text.length).toBeLessThanOrEqual(12_000);
  });

  it('nhận các dạng tiêu đề: **1. Tên**, 1) Tên, ### **2. Tên**', () => {
    const md = ['**1. Bãi Kiwuki**', para(5), '2) Chợ hải sản', para(5), '### **3. Hồ Cốc**', para(5)].join('\n');
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
    const md = ['## 1. A địa điểm', 'chữ '.repeat(500), '## 2. B', 'x', '## 3. C', 'y'].join('\n');
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
    const md = Array.from({ length: 60 }, (_, i) => `## ${i + 1}. Quán số ${i + 1}\n${para(80)}`).join('\n');
    const { text } = condenseArticle(md);
    for (let i = 1; i <= 60; i++) expect(text).toContain(`Quán số ${i}`);
    expect(text.length).toBeLessThanOrEqual(12_000);
  });
});
```

Run: `cd apps/backend && npx vitest run src/langchain/article-condense.spec.ts`
Expected: FAIL — không tìm thấy `./article-condense.js`.

- [ ] **Step 2: Viết `article-condense.ts`**

```ts
// apps/backend/src/langchain/article-condense.ts
import { normalizeForMatch } from '../modules/places/web-grounding.js';

/**
 * Giới hạn khi rút gọn một bài (spec 2026-10-21-ward-search §4). Cắt cứng 2.500 ký tự đầu làm bài
 * "Top 20" chỉ còn 2–3 mục; giữ mọi tiêu đề mục để Gemini thấy đủ tên, mỗi mục chỉ kèm đoạn đầu.
 */
export const CONDENSE_LIMITS = {
  intro: 600,
  heading: 150,
  section: 400,
  minSection: 120,
  article: 12_000,
  unstructured: 6_000,
  /** Dưới chừng này tiêu đề thì coi là bài viết liền. */
  minHeadings: 3,
} as const;

const JUNK_PHRASES = [
  'xem them',
  'chia se',
  'dang ky nhan',
  'ban quyen',
  'cookie',
  'theo doi chung toi',
];
const JUNK_SECTIONS = [
  'bai viet lien quan',
  'co the ban quan tam',
  'binh luan',
  'tin moi nhat',
  'tin lien quan',
  'bai viet moi',
];
const LINK = /\[([^\]]*)\]\([^)]*\)/g;

interface Section {
  heading: string | null;
  lines: string[];
}

/** Tiêu đề mục: markdown `#`, in đậm có số `**1. Tên**`, danh sách có số ngắn `1. Tên` / `1) Tên`. */
function headingText(line: string): string | null {
  const md = /^#{1,6}\s+(.+)$/.exec(line);
  const raw = md ? md[1] : line;
  const unbold = raw.replace(/^\*\*(.+?)\*\*:?$/, '$1').trim();
  if (md) return unbold;
  if (/^\*\*\s*\d+[.)]\s*.+\*\*:?$/.test(line)) return unbold;
  if (/^\d+[.)]\s+\S/.test(line) && line.length < 120) return line;
  return null;
}

function isJunkLine(line: string): boolean {
  if (line.length < 3) return true;
  const linkChars = [...line.matchAll(LINK)].reduce((n, m) => n + m[0].length, 0);
  if (linkChars / line.length > 0.6) return true;
  if (line.includes('©')) return true;
  const folded = normalizeForMatch(line);
  return JUNK_PHRASES.some((p) => folded.startsWith(p) || folded.includes(` ${p} `) || folded === p);
}

function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const space = slice.lastIndexOf(' ');
  return `${(space > max * 0.6 ? slice.slice(0, space) : slice).trimEnd()}…`;
}

/**
 * Rút gọn markdown của một bài viết. Trả về văn bản (đưa vào prompt và dùng để kiểm chứng tên)
 * và số tiêu đề đã giữ.
 */
export function condenseArticle(markdown: string): { text: string; headings: number } {
  const seen = new Set<string>();
  const sections: Section[] = [{ heading: null, lines: [] }];
  let skipping = false;

  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = headingText(line);
    if (heading !== null) {
      skipping = JUNK_SECTIONS.some((s) => normalizeForMatch(heading).startsWith(s));
      if (!skipping) sections.push({ heading: heading.slice(0, CONDENSE_LIMITS.heading), lines: [] });
      continue;
    }
    if (skipping || isJunkLine(line)) continue;
    const key = normalizeForMatch(line);
    if (seen.has(key)) continue;
    seen.add(key);
    sections[sections.length - 1].lines.push(line.replace(LINK, '$1'));
  }

  const [intro, ...items] = sections;
  const headings = items.length;
  const introText = intro.lines.join('\n');

  if (headings < CONDENSE_LIMITS.minHeadings) {
    const all = [introText, ...items.flatMap((s) => [s.heading ?? '', ...s.lines])]
      .filter(Boolean)
      .join('\n');
    return { text: cutAtWord(all, CONDENSE_LIMITS.unstructured), headings };
  }

  const headingChars = items.reduce((n, s) => n + (s.heading?.length ?? 0) + 1, 0);
  const introPart = cutAtWord(introText, CONDENSE_LIMITS.intro);
  const room = CONDENSE_LIMITS.article - headingChars - introPart.length;
  const perSection = Math.max(
    CONDENSE_LIMITS.minSection,
    Math.min(CONDENSE_LIMITS.section, Math.floor(room / headings) - 1),
  );

  const out: string[] = introPart ? [introPart] : [];
  let used = introPart.length;
  for (const s of items) {
    const head = s.heading ?? '';
    if (used + head.length + 1 > CONDENSE_LIMITS.article) break;
    out.push(head);
    used += head.length + 1;
    const body = cutAtWord(s.lines.join(' '), perSection);
    if (body && used + body.length + 1 <= CONDENSE_LIMITS.article) {
      out.push(body);
      used += body.length + 1;
    }
  }
  return { text: out.join('\n'), headings };
}
```

Lưu ý: `normalizeForMatch` hiện nằm ở `modules/places/web-grounding.ts`. Nếu import từ `langchain/` sang `modules/places/` tạo vòng import (`web-grounding.ts` import kiểu từ `langchain/web-search.js`), **chuyển `normalizeForMatch` sang `src/langchain/text.ts`** rồi để `web-grounding.ts` re-export nó, giữ nguyên các import hiện có.

Run: `cd apps/backend && npx vitest run src/langchain/article-condense.spec.ts`
Expected: 6 test PASS. Nếu test "ranh giới từ" lệch vì kiểu ghép dòng, sửa `cutAtWord`/cách ghép, không sửa ý của test.

- [ ] **Step 3: Dùng trong `web-search.ts`**

- Xóa `MAX_ARTICLE_CHARS` và hàm `truncate`; import `condenseArticle`.
- Trong `searchWeb`, thay `content: truncate(stripImages(result.raw_content || result.content))` bằng:

```ts
  const mapped = results.map((result) => {
    const raw = stripImages(result.raw_content || result.content).replace(/\n{3,}/g, '\n\n').trim();
    const { text, headings } = condenseArticle(raw);
    rawChars += raw.length;
    keptChars += text.length;
    keptHeadings += headings;
    return {
      title: result.title,
      uri: result.url,
      content: text,
      publishedAt: result.published_date || null,
      images: result.raw_content ? extractImages(result.raw_content) : [],
    };
  });
  logger.log(
    `Tavily "${query}": ${results.length} bài, rút gọn ${rawChars} → ${keptChars} ký tự, ${keptHeadings} tiêu đề`,
  );
  return mapped;
```

(khai báo `let rawChars = 0, keptChars = 0, keptHeadings = 0;` trước; bỏ dòng log cũ chỉ ghi số bài, giữ thông tin thời gian nếu đang có.)

- Sửa comment đầu file cho đúng (không còn "cắt bớt mỗi bài").

- [ ] **Step 4: Chạy test langchain và grounding**

Run: `cd apps/backend && npx vitest run src/langchain src/modules/places`
Expected: PASS. Test nào trong `web-search.spec.ts` khẳng định cắt 2.500 ký tự thì cập nhật kỳ vọng theo hành vi mới (ghi lại trong ledger).

- [ ] **Step 5: Lint, typecheck, commit**

Run: `cd apps/backend && pnpm lint && pnpm typecheck`

```bash
git add apps/backend/src/langchain
git commit -m "feat(backend): condense articles by structure instead of cutting at 2,500 chars"
```

---

### Task 2: Tối thiểu 10 địa điểm — lượt 2

**Files:**
- Modify: `apps/backend/src/langchain/place-search.service.ts` (+ `place-search.service.spec.ts`)
- Modify: `apps/backend/src/modules/places/web-places.service.ts` (`build`)
- Modify: `apps/backend/src/modules/places/region-place-store.ts` (thêm `count`, `postpone`)
- Modify: `apps/backend/src/config/configuration.ts` (`WebPlacesConfig.minCount`), `apps/backend/.env.example`
- Test: `apps/backend/test/web-places.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `findMorePlacesFromWeb(regionName: string, known: string[], sources: WebSource[], deps: Pick<PlaceSearchDeps, 'agent'>): Promise<{ places: WebPlacesType; sources: WebSource[] }>`
  - `PlaceSearchService.findMorePlaces(regionName: string, known: string[], sources: WebSource[])` (cùng kiểu trả về)
  - `WebPlacesConfig.minCount: number` (`WEB_PLACES_MIN_COUNT`, mặc định 10)
  - `RegionPlaceStore.count(regionId: string): Promise<number>`; `RegionPlaceStore.postpone(regionId: string, refreshDays: number): Promise<void>`

- [ ] **Step 1: Test thất bại cho `findMorePlacesFromWeb`**

Thêm vào `place-search.service.spec.ts` (dùng các helper/fixture sẵn có trong file cho `WebSource` và địa điểm; nếu tên helper khác, dùng helper hiện có):

```ts
describe('findMorePlacesFromWeb', () => {
  it('gọi agent với bài đã có và danh sách tên cần tránh; gộp nguồn', async () => {
    const old = [source('https://a.vn/1')];
    const fresh = [source('https://b.vn/2')];
    const agent = vi.fn(async () => ({ places: [place('Hồ Cốc')], sources: fresh }));
    const result = await findMorePlacesFromWeb('Phước Hải, Bà Rịa - Vũng Tàu', ['Dinh Cô', 'Chợ Phước Hải'], old, { agent });
    const prompt = agent.mock.calls[0][0] as string;
    expect(prompt).toContain('Dinh Cô');
    expect(prompt).toContain('Chợ Phước Hải');
    expect(prompt).toContain('https://a.vn/1');
    expect(prompt).toMatch(/không lặp lại/i);
    expect(result.places.map((p) => p.title)).toEqual(['Hồ Cốc']);
    expect(result.sources.map((s) => s.uri)).toEqual(['https://a.vn/1', 'https://b.vn/2']);
  });

  it('giữ tối đa 40 địa điểm', async () => {
    const agent = vi.fn(async () => ({ places: Array.from({ length: 50 }, (_, i) => place(`Nơi ${i}`)), sources: [] }));
    expect((await findMorePlacesFromWeb('X', [], [], { agent })).places).toHaveLength(40);
  });
});
```

Run: `cd apps/backend && npx vitest run src/langchain/place-search.service.spec.ts`
Expected: FAIL — `findMorePlacesFromWeb` chưa có.

- [ ] **Step 2: Viết `findMorePlacesFromWeb` và `findMorePlaces`**

Trong `place-search.service.ts`:

```ts
/**
 * Lượt 2 (spec 2026-10-21-ward-search §3): lượt 1 lưu được quá ít địa điểm thì agent tìm thêm
 * bằng truy vấn khác, biết sẵn các bài đã đọc và các tên đã có để không lặp lại.
 */
export async function findMorePlacesFromWeb(
  regionName: string,
  known: string[],
  sources: WebSource[],
  { agent }: Pick<PlaceSearchDeps, 'agent'>,
): Promise<{ places: WebPlacesType; sources: WebSource[] }> {
  const request =
    `Khu vực: ${regionName}, Việt Nam. Danh sách hiện mới có ${known.length} địa điểm, cần thêm.\n` +
    `Đã có (không lặp lại các nơi này): ${known.length ? known.join('; ') : '(chưa có)'}.\n` +
    'Tìm thêm địa điểm khác có tên riêng, nằm trong đúng khu vực này: bãi biển, thác, chùa, đền, chợ, ' +
    'nhà hàng hải sản, quán ăn địa phương, cà phê, homestay, resort, điểm vui chơi. Thử cả tên gọi khác ' +
    'của khu vực và tên tỉnh cũ trước sáp nhập.\n\n' +
    `Các bài viết đã đọc:\n\n${sources.length > 0 ? formatArticles(sources) : '(chưa có bài nào)'}`;
  const found = await agent(request);
  const all = new Map(sources.map((s) => [s.uri, s]));
  for (const s of found.sources) if (!all.has(s.uri)) all.set(s.uri, s);
  logger.log(`"${regionName}": lượt 2 agent thêm ${all.size - sources.length} bài, ${found.places.length} địa điểm`);
  return { places: found.places.slice(0, MAX_PLACES), sources: [...all.values()] };
}
```


Trong `PlaceSearchService` thêm:

```ts
  async findMorePlaces(
    regionName: string,
    known: string[],
    sources: WebSource[],
  ): Promise<{ places: WebPlacesType; sources: WebSource[] }> {
    if (!this.deps) throw new Error('TAVILY_API_KEY chưa được cấu hình');
    return findMorePlacesFromWeb(regionName, known, sources, this.deps);
  }
```

Run: `cd apps/backend && npx vitest run src/langchain/place-search.service.spec.ts`
Expected: PASS.

- [ ] **Step 3: Cấu hình ngưỡng**

`configuration.ts`: `WebPlacesConfig` thêm

```ts
  /** Lượt 1 lưu ít hơn chừng này địa điểm thì chạy lượt 2 (spec 2026-10-21-ward-search §3). */
  minCount: number;
```

và trong `loadConfig` → `webPlaces`: `minCount: positiveInt('WEB_PLACES_MIN_COUNT', 10),`. `.env.example` dưới `WEB_PLACES_WAIT_MS`:

```
# Lượt 1 lưu ít hơn chừng này địa điểm thì agent tìm thêm một lượt (tối đa 2 lượt).
WEB_PLACES_MIN_COUNT=10
```

- [ ] **Step 4: e2e thất bại**

Trong `test/web-places.e2e-spec.ts`:
- `config` thêm `minCount: 3` (giữ test cũ dễ kiểm soát) và `agent` thêm `findMorePlaces: vi.fn(async () => ({ places: [], sources: [] }))`. Mọi chỗ `agent.findPlaces.mockReset()` thì cũng `agent.findMorePlaces.mockReset().mockResolvedValue({ places: [], sources: [] })`.
- Thêm các test (dùng helper dựng `places`/`sources`/vùng sẵn có trong file; vùng có bbox như các test khác):

```ts
  it('lượt 1 đủ ngưỡng thì không chạy lượt 2', async () => {
    // findPlaces trả 3 địa điểm hợp lệ trong vùng (minCount = 3)
    // → GET /regions/:id/places ready, 3 địa điểm; findMorePlaces không được gọi
  });

  it('lượt 1 thiếu thì chạy lượt 2 với tên đã có; gộp, lượt 1 đứng trước', async () => {
    // findPlaces trả 2 địa điểm hợp lệ; findMorePlaces trả 2 địa điểm mới (có bài nhắc tên, trong vùng)
    // → findMorePlaces được gọi với known = 2 tên lượt 1 và sources lượt 1
    // → danh sách 4 địa điểm, 2 tên lượt 1 ở rank 0–1
  });

  it('lượt 2 trùng tên lượt 1 (khác dấu/hoa thường) thì không nhân đôi', async () => {
    // findPlaces: "Dinh Cô"; findMorePlaces: "DINH CO" + "Hồ Cốc" → danh sách: Dinh Cô, Hồ Cốc
  });

  it('sau 2 lượt vẫn thiếu thì vẫn lưu; 0 địa điểm thì 503 PLACES_UNAVAILABLE', async () => {
    // findPlaces 1 địa điểm, findMorePlaces rỗng → ready, 1 địa điểm
    // vùng khác: cả hai lượt rỗng → 503 PLACES_UNAVAILABLE
  });

  it('làm mới ra ít hơn danh sách cũ và dưới ngưỡng thì giữ danh sách cũ, lùi hạn', async () => {
    // dựng danh sách 3 địa điểm; đặt expires_at về quá khứ bằng SQL;
    // lần làm mới: findPlaces 1 địa điểm, findMorePlaces rỗng
    // → sau khi làm mới (gọi service.refresh(regionId) trực tiếp và await), danh sách vẫn 3 địa điểm
    //   và expires_at đã ở tương lai
  });
```

Viết thân test cụ thể bằng các helper có sẵn trong file (xem các test hiện có ở dòng ~490–600 về cách mock `findPlaces` và gọi API). Mỗi địa điểm giả phải có `location` nằm trong bbox của vùng test và một `WebSource` có `content` nhắc đúng tên.

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/web-places.e2e-spec.ts`
Expected: các test mới FAIL (chưa có lượt 2), test cũ PASS.

- [ ] **Step 5: `RegionPlaceStore.count` và `postpone`**

```ts
  async count(regionId: string): Promise<number> {
    const [row] = (await this.db.query(
      `SELECT count(*)::int AS n FROM region_places WHERE region_id = $1`,
      [regionId],
    )) as Array<{ n: number }>;
    return row?.n ?? 0;
  }

  /** Giữ danh sách hiện có thêm một chu kỳ (làm mới ra kết quả kém hơn). */
  async postpone(regionId: string, refreshDays: number): Promise<void> {
    await this.db.query(
      `UPDATE region_place_lists
          SET status = 'ready', error_code = NULL,
              expires_at = now() + make_interval(days => $2::int)
        WHERE region_id = $1`,
      [regionId, refreshDays],
    );
  }
```

- [ ] **Step 6: Hai lượt trong `WebPlacesService.build`**

Tách phần từ `const grounded = …` tới khi có `inputs` thành method:

```ts
  /** Kiểm chứng tên, ngày đăng, vị trí cho một loạt địa điểm; trả địa điểm hợp lệ và bài được trích. */
  private async collect(
    places: WebPlacesType,
    sources: WebSource[],
    regionName: string,
    bbox: Bbox | null,
    cited: Map<string, ArticleSource>,
  ): Promise<WebPlaceInput[]> {
    // (chuyển nguyên logic hiện có: grounded → cited → fetchPublishedDate → locate → inputs)
  }
```

`cited` truyền vào để gộp bài trích dẫn của cả hai lượt. Rồi trong `build`:

```ts
      const first = await this.agent.findPlaces(regionName);
      const cited = new Map<string, ArticleSource>();
      let inputs = await this.collect(first.places, first.sources, regionName, bbox, cited);
      let rounds = 1;

      if (inputs.length < this.config.minCount) {
        rounds = 2;
        const more = await this.agent.findMorePlaces(
          regionName,
          inputs.map((p) => p.name),
          first.sources,
        );
        const known = new Set(inputs.map((p) => normalizeForMatch(p.name)));
        const extra = await this.collect(
          more.places.filter((p) => !known.has(normalizeForMatch(p.title))),
          more.sources,
          regionName,
          bbox,
          cited,
        );
        for (const p of extra) {
          const key = normalizeForMatch(p.name);
          if (!known.has(key)) {
            known.add(key);
            inputs.push(p);
          }
        }
        inputs = inputs.slice(0, MAX_PLACES_STORED);
      }

      if (inputs.length === 0) throw new Error('Không có địa điểm nào qua kiểm chứng');

      if (inputs.length < this.config.minCount) {
        const previous = await this.store.count(regionId);
        if (previous > inputs.length) {
          await this.store.postpone(regionId, this.config.refreshDays);
          this.logger.warn(
            `"${regionName}": làm mới chỉ được ${inputs.length} địa điểm (< ${this.config.minCount}), giữ ${previous} địa điểm cũ`,
          );
          return;
        }
        this.logger.warn(`"${regionName}": sau ${rounds} lượt chỉ có ${inputs.length} địa điểm (< ${this.config.minCount})`);
      }

      await this.store.replace(regionId, inputs, [...cited.values()].map((a) => ({ ...a })), this.config.refreshDays);
```

- `MAX_PLACES_STORED = 40` khai báo đầu file (cùng giá trị `MAX_PLACES` của langchain, comment trỏ về đó).
- Trường hợp `inputs.length === 0` rơi vào `catch` hiện có → `markFailed(regionId, 'PLACES_UNAVAILABLE')`. Kiểm tra vùng chưa có danh sách trả 503 như trước.
- Log tổng kết cuối giữ như cũ, thêm `rounds`.

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/web-places.e2e-spec.ts`
Expected: toàn bộ PASS.

- [ ] **Step 7: Kiểm tra và commit**

Run: `cd apps/backend && pnpm lint && pnpm typecheck && pnpm test`

```bash
git add apps/backend/src apps/backend/test/web-places.e2e-spec.ts apps/backend/.env.example
git commit -m "feat(backend): run a second search round when a region has fewer than 10 places"
```

---

### Task 3: Dữ liệu xã/phường (script và file seed)

**Files:**
- Create: `apps/backend/src/modules/regions/seed/ward-seed-builder.ts`
- Test: `apps/backend/src/modules/regions/seed/ward-seed-builder.spec.ts`
- Create: `apps/backend/scripts/generate-ward-seed.ts`
- Create (sinh): `apps/backend/src/modules/regions/seed/vietnam-wards.json`

**Interfaces:**
- Produces:
  - `interface WardSeedFile { source: string; version: string; wards: WardSeed[] }`
  - `interface WardSeed { code: string; name: string; fullName: string; provinceKey: string; formerProvinceKey: string | null; center: [number, number] | null; bbox: [number, number, number, number] | null }` (`bbox` = `[south, west, north, east]`, `center` = `[lat, lng]`)
  - `geometryBbox(geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown }): [number, number, number, number]`
  - `pickFormerProvince(center: [number, number], candidates: Array<{ key: string; bbox: Bbox }>): string | null`
  - `buildWardSeed(units: DatasetProvince[], geometryByCode: Map<string, Geometry>, version: string): WardSeedFile` — ném lỗi khi tỉnh không khớp `NEW_PROVINCES`.

Bộ dữ liệu (đã kiểm tra, v5.2.0):
- `json/simplified_json_generated_data_vn_units.json`: mảng 34 tỉnh `{ Code, Name, FullName, CodeName, Wards: [{ Code, Name, FullName, ProvinceCode, … }] }`, tổng 3.321 xã. `CodeName` đổi `_` → `-` khớp đủ 34 khóa trong `NEW_PROVINCES`.
- `json/vn_provinces_wards_geojson.zip`: `geojson/<code>_<codename>/wards/<wardCode>_<name>.geojson`, mỗi file `FeatureCollection` một feature `MultiPolygon`, `properties.code` là mã xã. Ví dụ `79_ho_chi_minh/wards/26686_phuoc_hai.geojson`.

- [ ] **Step 1: Test thất bại**

```ts
// apps/backend/src/modules/regions/seed/ward-seed-builder.spec.ts
import { describe, expect, it } from 'vitest';

import { buildWardSeed, geometryBbox, pickFormerProvince } from './ward-seed-builder.js';

describe('geometryBbox', () => {
  it('Polygon và MultiPolygon (chỉ vòng ngoài), làm tròn 5 chữ số', () => {
    expect(
      geometryBbox({ type: 'Polygon', coordinates: [[[107.1, 10.2], [107.3, 10.4], [107.2, 10.123456]]] }),
    ).toEqual([10.12346, 107.1, 10.4, 107.3]);
    expect(
      geometryBbox({
        type: 'MultiPolygon',
        coordinates: [[[[1, 2], [3, 4]]], [[[5, 0], [0, 6]]]],
      }),
    ).toEqual([0, 0, 6, 5]);
  });
});

describe('pickFormerProvince', () => {
  it('chọn khung nhỏ nhất chứa tâm; không khung nào chứa thì null', () => {
    const big = { key: 'lon', bbox: [10, 106, 12, 108] as [number, number, number, number] };
    const small = { key: 'nho', bbox: [10.3, 107.3, 10.6, 107.7] as [number, number, number, number] };
    expect(pickFormerProvince([10.4, 107.5], [big, small])).toBe('nho');
    expect(pickFormerProvince([11.5, 106.5], [big, small])).toBe('lon');
    expect(pickFormerProvince([20, 100], [big, small])).toBeNull();
  });
});

describe('buildWardSeed', () => {
  const units = [
    {
      Code: '79',
      CodeName: 'ho_chi_minh',
      Wards: [
        { Code: '26686', Name: 'Phước Hải', FullName: 'Xã Phước Hải', ProvinceCode: '79' },
        { Code: '99999', Name: 'Không Hình', FullName: 'Phường Không Hình', ProvinceCode: '79' },
      ],
    },
  ];
  const geo = new Map([
    ['26686', { type: 'Polygon' as const, coordinates: [[[107.47, 10.39], [107.58, 10.47]]] }],
  ]);

  it('dựng xã với tỉnh mới, tỉnh cũ theo khung bao, tâm và khung; thiếu hình học thì null', () => {
    const file = buildWardSeed(units, geo, 'v5.2.0');
    expect(file.version).toBe('v5.2.0');
    expect(file.wards[0]).toEqual({
      code: '26686',
      name: 'Phước Hải',
      fullName: 'Xã Phước Hải',
      provinceKey: 'ho-chi-minh',
      formerProvinceKey: 'ba-ria-vung-tau',
      center: [10.43, 107.525],
      bbox: [10.39, 107.47, 10.47, 107.58],
    });
    expect(file.wards[1]).toMatchObject({ code: '99999', center: null, bbox: null, formerProvinceKey: null });
  });

  it('tỉnh không khớp NEW_PROVINCES thì ném lỗi', () => {
    expect(() => buildWardSeed([{ ...units[0], CodeName: 'khong_co' }], geo, 'v')).toThrow(/khong-co/);
  });
});
```

Run: `cd apps/backend && npx vitest run src/modules/regions/seed/ward-seed-builder.spec.ts`
Expected: FAIL — module chưa có.

- [ ] **Step 2: Viết `ward-seed-builder.ts`**

```ts
// apps/backend/src/modules/regions/seed/ward-seed-builder.ts
import type { Bbox } from '../bbox.js';
import { PROVINCE_BBOXES } from './province-bboxes.js';
import { NEW_PROVINCES } from './vietnam-admin.js';

/** Xã/phường sau 1/7/2025 (spec 2026-10-21-ward-search §1). */
export interface WardSeed {
  code: string;
  name: string;
  fullName: string;
  provinceKey: string;
  formerProvinceKey: string | null;
  /** [vĩ độ, kinh độ] */
  center: [number, number] | null;
  /** [nam, tây, bắc, đông] */
  bbox: Bbox | null;
}

export interface WardSeedFile {
  source: string;
  version: string;
  wards: WardSeed[];
}

export interface DatasetProvince {
  Code: string;
  CodeName: string;
  Wards: Array<{ Code: string; Name: string; FullName: string; ProvinceCode: string }>;
}

export type Geometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

const round = (n: number) => Math.round(n * 1e5) / 1e5;

/** Khung bao từ các vòng ngoài của Polygon/MultiPolygon (GeoJSON: [kinh độ, vĩ độ]). */
export function geometryBbox(geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown }): Bbox {
  const rings =
    geometry.type === 'Polygon'
      ? [(geometry.coordinates as number[][][])[0]]
      : (geometry.coordinates as number[][][][]).map((poly) => poly[0]);
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      south = Math.min(south, lat);
      north = Math.max(north, lat);
      west = Math.min(west, lng);
      east = Math.max(east, lng);
    }
  }
  return [round(south), round(west), round(north), round(east)];
}

/** Tỉnh cũ có khung bao chứa tâm xã; nhiều tỉnh chứa thì lấy khung nhỏ nhất. */
export function pickFormerProvince(
  [lat, lng]: [number, number],
  candidates: Array<{ key: string; bbox: Bbox }>,
): string | null {
  const area = ([s, w, n, e]: Bbox) => (n - s) * (e - w);
  const containing = candidates.filter(
    ({ bbox: [s, w, n, e] }) => lat >= s && lat <= n && lng >= w && lng <= e,
  );
  containing.sort((a, b) => area(a.bbox) - area(b.bbox));
  return containing[0]?.key ?? null;
}

export function buildWardSeed(
  units: DatasetProvince[],
  geometryByCode: Map<string, Geometry>,
  version: string,
): WardSeedFile {
  const wards: WardSeed[] = [];
  for (const province of units) {
    const key = province.CodeName.replace(/_/g, '-');
    const target = NEW_PROVINCES.find((p) => p.key === key);
    if (!target) throw new Error(`Tỉnh "${key}" (mã ${province.Code}) không có trong NEW_PROVINCES`);
    const formerCandidates = target.mergedFrom
      .filter((k) => PROVINCE_BBOXES[k])
      .map((k) => ({ key: k, bbox: PROVINCE_BBOXES[k] }));

    for (const ward of province.Wards) {
      const geometry = geometryByCode.get(ward.Code);
      const bbox = geometry ? geometryBbox(geometry) : null;
      const center: [number, number] | null = bbox
        ? [round((bbox[0] + bbox[2]) / 2), round((bbox[1] + bbox[3]) / 2)]
        : null;
      wards.push({
        code: ward.Code,
        name: ward.Name,
        fullName: ward.FullName,
        provinceKey: key,
        formerProvinceKey: center ? pickFormerProvince(center, formerCandidates) : null,
        center,
        bbox,
      });
    }
  }
  return {
    source: `thanglequoc/vietnamese-provinces-database ${version} (MIT)`,
    version,
    wards,
  };
}
```

Run: `cd apps/backend && npx vitest run src/modules/regions/seed/ward-seed-builder.spec.ts`
Expected: PASS. (Kỳ vọng `formerProvinceKey: 'ba-ria-vung-tau'` trong test dựa trên `PROVINCE_BBOXES` thật; nếu tâm thử nằm trong khung của nhiều tỉnh cũ của TP.HCM, khung nhỏ nhất phải là Bà Rịa - Vũng Tàu. Nếu không, đọc lại `PROVINCE_BBOXES` rồi đổi tọa độ thử cho nằm rõ trong Vũng Tàu, không đổi thuật toán.)

- [ ] **Step 3: Script**

```ts
// apps/backend/scripts/generate-ward-seed.ts
/**
 * Sinh `src/modules/regions/seed/vietnam-wards.json`: 3.321 xã/phường sau 1/7/2025 kèm khung bao,
 * từ bộ dữ liệu MIT thanglequoc/vietnamese-provinces-database. Chạy lại khi địa giới đổi.
 *
 *   V=v5.2.0
 *   curl -L -o /tmp/units.json "https://raw.githubusercontent.com/thanglequoc/vietnamese-provinces-database/$V/json/simplified_json_generated_data_vn_units.json"
 *   curl -L -o /tmp/geo.zip "https://raw.githubusercontent.com/thanglequoc/vietnamese-provinces-database/$V/json/vn_provinces_wards_geojson.zip"
 *   unzip -q /tmp/geo.zip -d /tmp/geo
 *   cd apps/backend && npx tsx scripts/generate-ward-seed.ts /tmp/units.json /tmp/geo/geojson $V
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildWardSeed,
  type DatasetProvince,
  type Geometry,
} from '../src/modules/regions/seed/ward-seed-builder.js';

const [unitsPath, geoDir, version] = process.argv.slice(2);
if (!unitsPath || !geoDir || !version) {
  console.error('Dùng: npx tsx scripts/generate-ward-seed.ts <units.json> <thư mục geojson> <phiên bản>');
  process.exit(1);
}

const units = JSON.parse(readFileSync(unitsPath, 'utf8')) as DatasetProvince[];
const geometryByCode = new Map<string, Geometry>();
for (const province of readdirSync(geoDir)) {
  let files: string[] = [];
  try {
    files = readdirSync(join(geoDir, province, 'wards'));
  } catch {
    continue;
  }
  for (const file of files.filter((f) => f.endsWith('.geojson'))) {
    const doc = JSON.parse(readFileSync(join(geoDir, province, 'wards', file), 'utf8')) as {
      features: Array<{ properties: { code: string }; geometry: Geometry }>;
    };
    for (const f of doc.features) geometryByCode.set(f.properties.code, f.geometry);
  }
}

const seed = buildWardSeed(units, geometryByCode, version);
const missing = seed.wards.filter((w) => w.bbox === null);
writeFileSync(
  new URL('../src/modules/regions/seed/vietnam-wards.json', import.meta.url),
  `${JSON.stringify(seed)}\n`,
);
console.log(`Đã ghi ${seed.wards.length} xã (kỳ vọng 3321); thiếu ranh giới: ${missing.length}`);
for (const w of missing) console.log(`  - ${w.fullName} (${w.code}, ${w.provinceKey})`);
```

- [ ] **Step 4: Chạy script, kiểm tra file**

Tải dữ liệu theo comment đầu script (dùng thư mục tạm trong `$TEMP` trên Windows), rồi chạy.
Expected: `Đã ghi 3321 xã (kỳ vọng 3321); thiếu ranh giới: 0` (hoặc liệt kê vài xã thiếu).

Kiểm tra nhanh:

```bash
cd apps/backend && node -e "const f=require('./src/modules/regions/seed/vietnam-wards.json'); const w=f.wards.find(x=>x.code==='26686'); console.log(f.version, f.wards.length, JSON.stringify(w))"
```

Expected: `v5.2.0 3321` và Phước Hải có `provinceKey: 'ho-chi-minh'`, `formerProvinceKey: 'ba-ria-vung-tau'`, bbox quanh (10.4, 107.5). Kích thước file khoảng 0,4–0,6 MB.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/scripts/generate-ward-seed.ts apps/backend/src/modules/regions/seed/ward-seed-builder.ts apps/backend/src/modules/regions/seed/ward-seed-builder.spec.ts apps/backend/src/modules/regions/seed/vietnam-wards.json
git commit -m "feat(backend): generate the 3,321 post-merger wards with bounding boxes"
```

---

### Task 4: Seed xã/phường và tìm kiếm

**Files:**
- Modify: `apps/backend/src/modules/regions/entities/region.entity.ts` (`AreaSource.dataset`)
- Modify: `apps/backend/src/modules/regions/region-seeder.ts`
- Test: `apps/backend/test/region-search.e2e-spec.ts`

**Interfaces:**
- Consumes: `vietnam-wards.json` (`WardSeedFile`), `NEW_PROVINCES`/`OLD_PROVINCES` keys (`vn:province:<key>:current|pre_merger`).
- Produces: dòng `regions` `vn:ward:<code>` với `area_source = { dataset: version }`; bí danh tên ngắn trong `region_aliases`.

- [ ] **Step 1: e2e thất bại**

Thêm vào `test/region-search.e2e-spec.ts` (theo cách gọi API và kiểu kết quả các test hiện có dùng; `OpenDataService.searchPlaces` đã bị spy trả `[]`):

```ts
  describe('xã/phường sau sáp nhập', () => {
    const search = (q: string) =>
      request(app.getHttpServer()).get('/api/regions/search').query({ q }).expect(200);

    it.each(['phuoc hai', 'Phước Hải', 'xa phuoc hai', 'Xã Phước Hải'])(
      '"%s" ra Xã Phước Hải thuộc TP.HCM ở đầu, không gọi Nominatim',
      async (q) => {
        const spy = vi.spyOn(app.get(OpenDataService), 'searchPlaces');
        spy.mockClear();
        const res = await search(q);
        const top = res.body[0];
        expect(top.name ?? top.region?.name).toBe('Xã Phước Hải');
        expect(JSON.stringify(top)).toContain('Hồ Chí Minh');
        expect(spy).not.toHaveBeenCalled();
      },
    );

    it('"long hai" ra Xã Long Hải', async () => {
      const res = await search('long hai');
      expect(JSON.stringify(res.body[0])).toContain('Long Hải');
    });

    it('"vung tau": điểm đến Vũng Tàu đứng trước Phường Vũng Tàu', async () => {
      const names = (await search('vung tau')).body.map((r: { name?: string; region?: { name: string } }) => r.name ?? r.region?.name);
      expect(names.indexOf('Vũng Tàu')).toBeLessThan(names.findIndex((n: string) => /^Phường Vũng Tàu/.test(n)));
    });

    it('xã trùng tên ở hai tỉnh đều xuất hiện, mỗi kết quả kèm tỉnh', async () => {
      const [row] = (await db.query(
        `SELECT search_name FROM regions WHERE source_key LIKE 'vn:ward:%'
          GROUP BY search_name HAVING count(DISTINCT parent_id) > 1 LIMIT 1`,
      )) as Array<{ search_name: string }>;
      const res = await search(row.search_name);
      const hits = res.body.filter((r: unknown) => JSON.stringify(r).toLowerCase().includes(row.search_name.split(' ').slice(1).join(' ')));
      expect(hits.length).toBeGreaterThanOrEqual(2);
    });

    it('seed có đủ 3.321 xã; seed lần hai bỏ qua', async () => {
      const [{ n }] = (await db.query(
        `SELECT count(*)::int AS n FROM regions WHERE source_key LIKE 'vn:ward:%'`,
      )) as Array<{ n: number }>;
      expect(n).toBe(3321);
      const seeder = app.get(RegionSeeder);
      const log = vi.spyOn(seeder['logger'], 'log');
      await seeder.onApplicationBootstrap();
      expect(log.mock.calls.some(([m]) => String(m).includes('bỏ qua seed xã'))).toBe(true);
    });
  });
```

(Đọc kiểu `RegionSearchResult` trong `packages/shared-types/src/region.ts` và sửa cách lấy tên/tỉnh trong test cho đúng trường thật; giữ nguyên ý kiểm tra. Import `RegionSeeder`, `OpenDataService`, `vi` như các test khác.)

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/region-search.e2e-spec.ts`
Expected: các test mới FAIL.

- [ ] **Step 2: `AreaSource.dataset`**

Trong `region.entity.ts`, `AreaSource` thêm:

```ts
  /** Xã/phường: phiên bản bộ dữ liệu đã seed (vietnam-wards.json). */
  dataset?: string;
```

- [ ] **Step 3: Seed xã trong `RegionSeeder`**

Import `wardsFile` (`import wardsFile from './seed/vietnam-wards.json' with { type: 'json' };` — nếu tsconfig/ESM không cho import JSON, đọc bằng `readFileSync(new URL('./seed/vietnam-wards.json', import.meta.url))` và kiểm tra file được copy vào `dist` khi build; nếu không, thêm vào cấu hình `assets` của Nest CLI hoặc dùng đường dẫn tới `src`). Cuối `onApplicationBootstrap`, gọi `await this.seedWards(id)` (truyền hàm `id` đang có) và thêm:

```ts
  /** 3.321 xã/phường (spec 2026-10-21-ward-search §1.2). Bỏ qua khi đã seed đúng phiên bản. */
  private async seedWards(id: (key: string) => string | null): Promise<void> {
    const { version, wards } = wardsFile as WardSeedFile;
    const [state] = (await this.regions.query(
      `SELECT count(*) FILTER (WHERE area_source->>'dataset' = $1)::int AS current
         FROM regions WHERE source_key LIKE 'vn:ward:%'`,
      [version],
    )) as Array<{ current: number }>;
    if (state.current === wards.length) {
      this.logger.log(`Xã/phường ${version} đã có (${wards.length}), bỏ qua seed xã.`);
      return;
    }

    const rows = wards.map((w) => ({
      source_key: `vn:ward:${w.code}`,
      name: w.fullName,
      search_name: searchKey(w.fullName),
      parent_id: id(newKey(w.provinceKey)),
      former_parent_id: w.formerProvinceKey ? id(oldKey(w.formerProvinceKey)) : null,
      lat: w.center?.[0] ?? null,
      lng: w.center?.[1] ?? null,
      south: w.bbox?.[0] ?? null,
      west: w.bbox?.[1] ?? null,
      north: w.bbox?.[2] ?? null,
      east: w.bbox?.[3] ?? null,
    }));
    await this.regions.query(
      `INSERT INTO regions (source_key, name, type, boundary_version, level, parent_id, former_parent_id,
                            search_name, center, bbox_south, bbox_west, bbox_north, bbox_east, area_source)
       SELECT w.source_key, w.name, 'administrative', 'current', 'ward', w.parent_id, w.former_parent_id,
              w.search_name,
              CASE WHEN w.lat IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(w.lng, w.lat), 4326) END,
              w.south, w.west, w.north, w.east, jsonb_build_object('dataset', $2::text)
         FROM jsonb_to_recordset($1::jsonb) AS w(
              source_key text, name text, search_name text, parent_id uuid, former_parent_id uuid,
              lat float8, lng float8, south float8, west float8, north float8, east float8)
       ON CONFLICT (source_key) DO UPDATE SET
              name = EXCLUDED.name, search_name = EXCLUDED.search_name,
              parent_id = EXCLUDED.parent_id, former_parent_id = EXCLUDED.former_parent_id,
              center = EXCLUDED.center, bbox_south = EXCLUDED.bbox_south, bbox_west = EXCLUDED.bbox_west,
              bbox_north = EXCLUDED.bbox_north, bbox_east = EXCLUDED.bbox_east,
              area_source = EXCLUDED.area_source`,
      [JSON.stringify(rows), version],
    );
    await this.regions.query(
      `INSERT INTO region_aliases (region_id, alias, search_alias)
       SELECT r.id, a.alias, a.search_alias
         FROM jsonb_to_recordset($1::jsonb) AS a(source_key text, alias text, search_alias text)
         JOIN regions r ON r.source_key = a.source_key
       ON CONFLICT ON CONSTRAINT uq_region_alias DO NOTHING`,
      [JSON.stringify(wards.map((w) => ({
        source_key: `vn:ward:${w.code}`,
        alias: w.name,
        search_alias: searchKey(w.name),
      })))],
    );
    this.logger.log(`Đã seed ${wards.length} xã/phường (${version}).`);
  }
```

- Kiểm tra tên cột thật của `region_aliases` (`alias`, `search_alias`, `region_id`) trong migration `1758300000000-CreateRegionsAndPlaces.ts` trước khi chạy; sửa câu SQL nếu khác.
- Cột `center` có thể là `geography`/`geometry` tùy migration; dùng cùng biểu thức như `importFromNominatim` (`ST_SetSRID(ST_MakePoint(lng, lat), 4326)`).

- [ ] **Step 4: Chạy e2e**

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/region-search.e2e-spec.ts`
Expected: toàn bộ PASS (lần chạy đầu seed 3.321 xã vào database dev). Nếu "phuoc hai" chưa đứng đầu, kiểm tra điểm khớp bí danh (1,0 − 0,02) và `GROUP_RANK` trong `region-search-arrange.ts`; sửa xếp hạng tối thiểu, ghi ledger.

- [ ] **Step 5: Kiểm tra và commit**

Run: `cd apps/backend && pnpm lint && pnpm typecheck && pnpm test && npx vitest run --config vitest.config.e2e.ts test/region-search.e2e-spec.ts test/web-places.e2e-spec.ts`

```bash
git add apps/backend/src/modules/regions apps/backend/test/region-search.e2e-spec.ts
git commit -m "feat(backend): seed every post-merger ward so search finds them without Nominatim"
```

---

### Task 5: Nominatim không dấu, không nhập xã; tên xã cho pipeline

**Files:**
- Modify: `apps/backend/src/modules/regions/search-text.ts` (+ `search-text.spec.ts`)
- Modify: `apps/backend/src/modules/regions/regions.service.ts` (`search`, `importFromNominatim`)
- Modify: `apps/backend/src/modules/places/web-places.service.ts` (`regionName`)
- Test: `apps/backend/test/region-search.e2e-spec.ts`, `apps/backend/test/web-places.e2e-spec.ts`
- Modify: `apps/backend/src/modules/README.md`, `CLAUDE.md`

**Interfaces:**
- Produces: `stripWardPrefix(name: string): string`; `nominatimQueries(query: string): string[]`.

- [ ] **Step 1: Unit test thất bại**

Thêm vào `search-text.spec.ts`:

```ts
describe('stripWardPrefix', () => {
  it('bỏ xã/phường/thị trấn/đặc khu ở đầu, giữ nguyên dấu', () => {
    expect(stripWardPrefix('Xã Phước Hải')).toBe('Phước Hải');
    expect(stripWardPrefix('phường Vũng Tàu')).toBe('Vũng Tàu');
    expect(stripWardPrefix('Thị trấn Long Hải')).toBe('Long Hải');
    expect(stripWardPrefix('Đặc khu Côn Đảo')).toBe('Côn Đảo');
    expect(stripWardPrefix('Hồ Tràm')).toBe('Hồ Tràm');
  });
});

describe('nominatimQueries', () => {
  it('câu gốc rồi bản không dấu đã bỏ tiền tố; không trùng', () => {
    expect(nominatimQueries('Xã Phước Hải')).toEqual(['Xã Phước Hải', 'Phuoc Hai']);
    expect(nominatimQueries('Hồ Tràm')).toEqual(['Hồ Tràm', 'Ho Tram']);
    expect(nominatimQueries('phuoc hai')).toEqual(['phuoc hai']);
  });
});
```

Run: `cd apps/backend && npx vitest run src/modules/regions/search-text.spec.ts`
Expected: FAIL.

- [ ] **Step 2: Viết hai hàm**

Trong `search-text.ts` (dùng hàm bỏ dấu sẵn có trong file, ví dụ `foldText`, nhưng giữ hoa/thường kiểu Title Case cho bản không dấu bằng cách bỏ dấu từng ký tự mà không hạ chữ):

```ts
const WARD_PREFIX = /^(xã|phường|thị trấn|đặc khu)\s+/iu;

/** "Xã Phước Hải" → "Phước Hải". */
export function stripWardPrefix(name: string): string {
  return name.trim().replace(WARD_PREFIX, '').trim();
}

/** Bỏ dấu tiếng Việt, giữ hoa/thường. */
function removeDiacritics(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

/**
 * Các câu gửi Nominatim, thử lần lượt: câu gốc, rồi bản không dấu đã bỏ tiền tố. Nominatim tìm chữ Việt
 * có dấu kém ("Phước Hải" ra cây xăng, "Phuoc Hai" ra đúng xã).
 */
export function nominatimQueries(query: string): string[] {
  const original = query.trim();
  const folded = removeDiacritics(stripWardPrefix(original));
  return [...new Set([original, folded])];
}
```

Run: `cd apps/backend && npx vitest run src/modules/regions/search-text.spec.ts`
Expected: PASS.

- [ ] **Step 3: e2e thất bại cho Nominatim**

Thêm vào `region-search.e2e-spec.ts`:

```ts
  it('Nominatim: câu có dấu không ra gì thì thử bản không dấu; kết quả là xã thì không nhập', async () => {
    const spy = vi.spyOn(app.get(OpenDataService), 'searchPlaces');
    spy.mockReset();
    spy.mockImplementation(async (q: string) =>
      q === 'Bai Kem Thu Nghiem'
        ? [
            nominatimResult({ name: 'Bãi Kem Thử Nghiệm', addresstype: 'village' }),
            nominatimResult({ name: 'Xã Thử Nghiệm Mới', addresstype: 'town' }),
          ]
        : [],
    );
    const res = await request(app.getHttpServer())
      .get('/api/regions/search')
      .query({ q: 'Bãi Kem Thử Nghiệm', online: 1 })
      .expect(200);
    expect(spy.mock.calls.map(([q]) => q)).toEqual(['Bãi Kem Thử Nghiệm', 'Bai Kem Thu Nghiem']);
    expect(JSON.stringify(res.body)).toContain('Bãi Kem Thử Nghiệm');
    const [{ n }] = (await db.query(
      `SELECT count(*)::int AS n FROM regions WHERE name = 'Xã Thử Nghiệm Mới'`,
    )) as Array<{ n: number }>;
    expect(n).toBe(0);
  });
```

`nominatimResult` là helper trong test: dựng `NominatimResult` đủ trường mà `importFromNominatim` đọc (`category: 'place'` hoặc `'boundary'`, `addresstype`, `osm_type`, `osm_id` duy nhất, `lat`, `lon`, `boundingbox`, `address: { state: 'Thành phố Hồ Chí Minh' }`). Xem kiểu `NominatimResult` trong `open-data.types.ts`. Dọn dữ liệu thử trong `afterAll` theo `source_key LIKE 'osm:%'` của các `osm_id` thử.

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/region-search.e2e-spec.ts`
Expected: FAIL (chỉ gọi 1 câu, và nhập cả xã).

- [ ] **Step 4: Sửa `RegionsService`**

`importFromNominatim(query)`:

```ts
  private async importFromNominatim(query: string): Promise<number> {
    let results: NominatimResult[] = [];
    for (const q of nominatimQueries(query)) {
      results = (await this.openData.searchPlaces(q)).filter(
        (r) =>
          ['boundary', 'place'].includes(r.category) &&
          r.addresstype in ACCEPTED_ADDRESS_TYPES &&
          // Xã/phường đã có đủ trong seed (vietnam-wards.json): nhập từ OSM chỉ sinh dòng trùng.
          !isWardName(r.name ?? ''),
      );
      if (results.length > 0) break;
    }
    // (phần lưu giữ nguyên, bỏ nhánh `ward ? 'administrative' : 'destination'`: mọi kết quả còn lại là 'destination', level null)
```

Sửa câu INSERT: `type` luôn `'destination'`, `level` luôn `null` (bỏ biến `ward`). Giữ `parent`, bbox như cũ.

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/region-search.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 5: Tên xã cho pipeline — e2e thất bại**

Trong `web-places.e2e-spec.ts`:

```ts
  it('vùng là xã: pipeline nhận "<tên ngắn>, <tỉnh cũ>"', async () => {
    const [ward] = (await db.query(
      `SELECT id FROM regions WHERE source_key = 'vn:ward:26686'`,
    )) as Array<{ id: string }>;
    agent.findPlaces.mockResolvedValue({ places: [], sources: [] });
    await request(app.getHttpServer()).get(`/api/regions/${ward.id}/places`).set(auth());
    expect(agent.findPlaces).toHaveBeenCalledWith('Phước Hải, Bà Rịa - Vũng Tàu');
  });
```

(`auth()` là cách các test trong file gửi token; dùng đúng helper sẵn có. Dọn `region_place_lists` của xã này trong `afterAll`.)

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/web-places.e2e-spec.ts -t "vùng là xã"`
Expected: FAIL (hiện gọi với "Xã Phước Hải, TP. Hồ Chí Minh").

- [ ] **Step 6: Sửa `WebPlacesService.regionName`**

```ts
  private async regionName(regionId: string): Promise<string> {
    const [row] = (await this.db.query(
      `SELECT r.name, r.level, p.name AS parent_name, fp.name AS former_parent_name
         FROM regions r
         LEFT JOIN regions p ON p.id = r.parent_id
         LEFT JOIN regions fp ON fp.id = r.former_parent_id
        WHERE r.id = $1`,
      [regionId],
    )) as Array<{ name: string; level: string | null; parent_name: string | null; former_parent_name: string | null }>;
    if (!row) { /* giữ nguyên NotFoundException */ }
    if (row.level === 'ward') {
      // Bài viết du lịch phần lớn dùng tên trước sáp nhập: "Phước Hải, Bà Rịa - Vũng Tàu".
      const province = row.former_parent_name ?? row.parent_name;
      const short = stripWardPrefix(row.name);
      return province ? `${short}, ${province}` : short;
    }
    return row.parent_name ? `${row.name}, ${row.parent_name}` : row.name;
  }
```

Import `stripWardPrefix` từ `../regions/search-text.js`.

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/web-places.e2e-spec.ts`
Expected: toàn bộ PASS.

- [ ] **Step 7: Tài liệu**

- `apps/backend/src/modules/README.md`, mục "Tìm điểm đến không dùng AI (S2)":
  - 3.321 xã/phường seed từ `vietnam-wards.json` (thanglequoc v5.2.0, MIT; sinh bằng `scripts/generate-ward-seed.ts`); tên ngắn là bí danh.
  - Nominatim thử câu gốc rồi bản không dấu, không nhập xã/phường.
  - Pipeline gọi xã bằng "tên ngắn, tỉnh cũ"; ngưỡng `WEB_PLACES_MIN_COUNT` và lượt 2; rút gọn bài theo cấu trúc (`langchain/article-condense.ts`).
- `CLAUDE.md`, mục "Places: one list per region": nối câu về lượt 2 (`WEB_PLACES_MIN_COUNT`, tối đa 2 lượt, giữ danh sách cũ nếu làm mới kém hơn) và rút gọn bài. Mục "Regions": thêm "and all 3,321 wards from `regions/seed/vietnam-wards.json` (generated once by `scripts/generate-ward-seed.ts` from thanglequoc/vietnamese-provinces-database, MIT)".

- [ ] **Step 8: Kiểm tra toàn bộ và commit**

Run: `cd apps/backend && pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`
Expected: sạch; toàn bộ e2e PASS.

```bash
git add apps/backend CLAUDE.md
git commit -m "feat(backend): retry Nominatim without diacritics, skip ward imports, name wards by their former province"
```

---

## Sau khi xong

- Deploy backend. Lần khởi động đầu seed 3.321 xã, mất vài giây.
- Thử thật: tìm "Phước Hải", "Long Hải" trên app; mở hai xã này, kiểm tra danh sách ≥ 10 địa điểm và đúng khu vực Vũng Tàu cũ.
- So sánh bằng `pnpm bench:places` (có phí) trên vài vùng trước và sau, đọc log "rút gọn … ký tự, … tiêu đề".
