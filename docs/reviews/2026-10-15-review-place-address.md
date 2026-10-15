# Review: lưu địa chỉ cho địa điểm (commit `6b94904`)

- **Phạm vi:** `git diff HEAD~1 HEAD` — commit `6b94904 feat: persist addresses for travel places` (20 file, +125 / −53).
  Lưu ý: `HEAD~1` (`5bb5280 Polish mobile travel screens`) là commit chỉnh UI mobile; thay đổi về địa chỉ nằm ở `HEAD`, nên review so sánh `HEAD~1 → HEAD`.
- **Ngày review:** 2026-10-15

## Kết luận nhanh

Thay đổi **hợp lý và đúng hướng**, không phát hiện lỗi chặn (blocker). Luồng dữ liệu nhất quán từ Gemini → `places.address` → API danh sách / chi tiết / lịch trình → mobile, và **tuân thủ PRD §7.4**: không có đường nào ghi địa chỉ Google vào `places.address` hay vào JSONB lịch trình.

Có một số điểm nên sửa, chủ yếu về **chất lượng dữ liệu** (địa chỉ do AI trả về chưa được kiểm chứng), **trường trùng lặp trong schema Gemini** và **thiếu test**.

> **Cập nhật 2026-10-15:** đã sửa cả 7 mục trong [danh sách đề xuất](#danh-sách-việc-đề-xuất-theo-ưu-tiên), mỗi mục một commit (`d8399bd` → `ee48d72`). Unit test backend giờ qua 279/279. Còn lại: chạy e2e khi có database, và quyết định có làm mới danh sách các vùng cũ hay không (xem [Thiếu sót](#thiếu-sót)). Phần review bên dưới giữ nguyên như lúc viết.

## Kiểm chứng đã chạy

| Kiểm tra | Kết quả |
| --- | --- |
| `tsc --noEmit` backend (gồm `test/`) sau khi build `shared-types` | ✅ Không lỗi |
| `vitest run` backend (unit) | ⚠️ 266/267 pass. Test lỗi là `place-search.service.spec.ts > chạy các truy vấn song song…`, **không do commit này**: commit `15dab89` thêm `năm ${year}` vào cuối truy vấn Tavily nên `q.endsWith('Đà Lạt')` sai. Cần sửa test hoặc truy vấn. |
| `oxlint --type-aware` trên các file backend đã đổi | ✅ Chỉ còn 1 cảnh báo có từ trước (`itineraries.service.ts:513`, `no-misused-spread`) |
| `tsc --noEmit` mobile | ✅ Không có lỗi ở các file đã đổi. Các lỗi typed-route của expo-router (`"/itinerary/new"`, `"/saved"`…) là do kiểu route sinh ra đã cũ, không liên quan commit này. |
| e2e (`pnpm test:e2e`) | ❌ **Chưa chạy**: cần Postgres đã migrate và `apps/backend/.env`. Hai file e2e bị sửa (`web-places.e2e-spec.ts`) mới chỉ được kiểm tra kiểu. |
| `apps/web` | Không dùng `PlaceListItem` / `ItineraryPlaceSnapshot`, không bị ảnh hưởng. |

## Từng thay đổi

### 1. Migration `1792022400000-AddPlaceAddress.ts` — ✅ OK

- `ALTER TABLE places ADD COLUMN address text` (nullable), `down` drop cột. An toàn, không khóa bảng lâu (cột nullable không default).
- Timestamp `1792022400000` = 2026-10-15T00:00Z, lớn hơn migration trước (`1759600000000`), thứ tự chạy đúng.
- Entity `Place.address` khớp (`text`, nullable).

### 2. Schema Gemini (`chat-models/schema.ts`) và prompt — ⚠️ Trường trùng lặp

- Schema **đã có sẵn** `address` ở cấp ngoài (dùng để tra Google ở `web-places.service.ts:229`). Commit thêm `location.address` cùng nghĩa, và prompt yêu cầu điền cả hai.
- Hệ quả:
  - Gemini phải sinh thêm một chuỗi cho mỗi địa điểm (tối đa 40), tức tốn token đầu ra và thời gian. Pipeline đang tối ưu độ trễ (`thinkingLevel: 'LOW'`, đã bỏ `tags` vì lý do này).
  - Hai trường có thể khác nhau. Code chỉ dùng `location.address` khi `address` rỗng (`web-places.service.ts:182`), nên trường mới gần như chỉ là dự phòng.
- **Khuyến nghị:** bỏ `location.address` và dùng `address` có sẵn (đổi `.describe` nếu muốn nhấn mạnh "không đoán"). Khi đó revert phần sửa fixture trong `place-search.service.spec.ts` và `web-places.e2e-spec.ts`.

### 3. Kiểm chứng địa chỉ — ⚠️ Rủi ro chất lượng dữ liệu

- `web-grounding.ts` chỉ giữ địa điểm có **tên** xuất hiện trong bài viết. **Địa chỉ không được kiểm tra**: nếu Gemini "đoán" địa chỉ (dù prompt cấm), app vẫn lưu và hiển thị nó như dữ liệu thật, không có nhãn "gần đúng" như tọa độ AI.
- `COALESCE($n, address)` khi refresh làm địa chỉ sai, một khi đã lưu, **không bao giờ bị xóa**, chỉ bị ghi đè khi bài mới có địa chỉ khác.
- **Khuyến nghị:** trước khi lưu, kiểm tra địa chỉ có xuất hiện trong bài đã dẫn (dùng `searchKey` để bỏ dấu, như cách grounding tên), không khớp thì để `null`. Có thể tái dùng logic trong `web-grounding.ts`.

### 4. `region-place-store.ts` — ✅ Đúng, vài điểm nhỏ

- Ba đường ghi (cập nhật dòng đã có theo `google_place_id`, nâng cấp dòng AI thành Google, chèn mới với tọa độ Google hoặc AI) đều thêm `address`, và chỉ số tham số `$n` đã được đánh lại đúng.
- Dòng `source = 'google'` (do người dùng lưu từ Google) dùng chung `google_place_id`: `CASE WHEN source = 'web'` giữ `address` của nó nguyên `NULL`. Đúng PRD.
- Nhỏ:
  - `SELECT id, source` lấy `source` nhưng code TS không dùng (SQL đã tự xử lý bằng `CASE`). Bỏ `source` và kiểu kèm theo.
  - Theo quy ước trong `CLAUDE.md` ("Cast untyped parameters explicitly"), nên viết `$5::text`, `$6::text`, `$7::text` trong `COALESCE` / `CASE`. Hiện Postgres vẫn suy ra được kiểu `text` từ cột `address`, nên chưa lỗi.

### 5. `web-places.service.ts` — ✅ OK

- `place.address.trim() || place.location.address.trim() || null` an toàn vì cả hai đều là `string` bắt buộc trong schema Zod (structured output và agent dùng cùng `WebPlaces`).
- `toItem` trả `address` cho danh sách vùng. Dòng Google dùng chung thì `address` là `NULL`, đúng.

### 6. `places.service.ts` (`GET /places/:id`) — ✅ OK

- SELECT thêm `p.address`; `toListItem` trả `null` cho `source = 'google'`. `p.source` đã có sẵn trong SELECT.

### 7. Lịch trình: `google-coordinates.ts` → `withItineraryPlaceData` — ✅ Logic đúng

- Truy vấn giờ lấy **mọi** địa điểm của lịch trình (trước chỉ lấy `location_source = 'google'`). Điều kiện `location_source = 'google'` được chuyển vào `CASE` của lat/lng, nên:
  - tọa độ chỉ bị ghi đè cho dòng có tọa độ Google (giữ đúng hành vi cũ: hết hạn thì `null`);
  - dòng OSM / AI giữ tọa độ trong ảnh chụp;
  - địa chỉ lấy từ `places` (mới nhất), dự phòng bằng ảnh chụp; dòng `source = 'google'` luôn `null`.
- Lịch trình tạo trước commit (ảnh chụp không có `address`) vẫn có địa chỉ khi đọc. Tốt.
- Đã kiểm tra: mọi đường trả lịch trình (`create`, `get`, `update`, `moveToGroup` đều qua `respond()`, cộng trang công khai `share-links`) đều gọi hàm này.
- Nhỏ:
  - Hàm đã đổi tên nhưng file vẫn là `google-coordinates.ts`. Nên đổi thành `itinerary-place-data.ts` (và cập nhật README).
  - Chi phí truy vấn tăng nhẹ (thêm dòng web/OSM), không đáng kể.

### 8. Snapshot (`scheduler.ts`, `retime.ts`, `itineraries.service.ts`) — ✅ OK, lưu ý tài liệu

- `toCandidate` đặt `address = null` cho dòng Google, nên JSONB không bao giờ chứa địa chỉ Google.
- Dòng web thì địa chỉ **được lưu vào JSONB** lúc tạo / sửa, **và** được điền lại khi đọc. Comment trong `shared-types/itinerary.ts` ("được điền từ bản ghi places khi đọc lịch trình") chỉ mô tả một nửa. Không sai về chức năng, nhưng nên ghi rõ là ảnh chụp chỉ dùng làm dự phòng.

### 9. `shared-types` — ⚠️ Không nhất quán nhỏ

- `PlaceListItem.address: string | null` là bắt buộc, còn `Place.address?` và `ItineraryPlaceSnapshot.address?` là tùy chọn. Với snapshot thì hợp lý (dữ liệu cũ), nhưng nên thống nhất ý đồ.
- Thay đổi tương thích ngược với client cũ: chỉ thêm trường.

### 10. Mobile — ✅ OK, một điểm UX

- `itinerary/[id].tsx`: hiện địa chỉ dưới tên điểm dừng (`Type.footnote`, màu phụ). Gọn, đúng design system.
- `place/[id].tsx`: hàng icon `pin` + địa chỉ. Icon `pin` có trong `icon.tsx`, `Spacing.one` có sẵn.
- ⚠️ **Có thể hiện hai địa chỉ:** với địa điểm web đã ghép Google, phần nội dung Google (`google-place-content.tsx:37`) cũng hiện `content.address`. Người dùng có thể thấy hai địa chỉ khác nhau trên cùng màn. Gợi ý: ẩn địa chỉ của Rong khi `google.address` có giá trị, hoặc ngược lại hiện địa chỉ Rong chỉ khi `googleStatus !== 'ok'`. Cả hai cách đều giữ được yêu cầu PRD là tách Google khỏi dữ liệu của app.
- Danh sách vùng (`place-row.tsx`) chưa hiện địa chỉ. Không bắt buộc, chỉ lưu ý nếu muốn hiện.

### 11. README module — ✅ Đã cập nhật đúng

Đã mô tả `places.address` và hành vi đọc lịch trình. Nếu đổi tên file ở mục 7 thì sửa lại tham chiếu.

## Thiếu sót

1. ⏳ **Dữ liệu hiện có (chờ quyết định):** các vùng đã có danh sách sẽ có `address = NULL` cho tới lần làm mới (`WEB_PLACES_REFRESH_DAYS` = 30 ngày). Nếu muốn có ngay, cần chạy lại pipeline cho các vùng đó (tốn tiền Tavily / Gemini), hoặc chấp nhận để dữ liệu tự đầy dần.
2. ✅ **Không có test mới cho hành vi chính.** Đã thêm ở `661a1fc`:
   - unit `itinerary-place-data.spec.ts` (8 test) cho `withItineraryPlaceData`: dòng Google trả `address: null`; dòng web lấy địa chỉ từ DB; ảnh chụp cũ không có `address` vẫn được điền; tọa độ Google còn hạn / hết hạn; dòng AI và OSM giữ tọa độ ảnh chụp; không truy vấn khi không có địa điểm.
   - e2e `web-places.e2e-spec.ts` (5 test): lưu `address`; làm mới với `address: null` giữ địa chỉ cũ, có địa chỉ mới thì ghi đè; dòng AI nâng cấp lên Google giữ địa chỉ; dòng `source = 'google'` không nhận địa chỉ; pipeline bỏ địa chỉ không có trong bài, và `GET /places/:id` trả địa chỉ.
3. ⏳ **e2e chưa chạy:** máy chưa có Postgres (cổng 5433) và Docker. Khi có DB, chạy `pnpm migration:run` rồi `npx vitest run --config vitest.config.e2e.ts test/web-places.e2e-spec.ts`.
4. ✅ **Test có sẵn đang đỏ** do `15dab89`: đã sửa ở `bd19748`.

## Danh sách việc đề xuất (theo ưu tiên)

| # | Mức | Việc | Trạng thái |
| --- | --- | --- | --- |
| 1 | Trung bình | Kiểm chứng địa chỉ có trong bài viết trước khi lưu (mục 3). | ✅ `1cedf19`: `groundedAddress` trong `web-grounding.ts` giữ địa chỉ chỉ khi phần số nhà + đường có trong một bài đã nhắc địa điểm, không thì `NULL`. Có thêm 4 unit test. |
| 2 | Trung bình | Bỏ `location.address` trùng lặp trong schema và prompt (mục 2). | ✅ `d8399bd` |
| 3 | Trung bình | Thêm test cho `withItineraryPlaceData` và luồng lưu `address`, rồi chạy e2e (Thiếu sót 2–3). | ✅ Đã thêm test (`661a1fc`). ⏳ e2e chưa chạy vì chưa có DB. |
| 4 | Thấp | Tránh hiện hai địa chỉ trên màn chi tiết (mục 10). | ✅ `5c51795`: chỉ hiện địa chỉ từ bài viết khi phần Google Maps không có địa chỉ. |
| 5 | Thấp | Sửa test `place-search.service.spec.ts` đang đỏ do `15dab89`. | ✅ `bd19748`: test chấp nhận hậu tố `năm <năm>` (truy vấn có năm là chủ ý). |
| 6 | Thấp | Cast `$n::text`; bỏ `source` không dùng trong `region-place-store.ts` (mục 4). | ✅ `dfb6a13` |
| 7 | Thấp | Đổi tên file `google-coordinates.ts`; làm rõ comment về snapshot `address` (mục 7–8). | ✅ `ee48d72`: đổi thành `itinerary-place-data.ts`. Các plan cũ trong `docs/superpowers/plans/` vẫn nhắc tên cũ, giữ nguyên vì là tài liệu lịch sử. |

Ngoài danh sách, hai gợi ý ở mục 9 (thống nhất `address` bắt buộc / tùy chọn trong `shared-types`) và mục 10 (hiện địa chỉ trên danh sách vùng) chưa làm. Cả hai không bắt buộc.

### Kiểm chứng sau khi sửa

| Kiểm tra | Kết quả |
| --- | --- |
| `vitest run` backend (unit) | ✅ 279/279 |
| `tsc --noEmit` `shared-types` và backend | ✅ Không lỗi |
| `oxlint --type-aware` | ✅ Chỉ còn cảnh báo có từ trước ở `itineraries.service.ts:513` |
| `tsc --noEmit` mobile, file `place/[id].tsx` | ✅ Không lỗi |
| e2e | ⏳ Chưa chạy (chưa có DB) |
