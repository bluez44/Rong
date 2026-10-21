# Ảnh địa điểm từ Unsplash — thiết kế (BẢN NHÁP, tạm dừng)

> **Trạng thái (2026-10-21):** tạm dừng, phát triển sau.
>
> - §1–§3 (quyết định, hàng đợi chung, gateway Unsplash, dữ liệu, job, API) **đã được duyệt** trong buổi brainstorm.
> - §4 (mobile, ghi công, kiểm thử) **đã trình bày nhưng chưa duyệt**.
>
> **Làm tiếp:** đọc lại §4, chốt với người dùng, hoàn thiện thành spec chính thức, rồi viết plan (superpowers:writing-plans).

## Mục tiêu

Địa điểm là danh lam thắng cảnh hay địa danh nổi tiếng nhiều khả năng có ảnh trên Unsplash. Ta tìm thêm ảnh ở đó để màn chi tiết địa điểm có nhiều ảnh đẹp, rõ giấy phép, thay vì chỉ có (hoặc không có) một ảnh hotlink từ bài viết.

**Hiện trạng** (database dev, 2026-10-21; 408 địa điểm, 14 vùng):
- Ảnh chỉ lấy từ bài viết (`region_places.image`), qua `groundedImage`: `alt` hoặc tiêu đề của ảnh trong bài phải nhắc đúng tên địa điểm.
- Ảnh chỉ hiện ở màn chi tiết địa điểm (`apps/mobile/src/app/(app)/place/[id].tsx`).
- Tỉ lệ có ảnh theo loại:

| Loại | Có ảnh / tổng |
| --- | --- |
| Thiên nhiên (`nature`) | 17/45 |
| Văn hóa – lịch sử (`culture`) | 11/37 |
| Check-in (`check_in`) | 9/30 |
| Về đêm (`nightlife`) | 1/13 |
| Vui chơi trẻ em (`kids`) | 2/5 |
| Lưu trú (`stay`) | 16/99 |
| Ăn uống (`food`) | 11/94 |
| Cà phê (`cafe`) | 6/85 |

## Quyết định đã chốt

| Vấn đề | Quyết định |
| --- | --- |
| Ảnh bài viết và ảnh Unsplash | **Hiện cả hai** trong một khung vuốt ngang. **Giữ nguyên bố cục ảnh + bản đồ** hiện tại |
| Loại địa điểm được tìm trên Unsplash | `nature`, `culture`, `check_in`, `kids`, `nightlife` (khoảng 130 địa điểm hiện có). Không tìm cho `food`, `cafe`, `stay` |
| Số ảnh Unsplash mỗi địa điểm | Tối đa **3** |
| Khi nào tìm | **Hướng 2**: ngay khi dựng danh sách vùng, cộng với lịch quét hằng ngày; không tìm theo lượt xem |
| Hàng đợi | **Tách ra module chung**; gợi ý trang chủ và job ảnh cùng chạy trên đó |

**Ràng buộc của Unsplash** (tài liệu API, 2026-10-21):
- Chế độ Demo: **50 request/giờ**. Production (phải xin duyệt): **1.000 request/giờ**.
- Phải dùng thẳng URL ảnh mà API trả về (hotlink), và ghi công cả tác giả lẫn Unsplash.
- Mỗi ảnh được dùng thì gọi `download_location` để báo một lượt tải.
- Kết quả `GET /search/photos` có `description` và `alt_description`, **không có** `location` hay `tags` (muốn có phải gọi thêm `GET /photos/:id`, tốn thêm request).

---

## §1. Module hàng đợi chung `modules/jobs/` (đã duyệt)

Chuyển từ `modules/recommendations/queue/` sang đây, module toàn cục:

| Hiện tại | Mới |
| --- | --- |
| `RecommendationsQueue` | `JobQueue` (`enqueue`, `enqueueMany`, `state`, `remove`, `idle`; khi tắt Redis thì chạy trong process như hiện nay) |
| `RecommendationScheduler` | `JobScheduler`: mọi lịch cron (gợi ý và ảnh) đăng ký ở một chỗ |
| `BullQueuesModule`, `queue/jobs.ts` | Giữ vai trò; `jobs.ts` có union `AppJob` gồm mọi loại job |
| `RecommendationsProcessor`, `RecommendationsAiProcessor` | Processor chung cho từng queue, chỉ chuyển job tới runner |

