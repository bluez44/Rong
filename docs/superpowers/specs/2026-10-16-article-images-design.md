# Ảnh địa điểm lấy từ bài viết

| | |
| --- | --- |
| Ngày | 16/10/2026 |
| Trạng thái | Chờ duyệt spec |
| Phạm vi | `apps/backend`, `apps/mobile`, `packages/shared-types` |
| PRD liên quan | F2 (danh sách vùng), F5 (chi tiết địa điểm), mục 7.4 |

## 1. Bối cảnh

Địa điểm hiện không có ảnh: danh sách hiện icon danh mục, màn chi tiết không có ảnh. Ảnh Google không dùng được
(Việt Nam là Google Maps Platform Prohibited Territory, và PRD 7.4 không cho lưu ảnh Google). Vietmap và Goong không
cung cấp ảnh địa điểm.

Danh sách địa điểm của vùng đã được tổng hợp từ bài viết (spec `2026-10-14-web-places-design.md`). Spike ngày
16/10/2026 (gọi Tavily 2 lần với "địa điểm check-in đẹp ở Đà Lạt", tham số như pipeline) cho thấy:

- `raw_content` dạng markdown giữ ảnh `![alt](url)`. Ở bài kiểu "top N địa điểm", mỗi ảnh nằm ngay dưới tiêu đề
  "N. Tên địa điểm" và **alt trùng tên địa điểm** (bài ZaloPay: 23 ảnh thật, 19 ảnh đúng một địa điểm).
- `raw_content` không ổn định: lần 1 chỉ 1/4 bài có (còn lại `null`), lần 2 có 4/4.
- Pipeline cắt mỗi bài còn 2.500 ký tự (`MAX_ARTICLE_CHARS`) trước khi đưa Gemini, nên phần lớn ảnh bị mất ở đó.
- `include_images` của Tavily trả ảnh theo cả truy vấn, mô tả do AI viết chung chung, không gán được cho địa điểm.

### 1.1 Các quyết định đã chốt

| # | Quyết định |
| --- | --- |
| Q1 | Dùng ảnh trong bài viết khi có. Không có thì giữ icon danh mục như hiện nay. |
| Q2 | Ảnh hiện ở danh sách của vùng (thumbnail) và ở đầu màn chi tiết, kèm "Ảnh: tên miền" link sang bài nguồn. |
| Q3 | Gán ảnh bằng code (alt / tiêu đề mục khớp tên), không để Gemini chọn ảnh. |
| Q4 | Lưu ảnh trong `region_places`, cạnh `articles` (ảnh thuộc bài viết, bài viết thuộc danh sách của vùng). |
| Q5 | Không làm mới hàng loạt: danh sách cũ có ảnh khi tự làm mới sau 30 ngày. Không tốn thêm lượt gọi API. |
| Q6 | Chỉ lưu URL ảnh (hotlink), không tải ảnh về server. |

### 1.2 Ngoài phạm vi

- Ảnh người dùng tải lên, Wikimedia Commons, nhiều ảnh cho một địa điểm.
- Ảnh cho dòng `source = 'google'` (người dùng lưu từ Google) và ảnh trong lịch trình.
- Lệnh làm mới hàng loạt danh sách cũ.
- Proxy hay cache ảnh phía server.

## 2. Thiết kế

### 2.1 Tách ảnh khỏi bài (`src/langchain/web-search.ts`)

`WebSource` thêm `images: ArticleImage[]`:

```ts
export interface ArticleImage {
  url: string;
  /** Alt text của ảnh, đã trim. */
  alt: string;
  /** Tiêu đề mục gần nhất phía trên ảnh (dòng `#…` hoặc dòng chỉ gồm `**…**`), null nếu chưa có. */
  heading: string | null;
}
```

`extractImages(markdown)` đọc **toàn bộ** `raw_content` trước khi cắt:

- Đi từng dòng, nhớ tiêu đề gần nhất: dòng bắt đầu bằng `#`, hoặc dòng chỉ gồm một đoạn in đậm **có đánh số**
  `**1. …**` / `**1) …**` (bài ZaloPay dùng kiểu này cho tiêu đề địa điểm). Dòng in đậm không đánh số
  (`**Giá vé**`) là nhãn trong mục, không đổi tiêu đề.
- Lấy mọi `![alt](url)` (bỏ phần title `"…"` nếu có trong ngoặc).
- Bỏ ảnh: URL không phải `http(s)`, đuôi `.svg` / `.gif`, alt rỗng, alt hoặc URL chứa `logo`, `icon`, `avatar`,
  `banner` (không phân biệt hoa thường).
- Bỏ trùng theo URL, giữ tối đa `MAX_IMAGES_PER_ARTICLE` (60) ảnh đầu.

Nội dung gửi Gemini (`content`) bỏ hẳn cú pháp ảnh trước khi cắt 2.500 ký tự, nên cùng giới hạn chứa được nhiều
chữ hơn. Bài không có `raw_content` (chỉ có đoạn trích `content`) thì `images: []`.

### 2.2 Gán ảnh cho địa điểm (`src/modules/places/web-grounding.ts`)

```ts
export function groundedImage(
  title: string,
  regionName: string,
  articles: WebSource[],
): { url: string; sourceUrl: string } | null;
```

