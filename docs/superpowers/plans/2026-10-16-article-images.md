# Ảnh địa điểm từ bài viết — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mỗi địa điểm trong danh sách của vùng có ảnh lấy từ bài viết nguồn (khi có), hiện ở danh sách và đầu màn chi tiết kèm ghi nguồn.

**Architecture:** `searchWeb` tách ảnh `![alt](url)` (kèm tiêu đề mục) khỏi markdown Tavily trước khi cắt bài. `groundedImage` gán ảnh cho địa điểm bằng so khớp tên (alt trước, tiêu đề mục sau) trong các bài đã nhắc địa điểm. Ảnh lưu ở `region_places.image` (jsonb, cạnh `articles`), API trả `image: PlaceImage | null`, mobile hiện bằng `expo-image` và quay về icon khi lỗi.

**Tech Stack:** NestJS 12 + TypeORM raw SQL + PostGIS, vitest (unit + e2e), Expo / React Native, `expo-image`, pnpm monorepo (`@rong/shared-types` dùng từ `dist/`).

**Spec:** `docs/superpowers/specs/2026-10-16-article-images-design.md`

## Global Constraints

- ESM backend: import tương đối phải có đuôi `.js` (`'./web-grounding.js'`).
- Comment, log, chuỗi hiển thị bằng tiếng Việt, theo giọng code xung quanh.
- Sau khi sửa `packages/shared-types`, build lại trước khi chạy `tsc`/`vitest` ở backend hay mobile: `cd packages/shared-types && npx tsc -p .`.
- Gọi `npx tsc` / `npx vitest` / `npx nest build` / `npx typeorm` trực tiếp, **không** gọi script `pnpm` (có thể treo vì tự `pnpm install`).
- DB của e2e là Neon dev/test (`apps/backend/.env`). **Hỏi người dùng trước khi chạy `migration:run`.**
- Không commit file `apps/backend/src/modules/google/google-places.service.ts` (người dùng đang có `console.log` riêng chưa commit). Luôn `git add` từng file.
- Backend format bằng prettier: chạy `npx prettier --end-of-line auto --write <file>` cho file backend đã sửa (repo dùng CRLF khi checkout). Mobile không có cấu hình prettier: giữ style của file.
- Mỗi bài giữ tối đa `MAX_IMAGES_PER_ARTICLE = 60` ảnh. Biến thể tên dưới 4 ký tự bị bỏ (đã có trong `nameVariants`).
- Chỉ lưu URL ảnh (hotlink), không tải ảnh về server. Dòng `source = 'google'` không có ảnh.
- Commit message kết thúc bằng:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Mtnr88jtXnPHPRZ7esDqRd
  ```

## Review Focus

1. Ảnh có `title` trong ngoặc (`![a](url "t")`) hoặc URL có query (`.jpg?w=800`) vẫn phải được lấy đúng URL — test ở Task 1.
2. Ảnh bọc trong link (`[![alt](img)](https://…)`) ở bài Tavily vẫn được tách, và `content` gửi Gemini không còn cú pháp ảnh — test ở Task 1.
3. Dòng `region_places` cũ (trước migration, `image` NULL) và dòng `web` không thuộc danh sách nào phải trả `image: null`, không lỗi — test ở Task 3 (`GET /places/:id` dòng web tọa độ AI).
4. Một mục chung chung khớp tiêu đề của địa điểm khác: địa điểm có ảnh khớp alt ở bất kỳ bài nào phải thắng ảnh chỉ khớp tiêu đề — test ở Task 2.
5. Ảnh chết / bị chặn hotlink trên mobile: danh sách quay về icon, chi tiết ẩn cả khối ảnh và dòng nguồn — kiểm tra tay ở Task 4 và Task 5 (mobile không có test runner).

---

## File Structure

| File | Trách nhiệm |
| --- | --- |
| `apps/backend/src/langchain/web-search.ts` | Thêm `ArticleImage`, `WebSource.images`, `extractImages`, `stripImages`; `searchWeb` dùng chúng. |
| `apps/backend/src/langchain/web-search.spec.ts` | Test `extractImages`, `searchWeb` với ảnh. |
| `apps/backend/src/modules/places/web-grounding.ts` | Thêm `groundedImage`. |
| `apps/backend/src/modules/places/web-grounding.spec.ts` | Test `groundedImage`. |
| `apps/backend/src/langchain/place-search.service.spec.ts` | Fixture `WebSource` thêm `images: []`. |
| `packages/shared-types/src/place.ts` | `PlaceImage`, `PlaceListItem.image`. |
| `apps/backend/src/database/migrations/1792200000000-AddRegionPlaceImage.ts` | Cột `region_places.image jsonb`. |
| `apps/backend/src/modules/places/region-place-store.ts` | `WebPlaceInput.image`, `StoredPlaceRow.image`, ghi/đọc cột. |
| `apps/backend/src/modules/places/web-places.service.ts` | `build` gán ảnh, log số có ảnh; `toItem` trả `image`. |
| `apps/backend/src/modules/places/places.service.ts` | `getDetail` đọc `articles` + `image` từ cùng dòng `region_places`. |
| `apps/backend/test/web-places.e2e-spec.ts` | e2e lưu trữ, danh sách, chi tiết có ảnh. |
| `apps/backend/src/modules/README.md` | Ghi luồng ảnh. |
| `apps/mobile/src/components/ui/place-row.tsx` | Thumbnail ảnh, quay về icon khi lỗi. |
| `apps/mobile/src/app/(app)/place/[id].tsx` | Ảnh lớn đầu màn + "Ảnh: tên miền". |

---

### Task 1: Tách ảnh khỏi bài viết Tavily

**Files:**
- Modify: `apps/backend/src/langchain/web-search.ts`
- Modify: `apps/backend/src/langchain/place-search.service.spec.ts:9-14` (fixture `source`)
- Test: `apps/backend/src/langchain/web-search.spec.ts`

**Interfaces:**
- Consumes: không.
- Produces:
  ```ts
  export interface ArticleImage { url: string; alt: string; heading: string | null }
  export interface WebSource { title: string; uri: string; content: string; publishedAt: string | null; images: ArticleImage[] }
  export function extractImages(markdown: string): ArticleImage[];
  ```

- [ ] **Step 1: Viết test thất bại cho `extractImages`**

Thêm `extractImages` vào import ở đầu `web-search.spec.ts`:

```ts
import {
  createWebSearchTool,
  extractImages,
  formatArticles,
  searchWeb,
  WEB_SEARCH_TOOL_NAME,
} from './web-search.js';
```

Thêm vào cuối file:

```ts
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
      { url: 'https://cdn.zlp.test/top.jpg', alt: 'Ảnh bìa Đà Lạt', heading: null },
      { url: 'https://cdn.zlp.test/cover.jpg?w=800', alt: 'Đà Lạt mùa hoa', heading: 'Check in Đà Lạt' },
      {
        url: 'https://cdn.zlp.test/1.jpg',
        alt: 'Nhà mục vụ Don Bosco',
        heading: '1. Nhà mục vụ Don Bosco - Địa điểm check in siêu đẹp',
      },
      { url: 'https://cdn.zlp.test/2.jpg', alt: 'Dinh Tỉnh trưởng', heading: '2. Dinh Tỉnh trưởng' },
    ]);
  });

  it('giữ tối đa 60 ảnh mỗi bài', () => {
    const many = Array.from({ length: 70 }, (_, i) => `![Ảnh ${i}](https://cdn.test/${i}.jpg)`).join('\n');
    expect(extractImages(many)).toHaveLength(60);
  });

  it('không có ảnh thì rỗng', () => {
    expect(extractImages('Chỉ có chữ.')).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `cd apps/backend && npx vitest run src/langchain/web-search.spec.ts`
Expected: FAIL — `extractImages` is not exported / not a function.

- [ ] **Step 3: Cài đặt `extractImages`, `stripImages`, thêm `images` vào `WebSource`**

Trong `web-search.ts`, sửa `WebSource` và thêm `ArticleImage` ngay sau nó:

```ts
/** Bài viết mà model đã đọc — trả kèm kết quả để kiểm chứng và hiển thị nguồn. */
export interface WebSource {
  title: string;
  uri: string;
  /** Đúng phần nội dung đã gửi cho model (đã cắt, bỏ ảnh), để đối chiếu địa điểm model trả về. */
  content: string;
  /** Tavily chỉ có ngày đăng với một số trang (chủ yếu tin tức). */
  publishedAt: string | null;
  /** Ảnh trong toàn bộ bài (trước khi cắt). Rỗng khi Tavily không trả `raw_content`. */
  images: ArticleImage[];
}

/** Một ảnh `![alt](url)` trong bài, kèm tiêu đề mục chứa nó để gán cho địa điểm. */
export interface ArticleImage {
  url: string;
  /** Alt text, đã trim. */
  alt: string;
  /** Tiêu đề mục gần nhất phía trên ảnh (dòng `#…` hoặc dòng chỉ gồm `**…**`), null nếu chưa có. */
  heading: string | null;
}
```

Thêm hằng số cạnh `MAX_ARTICLE_CHARS`:

```ts
/** Bài "top N địa điểm" hiếm khi quá 60 ảnh; giới hạn để một trang lạ không phình bộ nhớ. */
const MAX_IMAGES_PER_ARTICLE = 60;
/** `![alt](url)` hoặc `![alt](url "title")`, có thể nằm trong `[…](link)`. */
const IMAGE_MARKDOWN = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
/** Ảnh không phải ảnh chụp địa điểm. */
const NOT_PHOTO = /logo|icon|avatar|banner/i;
```

Trong `searchWeb`, thay khối `return results.map(...)`:

```ts
  return results.map((result) => ({
    title: result.title,
    uri: result.url,
    content: truncate(stripImages(result.raw_content || result.content)),
    publishedAt: result.published_date || null,
    images: result.raw_content ? extractImages(result.raw_content) : [],
  }));
```

Thêm hai hàm cạnh `truncate` (cuối file):

```ts
/**
 * Ảnh trong markdown của bài (đọc cả bài, trước khi cắt), kèm tiêu đề mục gần nhất.
 * Bỏ ảnh không phải http(s), svg/gif, alt rỗng, logo/icon/avatar/banner và ảnh trùng URL.
 */
export function extractImages(markdown: string): ArticleImage[] {
  const images: ArticleImage[] = [];
  const seen = new Set<string>();
  let heading: string | null = null;
  for (const line of markdown.split('\n')) {
    const text = line.trim();
    const title = /^#{1,6}\s+(.+)$/.exec(text) ?? /^\*\*(.+)\*\*$/.exec(text);
    if (title && !text.includes('![')) {
      heading = title[1].replace(/\*\*/g, '').trim();
      continue;
    }
    for (const [, rawAlt, url] of text.matchAll(IMAGE_MARKDOWN)) {
      const alt = rawAlt.trim();
      if (!/^https?:\/\//i.test(url) || /\.(svg|gif)(\?|#|$)/i.test(url)) continue;
      if (!alt || NOT_PHOTO.test(alt) || NOT_PHOTO.test(url) || seen.has(url)) continue;
      seen.add(url);
      images.push({ url, alt, heading });
      if (images.length >= MAX_IMAGES_PER_ARTICLE) return images;
    }
  }
  return images;
}

/** Bỏ cú pháp ảnh khỏi nội dung gửi model: link ảnh dài, model không cần. */
function stripImages(text: string): string {
  return text.replace(IMAGE_MARKDOWN, ' ');
}
```

- [ ] **Step 4: Chạy test `extractImages`, xác nhận qua**

Run: `cd apps/backend && npx vitest run src/langchain/web-search.spec.ts -t extractImages`
Expected: PASS (3 tests).

- [ ] **Step 5: Sửa test `searchWeb` hiện có và thêm test ảnh**

Trong test `'trả nội dung bài viết kèm nguồn'`, mỗi object mong đợi thêm `images: []` (hai object ở khoảng dòng 41–52):

```ts
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
```

Trong `describe('formatArticles', …)` (khoảng dòng 117–134), hai object truyền vào `formatArticles` là `WebSource`: thêm `images: []` vào mỗi object, ngay sau `publishedAt: null,`.

Thêm test mới trong `describe('searchWeb', …)`:

```ts
  it('tách ảnh từ raw_content trước khi cắt, nội dung gửi model không còn cú pháp ảnh', async () => {
    const fetchImpl = json({
      results: [
        {
          title: 'Top check-in',
          url: 'https://c.vn/top',
          content: 'tóm tắt',
          raw_content: '## 1. Dinh Tỉnh trưởng\n![Dinh Tỉnh trưởng](https://c.vn/dinh.jpg)\nDinh nằm trên đồi.',
        },
      ],
    });

    const [source] = await searchWeb('key', 'check-in Đà Lạt', fetchImpl);
    expect(source.images).toEqual([
      { url: 'https://c.vn/dinh.jpg', alt: 'Dinh Tỉnh trưởng', heading: '1. Dinh Tỉnh trưởng' },
    ]);
    expect(source.content).not.toContain('![');
    expect(source.content).toContain('Dinh nằm trên đồi.');
  });
```

- [ ] **Step 6: Sửa fixture ở `place-search.service.spec.ts`**

Hàm `source` ở đầu file (dòng 9–14) thêm `images: []`:

```ts
const source = (uri: string): WebSource => ({
  title: uri,
  uri,
  content: `Bài ${uri}`,
  publishedAt: null,
  images: [],
});
```

- [ ] **Step 7: Typecheck và chạy toàn bộ unit test**

Run: `cd apps/backend && npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: tsc không lỗi. Nếu tsc báo thiếu `images` ở fixture `WebSource` nào khác (ví dụ `web-grounding.spec.ts`), thêm `images: []` vào fixture đó: với `web-grounding.spec.ts`, Task 2 sẽ đổi hàm `source`, ở bước này chỉ cần thêm `images: []` vào object trả về của hàm `source`. Mọi test PASS.

- [ ] **Step 8: Format và commit**

```bash
cd apps/backend
npx prettier --end-of-line auto --write src/langchain/web-search.ts src/langchain/web-search.spec.ts src/langchain/place-search.service.spec.ts src/modules/places/web-grounding.spec.ts
cd ../..
git add apps/backend/src/langchain/web-search.ts apps/backend/src/langchain/web-search.spec.ts apps/backend/src/langchain/place-search.service.spec.ts apps/backend/src/modules/places/web-grounding.spec.ts
git commit -m "feat(backend): extract article images from Tavily markdown before truncating

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mtnr88jtXnPHPRZ7esDqRd"
```

---

### Task 2: Gán ảnh cho địa điểm (`groundedImage`)

**Files:**
- Modify: `packages/shared-types/src/place.ts` (thêm `PlaceImage`)
- Modify: `apps/backend/src/modules/places/web-grounding.ts`
- Test: `apps/backend/src/modules/places/web-grounding.spec.ts`

**Interfaces:**
- Consumes: `WebSource`, `ArticleImage` từ Task 1 (`../../langchain/web-search.js`).
- Produces:
  ```ts
  // packages/shared-types/src/place.ts
  export interface PlaceImage { url: string; sourceUrl: string }
  // web-grounding.ts
  export function groundedImage(title: string, regionName: string, articles: WebSource[]): PlaceImage | null;
  ```

- [ ] **Step 1: Thêm `PlaceImage` vào shared-types và build**

Trong `packages/shared-types/src/place.ts`, ngay trước `/** Bài viết trên web mà kết quả AI dựa vào. */ export interface ArticleSource`:

```ts
/** Ảnh lấy từ bài viết (hotlink, không lưu file), kèm bài nguồn để ghi công. */
export interface PlaceImage {
  url: string;
  /** Bài viết chứa ảnh. */
  sourceUrl: string;
}
```

Run: `cd packages/shared-types && npx tsc -p .`
Expected: không lỗi.

- [ ] **Step 2: Viết test thất bại**

Trong `web-grounding.spec.ts`, sửa import và hàm `source`:

```ts
import type { ArticleImage, WebSource } from '../../langchain/web-search.js';
import {
  articlesMentioning,
  extractPublishedDate,
  fetchPublishedDate,
  groundedAddress,
  groundedImage,
  normalizeForMatch,
} from './web-grounding.js';

const source = (
  uri: string,
  content: string,
  title = 'Bài viết',
  images: ArticleImage[] = [],
): WebSource => ({
  title,
  uri,
  content,
  publishedAt: null,
  images,
});
const img = (url: string, alt: string, heading: string | null = null): ArticleImage => ({ url, alt, heading });
```

Thêm `describe` mới sau `describe('groundedAddress', …)`:

```ts
describe('groundedImage', () => {
  it('khớp theo alt, không phân biệt dấu và hoa thường, trả kèm bài nguồn', () => {
    const articles = [source('https://a.vn', '...', 'Bài', [img('https://a.vn/1.jpg', 'NHÀ MỤC VỤ DON BOSCO')])];
    expect(groundedImage('Nhà mục vụ Don Bosco', 'Đà Lạt', articles)).toEqual({
      url: 'https://a.vn/1.jpg',
      sourceUrl: 'https://a.vn',
    });
  });

  it('khớp theo tiêu đề mục khi alt không có tên', () => {
    const articles = [source('https://a.vn', '...', 'Bài', [img('https://a.vn/2.jpg', 'Ảnh 2', '2. Dinh Tỉnh trưởng - đẹp nhất')])];
    expect(groundedImage('Dinh Tỉnh trưởng', 'Đà Lạt', articles)).toEqual({
      url: 'https://a.vn/2.jpg',
      sourceUrl: 'https://a.vn',
    });
  });

  it('ảnh khớp alt ở bài sau thắng ảnh chỉ khớp tiêu đề ở bài trước', () => {
    const articles = [
      source('https://a.vn', '...', 'Bài A', [img('https://a.vn/chung.jpg', 'Săn mây', 'Săn mây đồi chè Cầu Đất')]),
      source('https://b.vn', '...', 'Bài B', [img('https://b.vn/doi-che.jpg', 'Đồi chè Cầu Đất')]),
    ];
    expect(groundedImage('Đồi chè Cầu Đất', 'Đà Lạt', articles)).toEqual({
      url: 'https://b.vn/doi-che.jpg',
      sourceUrl: 'https://b.vn',
    });
  });

  it('chấp nhận tên kèm tên vùng ở cuối', () => {
    const articles = [source('https://a.vn', '...', 'Bài', [img('https://a.vn/dinh.jpg', 'Dinh Tỉnh trưởng')])];
    expect(groundedImage('Dinh Tỉnh trưởng Đà Lạt', 'Đà Lạt, Lâm Đồng', articles)?.url).toBe('https://a.vn/dinh.jpg');
  });

  it('chỉ khớp nguyên từ', () => {
    const articles = [source('https://a.vn', '...', 'Bài', [img('https://a.vn/x.jpg', 'hồ xuânhương')])];
    expect(groundedImage('Hồ Xuân', 'Đà Lạt', articles)).toBeNull();
  });

  it('không ảnh nào khớp, hoặc bài không có ảnh, thì null', () => {
    expect(groundedImage('Chợ Đà Lạt', 'Lâm Đồng', [source('https://a.vn', '...', 'Bài', [img('https://a.vn/x.jpg', 'Quán khác')])])).toBeNull();
    expect(groundedImage('Chợ Đà Lạt', 'Lâm Đồng', [source('https://a.vn', 'Chợ Đà Lạt')])).toBeNull();
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận thất bại**

Run: `cd apps/backend && npx vitest run src/modules/places/web-grounding.spec.ts -t groundedImage`
Expected: FAIL — `groundedImage` is not a function.

- [ ] **Step 4: Cài đặt `groundedImage`**

Trong `web-grounding.ts`, thêm import ở đầu:

```ts
import type { PlaceImage } from '@rong/shared-types';
```

Thêm hàm ngay sau `groundedAddress` (trước `function forAddressMatch`):

```ts
/**
 * Ảnh của địa điểm trong các bài đã nhắc nó: ảnh có alt chứa tên (nguyên từ, bỏ dấu),
 * không có thì ảnh nằm dưới tiêu đề mục chứa tên. Ưu tiên alt ở mọi bài trước, vì tiêu đề
 * mục chung chung ("Săn mây đồi chè…") dễ khớp nhầm địa điểm khác. Không khớp thì null.
 */
export function groundedImage(
  title: string,
  regionName: string,
  articles: WebSource[],
): PlaceImage | null {
  const names = nameVariants(title, regionName).map((name) => ` ${name} `);
  if (names.length === 0) return null;
  const mentions = (text: string | null) =>
    text !== null &&
    names.some((name) => ` ${normalizeForMatch(text)} `.includes(name));
  for (const field of ['alt', 'heading'] as const) {
    for (const article of articles) {
      const image = article.images.find((candidate) => mentions(candidate[field]));
      if (image) return { url: image.url, sourceUrl: article.uri };
    }
  }
  return null;
}
```

- [ ] **Step 5: Chạy test, xác nhận qua**

Run: `cd apps/backend && npx vitest run src/modules/places/web-grounding.spec.ts`
Expected: PASS (toàn bộ file, gồm 6 test `groundedImage`).

- [ ] **Step 6: Format và commit**

```bash
cd apps/backend
npx prettier --end-of-line auto --write src/modules/places/web-grounding.ts src/modules/places/web-grounding.spec.ts
cd ../..
git add packages/shared-types/src/place.ts apps/backend/src/modules/places/web-grounding.ts apps/backend/src/modules/places/web-grounding.spec.ts
git commit -m "feat(backend): ground a place image in articles that mention the place

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mtnr88jtXnPHPRZ7esDqRd"
```

---

### Task 3: Lưu ảnh và trả qua API

**Files:**
- Create: `apps/backend/src/database/migrations/1792200000000-AddRegionPlaceImage.ts`
- Modify: `packages/shared-types/src/place.ts` (`PlaceListItem.image`)
- Modify: `apps/backend/src/modules/places/region-place-store.ts`
- Modify: `apps/backend/src/modules/places/web-places.service.ts`
- Modify: `apps/backend/src/modules/places/places.service.ts`
- Modify: `apps/backend/src/modules/README.md`
- Test: `apps/backend/test/web-places.e2e-spec.ts`

**Interfaces:**
- Consumes: `groundedImage(title, regionName, articles): PlaceImage | null` (Task 2), `PlaceImage` (Task 2), `ArticleImage` (Task 1).
- Produces:
  - `PlaceListItem.image: PlaceImage | null` (và `PlaceDetail.image` qua kế thừa).
  - `WebPlaceInput.image: PlaceImage | null`, `StoredPlaceRow.image: PlaceImage | null`.

- [ ] **Step 1: Migration**

Tạo `apps/backend/src/database/migrations/1792200000000-AddRegionPlaceImage.ts`:

```ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ảnh địa điểm lấy từ bài viết (spec 2026-10-16-article-images): `{ url, sourceUrl }`,
 * lưu theo danh sách của vùng, cạnh `articles` mà ảnh được lấy từ đó.
 */
export class AddRegionPlaceImage1792200000000 implements MigrationInterface {
  name = 'AddRegionPlaceImage1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "region_places" ADD COLUMN "image" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "region_places" DROP COLUMN "image"`);
  }
}
```

- [ ] **Step 2: Hỏi người dùng rồi chạy migration trên DB dev**

Hỏi: "Chạy migration `AddRegionPlaceImage` (thêm cột `region_places.image`) lên DB dev Neon để chạy e2e?" Chỉ chạy khi được đồng ý:

Run: `cd apps/backend && npx nest build && npx typeorm migration:show -d dist/database/data-source.js && npx typeorm migration:run -d dist/database/data-source.js`
Expected: `Migration AddRegionPlaceImage1792200000000 has been executed successfully.`

- [ ] **Step 3: `PlaceListItem.image` trong shared-types**

Trong `packages/shared-types/src/place.ts`, interface `PlaceListItem`, thêm sau trường `articles`:

```ts
  /** Ảnh từ bài viết, null nếu không bài nào có ảnh khớp địa điểm (và với dòng nguồn Google). */
  image: PlaceImage | null;
```

Run: `cd packages/shared-types && npx tsc -p .`
Expected: không lỗi.

- [ ] **Step 4: Viết e2e thất bại**

Trong `apps/backend/test/web-places.e2e-spec.ts`:

(a) Sửa import thứ hai từ `region-place-store.js` không đổi; thêm import kiểu:

```ts
import type { ArticleImage } from '../src/langchain/web-search.js';
```

(b) Trong `describe('RegionPlaceStore', …)`, hàm `input` thêm `image: null`:

```ts
    const input = (
      name: string,
      location: WebPlaceInput['location'],
    ): WebPlaceInput => ({
      name,
      category: 'nature',
      address: null,
      description: 'Mô tả',
      openingHours: '07:00-17:00',
      articles: [article],
      image: null,
      location,
    });
```

Và thêm test cuối `describe('RegionPlaceStore', …)`:

```ts
    it('ảnh: lưu theo danh sách của vùng, làm mới không có ảnh thì null', async () => {
      const store = app.get(RegionPlaceStore);
      const image = { url: 'https://img.wp.test/a.jpg', sourceUrl: 'https://a.test/1' };
      const location = { source: 'ai' as const, lat: 11.94, lng: 108.44 };
      await store.replace(regionId, [{ ...input('E2E wp Ảnh Store', location), image }], [article], 30);
      expect((await store.list(regionId, null)).map((r) => r.image)).toEqual([image]);

      await store.replace(regionId, [input('E2E wp Ảnh Store', location)], [article], 30);
      expect((await store.list(regionId, null)).map((r) => r.image)).toEqual([null]);
    });
```

(c) Trong `describe('GET /regions/:id/places', …)`, sửa helper `article`:

```ts
    const article = (n: number, body: string, images: ArticleImage[] = []) => ({
      title: `Bài ${n}`,
      uri: `https://wp.test/${n}`,
      content: body,
      publishedAt: '2026-01-01',
      images,
    });
```

Thêm test sau test `'địa chỉ chỉ giữ khi có trong bài viết; trả ở danh sách và chi tiết'`:

```ts
    it('ảnh: lấy từ bài nhắc địa điểm khi alt khớp tên; trả ở danh sách và chi tiết', async () => {
      agent.findPlaces.mockResolvedValue({
        places: [agentPlace('E2E wp Đồi Có Ảnh', 'nature'), agentPlace('E2E wp Hồ Không Ảnh', 'nature')],
        sources: [
          article(4, 'E2E wp Đồi Có Ảnh và E2E wp Hồ Không Ảnh đều đẹp.', [
            { url: 'https://img.wp.test/doi.jpg', alt: 'E2E wp Đồi Có Ảnh', heading: null },
            { url: 'https://img.wp.test/khac.jpg', alt: 'Quán khác', heading: null },
          ]),
        ],
      });
      google.findPlace.mockResolvedValue([]);

      const res = await get().expect(200);
      expect(
        res.body.items.map((i: { name: string; image: unknown }) => [i.name, i.image]),
      ).toEqual([
        ['E2E wp Đồi Có Ảnh', { url: 'https://img.wp.test/doi.jpg', sourceUrl: 'https://wp.test/4' }],
        ['E2E wp Hồ Không Ảnh', null],
      ]);

      const detail = await request(app.getHttpServer())
        .get(`/api/places/${res.body.items[0].id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(detail.body.image).toEqual({ url: 'https://img.wp.test/doi.jpg', sourceUrl: 'https://wp.test/4' });
    });
```

(d) Trong `describe('GET /places/:id', …)`, test `'dòng web tọa độ AI: không gọi Google, link tìm trên Google Maps, ghi rõ nguồn'`: dòng này tạo bằng `webRow` và không thuộc danh sách vùng nào. Thêm một `expect` ngay sau `expect(google.details).not.toHaveBeenCalled();` của test đó:

```ts
      expect(res.body.image).toBeNull();
```

- [ ] **Step 5: Chạy e2e, xác nhận thất bại**

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts test/web-places.e2e-spec.ts`
Expected: FAIL — tsc/vitest báo `image` không có trong `WebPlaceInput`, hoặc kết quả thiếu `image`.

- [ ] **Step 6: `RegionPlaceStore` ghi/đọc `image`**

Trong `region-place-store.ts`:

```ts
import type { ArticleSource, PlaceCategory, PlaceImage } from '@rong/shared-types';
```

`WebPlaceInput` thêm sau `articles`:

```ts
  /** Ảnh từ bài viết (`groundedImage`), null nếu không có. */
  image: PlaceImage | null;
```

`StoredPlaceRow` thêm sau `articles`:

```ts
  image: PlaceImage | null;
```

Trong `replace`, đổi câu INSERT `region_places`:

```ts
        await m.query(
          `INSERT INTO region_places (region_id, place_id, rank, articles, image) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
          [
            regionId,
            id,
            rank,
            JSON.stringify(places[rank].articles),
            places[rank].image ? JSON.stringify(places[rank].image) : null,
          ],
        );
```

Trong `list`, đổi `rp.rank, rp.articles` thành `rp.rank, rp.articles, rp.image` trong SELECT.

- [ ] **Step 7: `WebPlacesService` gán ảnh, log, `toItem`**

Trong `web-places.service.ts`, thêm `groundedImage` vào import từ `./web-grounding.js` (cạnh `articlesMentioning`, `groundedAddress`).

Trong `build`, object `input: WebPlaceInput`, thêm sau `address`:

```ts
          image: groundedImage(place.title, regionName, articles),
```

Đổi dòng log sau `const matched = …`:

```ts
      const matched = inputs.filter((p) => p.location.source === 'google');
      const withImage = inputs.filter((p) => p.image !== null);
      this.logger.log(
        `"${regionName}": lưu ${inputs.length}/${found.places.length} địa điểm (${matched.length} ghép Google, ${withImage.length} có ảnh) trong ${Date.now() - started} ms`,
      );
```

Trong `toItem`, object trả về thêm sau `articles: row.articles,`:

```ts
      image: row.image,
```

- [ ] **Step 8: `PlacesService.getDetail` đọc `articles` và `image` cùng một dòng**

Trong `places.service.ts`:

```ts
import type {
  ArticleSource,
  GoogleContentStatus,
  GooglePlaceContent,
  LocationSource,
  PlaceCategory,
  PlaceDetail,
  PlaceImage,
} from '@rong/shared-types';
```

`DetailRow` thêm sau `articles: ArticleSource[] | null;`:

```ts
  image: PlaceImage | null;
```

Trong câu SQL của `getDetail`, thay khối:

```sql
              -- Bài viết nguồn: từ danh sách của vùng có địa điểm này (hạng cao nhất).
              (SELECT rp.articles FROM region_places rp WHERE rp.place_id = p.id
                ORDER BY rp.rank LIMIT 1) AS articles
         FROM places p WHERE p.id = $1`,
```

bằng:

```sql
              -- Bài viết nguồn và ảnh: cùng một dòng danh sách của vùng có địa điểm này (hạng cao nhất).
              top.articles, top.image
         FROM places p
         LEFT JOIN LATERAL (
           SELECT rp.articles, rp.image FROM region_places rp
            WHERE rp.place_id = p.id ORDER BY rp.rank LIMIT 1
         ) top ON true
        WHERE p.id = $1`,
```

Trong `toListItem`, thêm sau `articles: row.articles ?? [],`:

```ts
    image: row.image ?? null,
```

- [ ] **Step 9: Typecheck, unit, e2e**

Run: `cd apps/backend && npx tsc --noEmit -p tsconfig.json && npx vitest run && npx vitest run --config vitest.config.e2e.ts test/web-places.e2e-spec.ts`
Expected: tsc không lỗi; mọi unit test PASS; `web-places.e2e-spec.ts` PASS (gồm 2 test ảnh mới và assertion `image` null).

- [ ] **Step 10: Chạy toàn bộ e2e**

Run: `cd apps/backend && npx vitest run --config vitest.config.e2e.ts`
Expected: tất cả file PASS (trước task này là 115 test; sau task là 117).

- [ ] **Step 11: Cập nhật README module**

Trong `apps/backend/src/modules/README.md`, ngay sau dòng bắt đầu bằng ``- `places.address` lưu địa chỉ lấy từ bài viết`` (khoảng dòng 113), thêm:

```markdown
- `region_places.image` lưu một ảnh `{ url, sourceUrl }` lấy từ bài viết (hotlink, không tải về). `searchWeb` tách
  ảnh `![alt](url)` kèm tiêu đề mục khỏi markdown Tavily trước khi cắt bài (`extractImages` trong
  `langchain/web-search.ts`); `groundedImage` (`web-grounding.ts`) chọn ảnh có alt, rồi tiêu đề mục, chứa tên địa
  điểm trong các bài đã nhắc nó. Không khớp thì `NULL`, client hiện icon danh mục. Danh sách cũ có ảnh khi tự làm
  mới.
```

- [ ] **Step 12: Format và commit**

```bash
cd apps/backend
npx prettier --end-of-line auto --write src/database/migrations/1792200000000-AddRegionPlaceImage.ts src/modules/places/region-place-store.ts src/modules/places/web-places.service.ts src/modules/places/places.service.ts test/web-places.e2e-spec.ts
cd ../..
git add packages/shared-types/src/place.ts apps/backend/src/database/migrations/1792200000000-AddRegionPlaceImage.ts apps/backend/src/modules/places/region-place-store.ts apps/backend/src/modules/places/web-places.service.ts apps/backend/src/modules/places/places.service.ts apps/backend/test/web-places.e2e-spec.ts apps/backend/src/modules/README.md
git commit -m "feat(backend): store article images per region list and return them as place.image

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mtnr88jtXnPHPRZ7esDqRd"
```

Lưu ý: `region-place-store.ts` đã không đúng prettier từ trước. Nếu `prettier --write` đổi cả những đoạn không liên quan, hoàn tác bằng `git checkout -p` cho phần đó, hoặc bỏ file này khỏi lệnh prettier và giữ style tay.

---

### Task 4: Thumbnail ảnh trong danh sách (mobile)

**Files:**
- Modify: `apps/mobile/src/components/ui/place-row.tsx`

**Interfaces:**
- Consumes: `PlaceListItem.image: PlaceImage | null` (Task 3, đã build ở `packages/shared-types/dist`).
- Produces: không.

- [ ] **Step 1: Thêm thumbnail có quay về icon**

Trong `place-row.tsx`, thêm import:

```ts
import { Image } from 'expo-image';
import { useState } from 'react';
```

Trong `PlaceRow`, ngay sau `const approximate = place.locationSource === 'ai';`:

```ts
  // Ảnh từ bài viết; tải lỗi (link chết, chặn hotlink) thì quay về icon danh mục.
  const [imageFailed, setImageFailed] = useState(false);
  const image = place.image && !imageFailed ? place.image : null;
```

Thay khối:

```tsx
      <View style={styles.thumb}>
        <Icon name={place.category} size={22} color={Colors.light.primary} />
      </View>
```

bằng:

```tsx
      <View style={styles.thumb}>
        {image ? (
          <Image
            source={{ uri: image.url }}
            style={styles.thumbImage}
            contentFit="cover"
            transition={150}
            accessible={false}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <Icon name={place.category} size={22} color={Colors.light.primary} />
        )}
      </View>
```

Sửa comment JSDoc của `PlaceRow` ("Thumbnail là glyph danh mục, không dùng ảnh Google (PRD 7.4).") thành:

```ts
 * Một địa điểm trong bottom sheet (FR-2.9). Luôn trên nền đặc. Thumbnail là ảnh từ bài
 * viết nếu có, không thì glyph danh mục; không dùng ảnh Google (PRD 7.4).
```

Trong `styles`, `thumb` thêm `overflow: 'hidden'`, và thêm style mới ngay sau `thumb`:

```ts
  thumbImage: { width: '100%', height: '100%' },
```

- [ ] **Step 2: Typecheck và lint**

Run: `cd apps/mobile && npx tsc --noEmit 2>&1 | grep -v "^ " | grep -v "is not assignable to type '\"/\"\|is not assignable to parameter of type '\"/\""; npx eslint src/components/ui/place-row.tsx`
Expected: không có dòng lỗi nào (các lỗi typed-route cũ đã bị lọc); eslint không báo gì.

- [ ] **Step 3: Kiểm tra tay (người dùng)**

Trên máy thật: mở một vùng có danh sách mới tạo sau Task 3. Mục có ảnh hiện thumbnail; mục không ảnh hiện icon. Để thử ảnh lỗi, tạm sửa một `region_places.image.url` trên DB dev thành URL không tồn tại → mục đó hiện icon.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/ui/place-row.tsx
git commit -m "feat(mobile): show the article image as the place row thumbnail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mtnr88jtXnPHPRZ7esDqRd"
```

---

### Task 5: Ảnh lớn ở màn chi tiết (mobile)

**Files:**
- Modify: `apps/mobile/src/app/(app)/place/[id].tsx`

**Interfaces:**
- Consumes: `PlaceDetail.image: PlaceImage | null` (Task 3).
- Produces: không.

- [ ] **Step 1: Thêm component `ArticleImage` và đặt ở đầu nội dung cuộn**

Trong `place/[id].tsx`, thêm import:

```ts
import type { PlaceCategory, PlaceDetail, PlaceImage } from '@rong/shared-types';
import { Image } from 'expo-image';
```

(Dòng import `@rong/shared-types` đã có `PlaceCategory, PlaceDetail`: chỉ thêm `PlaceImage`. `useState` đã được import.)

Trong `ScrollView` của `PlaceDetailScreen`, ngay trước `<View style={styles.header}>`:

```tsx
        {place?.image ? <ArticleImage image={place.image} /> : null}
```

Thêm component ngay trước `/** Giờ mở cửa hôm nay: … */ function Summary`:

```tsx
/** Ảnh từ bài viết (hotlink), kèm tên trang nguồn. Tải lỗi thì ẩn cả khối. */
function ArticleImage({ image }: { image: PlaceImage }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <View style={styles.photoBlock}>
      <Image
        source={{ uri: image.url }}
        style={styles.photo}
        contentFit="cover"
        transition={200}
        accessible={false}
        onError={() => setFailed(true)}
      />
      <Text style={styles.photoCredit} accessibilityRole="link" onPress={() => Linking.openURL(image.sourceUrl)}>
        Ảnh: {hostname(image.sourceUrl)}
      </Text>
    </View>
  );
}

/** "zalopay.vn" từ link bài viết, bỏ "www.". */
function hostname(url: string): string {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url);
  return (match?.[1] ?? url).replace(/^www\./i, '');
}
```

Trong `styles`, thêm:

```ts
  photoBlock: { gap: Spacing.one },
  photo: { width: '100%', aspectRatio: 16 / 9, borderRadius: Radius.lg, borderCurve: 'continuous' },
  photoCredit: { ...Type.footnote, color: Colors.light.textSecondary },
```

- [ ] **Step 2: Typecheck và lint**

Run: `cd apps/mobile && npx tsc --noEmit 2>&1 | grep -v "^ " | grep -v "is not assignable to type '\"/\"\|is not assignable to parameter of type '\"/\""; npx eslint "src/app/(app)/place/[id].tsx"`
Expected: không có dòng lỗi; eslint không báo gì.

- [ ] **Step 3: Kiểm tra tay (người dùng)**

Trên máy thật: mở chi tiết một địa điểm có ảnh → ảnh 16:9 ở đầu, dưới là "Ảnh: <tên miền>", chạm mở bài viết. Địa điểm không ảnh: màn như trước. Ảnh lỗi (sửa URL trên DB dev như Task 4): khối ảnh và dòng nguồn biến mất.

- [ ] **Step 4: Commit**

```bash
git add "apps/mobile/src/app/(app)/place/[id].tsx"
git commit -m "feat(mobile): show the article image with its source on place detail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mtnr88jtXnPHPRZ7esDqRd"
```

---

### Task 6: Đo thật một vùng (tùy chọn, tốn tiền)

**Files:** không sửa file.

- [ ] **Step 1: Hỏi người dùng**

Hỏi: "Chạy `bench:places` cho một vùng (gọi Tavily + Gemini thật, tốn tiền) để đo tỷ lệ địa điểm có ảnh?" Chỉ chạy khi được đồng ý, và hỏi vùng nào (`source_key`, ví dụ `vn:destination:da-lat`).

- [ ] **Step 2: Chạy**

Run (PowerShell không có cú pháp `VAR=x cmd`, nên chạy bằng Bash tool): `cd /d/Rong/packages/shared-types && npx tsc -p . && cd ../../apps/backend && PLACES_LIVE_REGION=<source_key> npx vitest run --config ./vitest.config.live.ts`
(Đây là lệnh của script `bench:places` trong `apps/backend/package.json`, gọi trực tiếp không qua `pnpm`.)
Expected: log `"<vùng>": lưu N/M địa điểm (… ghép Google, K có ảnh)`. Báo người dùng tỷ lệ K/N.