- **Chuyển job tới runner:** mỗi tên job ánh xạ tới một token runner do module tính năng cung cấp: `RecommendationJobs` (gợi ý) và `PlacePhotoJobs` (ảnh). `JobQueue` và processor lấy runner qua `ModuleRef` (`strict: false`), nên `jobs/` không import module tính năng nào, tránh import vòng. Hiện `RecommendationsModule` đã import `PlacesModule`, nên nếu `places/` tự đẩy job vào queue nằm trong `recommendations/` thì sẽ vòng.
- **Queue:**
  - `recommendations`: job thường, concurrency 4.
  - `recommendations-ai`: job gọi Gemini, limiter 10 job/phút.
  - **`unsplash` (mới):** limiter **N job/giờ**, N lấy từ env `UNSPLASH_JOBS_PER_HOUR` (mặc định 10). Chạy `fetch-region-image` (chuyển sang từ queue `recommendations`) và `fetch-place-photos`. Mỗi job tốn tối đa 4 request (1 tìm + tối đa 3 báo tải), tức tối đa 40/giờ, vừa với giới hạn Demo.
- **Giữ nguyên tên queue trong Redis** (`recommendations`, `recommendations-ai`), dù code đổi tên. Đổi tên thì các job scheduler cũ còn trong queue cũ trên Redis Cloud, tiếp tục đẻ job không ai xử lý.
- Những nơi đang dùng `RecommendationsQueue` phải đổi import: `maintenance.ts`, `recommendation-builder.ts`, `recommendations.service.ts`, `users.controller.ts`, `visits.controller.ts`, `visits.service.ts`, `app.module.ts`.

## §2. Gateway Unsplash `modules/unsplash/` (đã duyệt)

- Chuyển `UnsplashClient` từ `recommendations/` sang đây, làm cổng duy nhất tới Unsplash (quy ước gateway trong `CLAUDE.md`).
- Giữ `searchLandscape` cho ảnh vùng.
- Thêm `search(query, perPage)`: trả nhiều ảnh, mỗi ảnh có `description`, `alt_description`, `width`, `height`, URL `regular`, tác giả, link trang ảnh kèm UTM, và `download_location`.
- Tách việc báo lượt tải thành một hàm riêng, chỉ gọi cho ảnh thật sự được dùng.
- Cấu hình dùng `UNSPLASH_ACCESS_KEY` có sẵn.

## §3. Ảnh địa điểm `modules/place-photos/` (đã duyệt)

### Dữ liệu (một migration)

- `place_photo_searches (place_id PK → places ON DELETE CASCADE, status 'found'|'none', searched_at)`.
- `place_photos (place_id → places ON DELETE CASCADE, position, url, width, height, author, author_url, page_url, blocked boolean default false)`, tối đa 3 dòng mỗi địa điểm. Chỉ lưu URL để hotlink, không tải file.
- Ảnh bài viết vẫn nằm ở `region_places.image`.

### Khi nào tìm

- **Khi dựng danh sách:** `WebPlacesService` lưu xong danh sách một vùng thì đẩy `fetch-place-photos { placeId }` cho từng địa điểm thuộc 5 loại đã chọn. Job id `place-photos_<placeId>` để không chạy trùng.
- **Lịch quét `sweep-place-photos`** (hằng ngày, 03:30 giờ Việt Nam): đẩy job cho địa điểm thuộc 5 loại, nằm trong danh sách của vùng `ready`, mà chưa có dòng trong `place_photo_searches` (bắt kịp dữ liệu cũ), hoặc `status = 'none'` và `searched_at` đã quá 30 ngày. Queue `unsplash` tự giãn job theo limiter.
- **Khi tắt Redis** (`RECOMMENDATIONS_ENABLED=false` hoặc e2e): job chạy ngay trong process, không có lịch quét. Unsplash trả 403 vì hết lượt thì địa điểm giữ trạng thái "chưa tìm".

### Một job `fetch-place-photos`

1. Câu tìm: `"<tên địa điểm> <tên vùng> Vietnam"`, `per_page=10`, 1 request.
2. **Kiểm tra độ khớp:**
   - Bỏ dấu tên địa điểm, tách phần **tên riêng** khỏi phần chung chung (hồ, chùa, thác, núi, đồi, công viên, khu du lịch…). Ví dụ "Hồ Xuân Hương" → "xuan huong", "Thác Datanla" → "datanla".
   - Nhận ảnh khi `description` hoặc `alt_description` (đã bỏ dấu) chứa nguyên cụm tên riêng.
   - Với `kids` và `nightlife`: phải chứa **tên đầy đủ**.
   - Tên chỉ toàn phần chung chung thì không tìm (ghi `none`).
3. Lấy tối đa 3 ảnh đầu qua được bước kiểm tra, báo lượt tải cho từng ảnh, lưu vào `place_photos`, ghi `found`. Không có ảnh nào thì ghi `none`.
4. Lỗi 403/429 hoặc lỗi mạng: **ném lỗi** để BullMQ thử lại sau, **không** ghi `none`.

### API