- `articles` là các bài đã nhắc địa điểm (kết quả `articlesMentioning`), theo thứ tự hiện có.
- Dùng lại `nameVariants(title, regionName)` và `normalizeForMatch` như `articlesMentioning`.
- So khớp trên chuỗi đã chuẩn hóa, nguyên từ. Ba bậc tin cậy, xét hết bậc trên (ở mọi bài) rồi mới xuống bậc dưới:
  1. alt **đúng bằng** một biến thể tên;
  2. tiêu đề mục chứa ảnh có tên;
  3. alt chỉ **chứa** tên ("Quán cà phê view Hồ Xuân Hương", ảnh "bài liên quan") — dễ là ảnh nơi khác nên xếp cuối.
- Cùng bậc thì lấy ảnh đầu tiên theo thứ tự bài rồi thứ tự ảnh, kèm `sourceUrl` là `uri` của bài đó.
  Không khớp thì `null`.

Khớp nguyên từ để tên không khớp vào giữa một từ khác, giống `articlesMentioning`. `nameVariants` đã bỏ biến thể
dưới 4 ký tự. Tên chung chung vẫn có thể khớp mục của địa điểm khác (ví dụ "Đồi chè" khớp "Săn mây đồi chè Cầu
Đất"); ưu tiên khớp alt trước tiêu đề giảm rủi ro này (mục 2.6).

### 2.3 Pipeline và lưu trữ

- `WebPlacesService.build`: thêm `image: groundedImage(place.title, regionName, articles)` vào `WebPlaceInput`.
- `WebPlaceInput.image: { url: string; sourceUrl: string } | null`.
- Migration `AddRegionPlaceImage`: `ALTER TABLE region_places ADD COLUMN image jsonb` (null được). `down()` bỏ cột.
- `RegionPlaceStore.replace` ghi `image` cùng `articles`. `listForRegion` đọc `rp.image`.
- `PlacesService.getDetail`: câu SQL đang lấy `rp.articles` từ dòng `region_places` hạng cao nhất thì lấy luôn
  `rp.image` từ cùng dòng đó.
- Log của `build` ghi thêm số địa điểm có ảnh, ví dụ `lưu 30/34 địa điểm (0 ghép Google, 17 có ảnh)`.

### 2.4 API (`packages/shared-types/src/place.ts`)

```ts
/** Ảnh lấy từ bài viết (hotlink), kèm bài nguồn để ghi công. */
export interface PlaceImage {
  url: string;
  /** Bài viết chứa ảnh. */
  sourceUrl: string;
}

export interface PlaceListItem {
  // …
  /** Ảnh từ bài viết, null nếu không bài nào có ảnh khớp địa điểm. */
  image: PlaceImage | null;
}
```

`PlaceDetail` kế thừa `image`. Dòng `source = 'google'` và địa điểm không thuộc danh sách vùng nào: `image: null`.

### 2.5 Mobile

- `components/ui/place-row.tsx`: ô thumbnail 52×52 hiện ảnh bằng `expo-image` (`contentFit="cover"`, có
  `transition` ngắn). Khi ảnh lỗi (`onError`) hoặc `image` null, hiện icon danh mục như hiện nay.
- `app/(app)/place/[id].tsx`: ảnh lớn ở đầu nội dung cuộn (tỉ lệ 16:9, bo góc), ngay dưới đó là dòng chữ nhỏ
  "Ảnh: <tên miền>" (bỏ `www.`), chạm vào mở `sourceUrl`. Ảnh lỗi thì ẩn cả khối ảnh và dòng ghi nguồn.
- Ảnh là trang trí: `accessible={false}` cho ảnh; dòng ghi nguồn có `accessibilityRole="link"`.

### 2.6 Lỗi và giới hạn

| Tình huống | Hành vi |
| --- | --- |
| Bài không có `raw_content` | Không có ảnh từ bài đó. |
| Không ảnh nào khớp tên | `image: null`, giữ icon danh mục. |
| Ảnh chết, bị chặn hotlink, sai định dạng | Mobile bắt `onError`, quay về icon (danh sách) hoặc ẩn khối ảnh (chi tiết). |
| Ảnh khớp nhầm (tiêu đề mục nhắc hai địa điểm) | Chấp nhận. Ưu tiên khớp alt giảm rủi ro này. |
| Danh sách tạo trước khi có tính năng | `image: null` cho tới lần làm mới tiếp theo. |

Ảnh thuộc bản quyền của trang nguồn. App chỉ hotlink và luôn ghi nguồn kèm link sang bài.

## 3. Kiểm thử

- Unit `web-search.spec.ts`: `extractImages` với markdown mẫu giống bài ZaloPay (tiêu đề `**N. Tên**`, ảnh alt
  trùng tên), logo/icon, ảnh `data:`, `.svg`, alt rỗng, ảnh trùng URL, ảnh trước tiêu đề đầu tiên (`heading: null`);
  `content` không còn cú pháp ảnh.
- Unit `web-grounding.spec.ts`: `groundedImage` khớp theo alt, khớp theo tiêu đề, ưu tiên alt hơn tiêu đề, khớp
  nguyên từ (không khớp tên là tiền tố của tên khác), không khớp trả null, chỉ xét bài được truyền vào.
- e2e `web-places.e2e-spec.ts`: pipeline giả trả bài có ảnh → `GET /regions/:id/places` có `image` cho địa điểm
  khớp và `null` cho địa điểm không khớp; `GET /places/:id` trả cùng `image`.
- Đo thật: chạy `pnpm bench:places` cho một vùng để xem tỷ lệ địa điểm có ảnh (tốn tiền, hỏi trước khi chạy).
- Mobile: `tsc`, `eslint`; kiểm tra bằng mắt trên máy thật (ảnh, ảnh lỗi, không ảnh).