- `GET /places/:id` **giữ** trường `image` (để app cũ v1.9.0 vẫn chạy), và **thêm** `photos: PlacePhoto[]`: ảnh bài viết đứng đầu, sau đó là ảnh Unsplash có `blocked = false` theo `position`.
- Phần đọc nằm trong `places/`, đọc thẳng từ bảng bằng SQL, không phụ thuộc module `place-photos`.
- Kiểu mới trong `packages/shared-types/src/place.ts`:

```ts
export interface PlacePhoto {
  url: string;
  source: 'web' | 'unsplash';
  width?: number | null;
  height?: number | null;
  /** Ảnh bài viết: bài nguồn. */
  sourceUrl?: string | null;
  /** Ảnh Unsplash: tác giả, trang tác giả và trang ảnh (kèm UTM). */
  author?: string | null;
  authorUrl?: string | null;
  pageUrl?: string | null;
}
```

---

## §4. Mobile, ghi công, kiểm thử (đã trình bày, CHƯA DUYỆT)

### Khung vuốt ảnh

`components/place-photos.tsx`, thay `ArticleImage` trong `place/[id].tsx`:
- **Giữ nguyên vị trí và bố cục:** khối ảnh ngay trên bản đồ; bản đồ vẫn dùng `MAP_HEIGHT_WITH_IMAGE` khi có ảnh.
- **Chiều cao khung theo ảnh đầu tiên**, kẹp tỉ lệ như `AdaptiveImage fit="natural"`. Các ảnh sau phủ kín khung (`cover`) nên khung không nhảy chiều cao khi vuốt. Ảnh Unsplash có sẵn kích thước từ API; ảnh bài viết đo sau khi tải.
- `FlatList` `horizontal` `pagingEnabled` lấy từ `react-native-gesture-handler` (quy tắc trong `apps/mobile/CLAUDE.md`, vì màn có bản đồ nhận cử chỉ).
- Có từ 2 ảnh thì hiện chấm chỉ số. Chỉ 1 ảnh thì trông như hiện nay.
- Ảnh tải lỗi thì bỏ khỏi khung; hết ảnh thì bản đồ đứng một mình.
- App đọc `photos`; nếu backend chưa trả `photos` thì dùng `image` thay thế.

### Ghi công

Đè ở góc dưới ảnh, như hiện nay:
- **Ảnh bài viết:** "Ảnh: {tên miền}", bấm mở bài.
- **Ảnh Unsplash:** "Ảnh: {Tác giả} / Unsplash". Bấm tác giả mở trang tác giả, bấm "Unsplash" mở trang ảnh, cả hai kèm UTM. Giống thẻ gợi ý trang chủ (`components/recommendation-card.tsx`).

### Kiểm thử

- **Backend unit:**
  - Tách tên riêng (có dấu / không dấu, tên chỉ toàn phần chung chung).
  - Lọc độ khớp, gồm luật tên đầy đủ cho `kids` và `nightlife`.
  - `UnsplashClient.search` với `fetch` giả (kết quả, báo tải, 403/429).
  - `PlacePhotoJobs` (tối đa 3 ảnh; `none` khi không khớp; 403 thì ném lỗi, không ghi `none`).
  - Ánh xạ job sang queue và runner (`fetch-region-image` và `fetch-place-photos` vào `unsplash`).
- **Backend e2e** (chạy trong process, Unsplash giả):
  - Dựng danh sách xong thì có job cho đúng các loại, không có cho `food`/`cafe`/`stay`.
  - `GET /places/:id` trả `photos` đúng thứ tự, ẩn ảnh `blocked`, vẫn còn `image`.
  - Lịch quét chọn đúng địa điểm chưa tìm và địa điểm `none` quá 30 ngày.
  - **Không đổi hành vi:** e2e gợi ý và `recommendations-queue.spec` (sẽ đổi tên) vẫn pass sau khi tách module.
- **Mobile Jest:** khung hiện đúng số ảnh, dùng `image` khi thiếu `photos`, bỏ ảnh lỗi, ghi công theo nguồn.

### Ngoài phạm vi

Ảnh trên trang web xem lịch trình; phóng to ảnh toàn màn hình; màn quản trị gỡ ảnh sai (tạm thời đặt `place_photos.blocked = true` trong database).

## Rủi ro

- **Ảnh sai địa điểm:** bước kiểm tra chỉ dựa vào chú thích của người chụp. Có thể ra ít ảnh hơn mong đợi nhưng hiếm khi sai. Gỡ tay bằng `blocked`.
- **Giới hạn Demo 50 request/giờ:** khoảng 130 địa điểm hiện có, mất khoảng 13 giờ để quét xong lần đầu. Xin duyệt Production rồi tăng `UNSPLASH_JOBS_PER_HOUR`.
- **Tách module hàng đợi** đụng tới mọi nơi đang đẩy job gợi ý; cần chạy lại toàn bộ e2e gợi ý.
