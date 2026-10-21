# Tìm xã/phường và danh sách địa điểm đầy đủ hơn — thiết kế

Ngày: 2026-10-21. PRD: F1 (tìm điểm đến, FR-1.1), F2 (danh sách địa điểm), mục 7.5 (pipeline).

## Mục tiêu

1. Tìm được **mọi xã/phường/đặc khu** của Việt Nam sau sáp nhập, kể cả khi gõ không dấu. Ví dụ "Phước Hải", "Long Hải" (Vũng Tàu cũ, nay thuộc TP.HCM) hiện không tìm được.
2. Mỗi vùng mở ra có **ít nhất 10 địa điểm** khi nguồn bài viết cho phép.
3. Gemini đọc được **đủ các mục** của bài viết dạng "Top N", thay vì chỉ 2.500 ký tự đầu.

**Thành công khi:**
- Gõ "phuoc hai", "Phước Hải" hoặc "long hai" thì kết quả đầu là xã tương ứng thuộc TP.HCM, ra ngay khi đang gõ, không gọi Nominatim.
- Mở "Xã Phước Hải" thì danh sách là quán, bãi biển, homestay ở chính Phước Hải.
- Danh sách của một vùng có từ 10 địa điểm, trừ khi sau 2 lượt tìm vẫn không đủ.

## Hiện trạng (database dev, 2026-10-21)

- `regions` có 52 tỉnh cũ, 34 tỉnh mới, 27 điểm đến; **không có xã/phường nào**. Cấp xã hoàn toàn trông vào Nominatim khi bấm tìm (`online=1`).
- Gọi thẳng Nominatim (`countrycodes=vn`):

| Từ khóa | Kết quả |
| --- | --- |
| `Phước Hải` | Một cây xăng ở TP.HCM |
| `xã Phước Hải` | Không có gì |
| `Phuoc Hai` | **Xã Phước Hải, TP.HCM** (boundary, `addresstype=town`) |
| `Long Hải`, `Xã Long Hải` | Rác hoặc không có gì |

  OSM có dữ liệu, nhưng Nominatim xử lý chữ Việt có dấu kém.
- `region_search_misses` có `phước Hải`, bị khớp nhầm thành "Hải Phòng".
- Pipeline địa điểm cắt mỗi bài còn 2.500 ký tự đầu (`MAX_ARTICLE_CHARS`), và đọc tối đa 16 bài mỗi lượt (4 câu tìm × 4 bài).

## Quyết định đã chốt

| Vấn đề | Quyết định |
| --- | --- |
| Nguồn xã/phường | Seed toàn bộ 3.321 đơn vị cấp xã từ **thanglequoc/vietnamese-provinces-database** (MIT, bản v5.2.0, theo QĐ 19/2025/QĐ-TTg, dữ liệu gốc từ Tổng cục Thống kê) |
| Khung bao xã | Tính từ **bản GeoJSON** của cùng bộ dữ liệu, bằng script chạy một lần, commit kết quả |
| Mở một xã | Xã là **vùng đầy đủ, có danh sách địa điểm riêng**, dựng lần đầu khi có người mở |
| Nominatim | Vẫn dùng cho địa danh không phải đơn vị hành chính; thử thêm bản không dấu; **không nhập xã/phường** từ Nominatim |
| Tối thiểu địa điểm | **10**; chưa đủ thì chạy **lượt 2**; sau 2 lượt vẫn thiếu thì **lưu những gì có được** |
| Cắt bài viết | **Rút gọn theo cấu trúc bài** (giữ mọi tiêu đề mục), thay cắt cứng 2.500 ký tự |
| Giới hạn 40 địa điểm (`MAX_PLACES`) | **Giữ nguyên** |

## Ngoài phạm vi

- Tên cũ trước sáp nhập (huyện cũ như "Long Điền", xã cũ đã đổi tên); ánh xạ cũ → mới.
- Gõ sai kiểu Telex ("când thiw").
- API tìm địa danh thương mại (Goong, Vietmap, TrackAsia).
- Nới lề khung bao 0,02° cho tọa độ AI.

---

## 1. Dữ liệu xã/phường và seed

### 1.1 Script sinh dữ liệu `apps/backend/scripts/generate-ward-seed.ts`

Chạy tay, giống `scripts/generate-province-bboxes.ts`:

- **Đầu vào:** bản phát hành của thanglequoc/vietnamese-provinces-database (mặc định v5.2.0, có thể chỉ định phiên bản):
  - `json/simplified_json_generated_data_vn_units.json`: tỉnh và xã, gồm mã, tên, tên đầy đủ, mã tỉnh.
  - `json/vn_provinces_wards_geojson.zip`: ranh giới xã.
- **Đầu ra:** `apps/backend/src/modules/regions/seed/vietnam-wards.json`:

```jsonc
{
  "source": "thanglequoc/vietnamese-provinces-database v5.2.0 (MIT)",
  "version": "v5.2.0",
  "wards": [
    {
      "code": "26560",              // mã xã theo Tổng cục Thống kê
      "name": "Phước Hải",          // tên ngắn
      "fullName": "Xã Phước Hải",   // tên đầy đủ, hiển thị
      "provinceCode": "79",
      "formerProvinceKey": "ba-ria-vung-tau", // khóa tỉnh cũ trong vietnam-admin.ts, null nếu không xác định
      "center": [10.43, 107.53],    // [vĩ độ, kinh độ]
      "bbox": [10.39, 107.47, 10.47, 107.58] // [nam, tây, bắc, đông]
    }
  ]
}
```

(Giá trị trong ví dụ là minh họa.)

- **Tính toán:**
  - `bbox` là min/max tọa độ của mọi vòng ngoài của `Polygon`/`MultiPolygon`.
  - `center` là tâm của `bbox` (đủ cho bản đồ và gợi ý; không cần trọng tâm hình học).
  - Tọa độ làm tròn 5 chữ số thập phân.
  - **`formerProvinceKey`:** trong các tỉnh cũ thuộc `mergedFrom` của tỉnh mới, chọn tỉnh có khung bao (`PROVINCE_BBOXES`) chứa `center`; nhiều tỉnh cùng chứa thì chọn khung nhỏ nhất. Tỉnh mới không do sáp nhập thì để `null`.
  - Ánh xạ mã tỉnh của bộ dữ liệu sang khóa tỉnh mới trong `vietnam-admin.ts` theo tên đã bỏ dấu. Tỉnh nào không khớp thì **script dừng và báo lỗi**, không sinh file thiếu.
  - Xã không có ranh giới trong GeoJSON: vẫn ghi, `center` và `bbox` để `null`. Script in danh sách các xã này. `RegionAreaService.ensure` sẽ tự tìm khung bao khi xã đó được mở, như vùng chưa có bbox hiện nay.
- **Kiểm tra cuối:** script in tổng số xã (kỳ vọng 3.321) và số xã thiếu ranh giới.
- Khi Chính phủ đổi địa giới: tăng phiên bản nguồn, chạy lại script, commit.

### 1.2 Seed khi khởi động (`RegionSeeder`)

- Mỗi xã thành một dòng `regions`:
  - `source_key = 'vn:ward:<code>'`
  - `name = fullName`
  - `type = 'administrative'`, `level = 'ward'`, `boundary_version = 'current'`
  - `parent_id` = tỉnh mới, `former_parent_id` = tỉnh cũ theo `formerProvinceKey`
  - `search_name = searchKey(fullName)`, kèm `center` và bbox
- **Bí danh:** `name` (tên ngắn) vào `region_aliases`, nên "phuoc hai" khớp đúng (điểm 1,0 − 0,02).
- **Hiệu năng:** upsert hàng loạt bằng `unnest` trong một câu SQL cho `regions`, một câu cho `region_aliases`. Lưu phiên bản dữ liệu đã seed (`version` trong file) vào một bảng hoặc khóa cấu hình; **bỏ qua cả bước** khi phiên bản trong database trùng phiên bản trong file.
- Index trigram trên `regions.search_name` và `region_aliases.search_alias` đã có, nên **không cần migration** nếu dùng được chỗ lưu phiên bản có sẵn. Nếu cần bảng nhỏ `seed_versions (key PK, version, applied_at)` thì thêm một migration.

## 2. Luồng tìm kiếm và tên dùng cho pipeline

### 2.1 Xếp hạng

- Truy vấn danh mục (`RegionsService.match`) giữ nguyên. Khớp đúng bí danh tên ngắn cho điểm khoảng 0,98, vượt `GOOD_ENOUGH` (0,8), nên không gọi Nominatim.
- Thứ tự nhóm giữ như hiện nay (`GROUP_RANK`): tỉnh → điểm đến → xã/phường. "vung tau" thì điểm đến Vũng Tàu đứng trên "Phường Vũng Tàu".
- Nhiều xã trùng tên ở các tỉnh khác nhau thì hiện tất cả, kèm tỉnh, tối đa 10 kết quả (`MAX_RESULTS`).

### 2.2 Nominatim

Chỉ chạy khi danh mục không có kết quả ≥ `GOOD_ENOUGH`, như hiện nay.

- **Biến thể câu tìm** (`nominatimQueries(query)`): câu gốc → bản không dấu, đã bỏ tiền tố "xã / phường / thị trấn / đặc khu". Bỏ trùng; tối đa 2 câu. Dừng ở câu đầu tiên trả ít nhất một kết quả hợp lệ (qua bộ lọc `ACCEPTED_ADDRESS_TYPES`).
- **Không nhập xã/phường:** bỏ kết quả có tên mà `isWardName` nhận ra (xã/phường/thị trấn/đặc khu), vì seed đã có đủ. Kết quả khác (Hồ Tràm, Bãi Sau…) vẫn nhập làm `destination`.
- Nominatim vẫn đi qua `OpenDataService` (giới hạn 1 request/giây theo host). Một lượt tìm tối đa 2 request.

### 2.3 Tên vùng gửi pipeline địa điểm

`WebPlacesService.regionName` hiện trả `"<tên>, <tỉnh cha>"`. Với `level = 'ward'`:
- dùng `"<tên ngắn>, <tên tỉnh cũ>"`, ví dụ "Phước Hải, Bà Rịa - Vũng Tàu", vì bài viết du lịch phần lớn dùng tên trước sáp nhập;
- không có tỉnh cũ thì `"<tên ngắn>, <tên tỉnh mới>"`.

Tên ngắn là bí danh do seed tạo; không có thì bỏ tiền tố xã/phường khỏi `name`. Màn hình vẫn hiện tên đầy đủ kèm tỉnh mới. Tên này cũng dùng cho kiểm chứng tên (`nameVariants` cắt đuôi tên vùng) và câu ghép Google.

## 3. Tối thiểu 10 địa điểm mỗi vùng

### 3.1 Đếm

Ngưỡng tính trên số địa điểm **được lưu**, tức đã qua mọi bước:
1. Gemini chọn (vẫn tối đa 40, `MAX_PLACES`).
2. Kiểm chứng tên (`articlesMentioning`).
3. Xác định vị trí trong khung bao (`locate` + `insideBbox`).

Ngưỡng lấy từ env `WEB_PLACES_MIN_COUNT` (mặc định 10), khai báo trong `configuration.ts` và `.env.example`.

### 3.2 Lượt 2

Khi lượt 1 lưu được ít hơn ngưỡng:
- Gọi agent có sẵn (`createAgent` + `search_web`, tối đa 3 lần tìm). Prompt gồm:
  - các bài đã đọc ở lượt 1;
  - **danh sách tên đã có**, yêu cầu không lặp lại;
  - yêu cầu tìm thêm địa điểm khác **trong đúng khu vực**, gợi ý truy vấn theo loại hình (bãi biển, thác, chùa, chợ, nhà hàng hải sản, homestay…) và tên gọi khác của khu vực (gồm tên tỉnh cũ).
- Địa điểm mới đi qua đúng các bước 2–3 ở §3.1. Kiểm chứng dùng **tất cả bài của cả hai lượt**.
- **Gộp:** trùng tên (so sau `normalizeForMatch`) thì giữ bản lượt 1. Thứ tự: lượt 1 trước, lượt 2 sau. Tổng vẫn tối đa 40.
- Tối đa **2 lượt**; không bao giờ chạy lượt 3.
- Lượt 1 có thể đã dùng agent (khi ít hơn 3 bài); lượt 2 vẫn chạy agent thêm một lần với danh sách loại trừ.

### 3.3 Kết quả cuối

- Sau 2 lượt có ít nhất 1 địa điểm: **lưu**. Nếu dưới ngưỡng thì ghi log cảnh báo kèm số lượng.
- 0 địa điểm: `PLACES_UNAVAILABLE` như hiện nay.
- **Khi làm mới (danh sách quá `WEB_PLACES_REFRESH_DAYS`):** nếu danh sách mới dưới ngưỡng **và** ít hơn danh sách cũ thì giữ danh sách cũ (gia hạn như khi làm mới lỗi) và ghi log.

### 3.4 Chi phí và thời gian

Lượt 2 chỉ chạy khi thiếu: thêm tối đa 3 lần tìm Tavily và vài lượt gọi Gemini, khoảng 10–20 giây. Lần mở đầu vẫn chờ tối đa `WEB_PLACES_WAIT_MS` (25 s) rồi trả `building`; app tự hỏi lại.

## 4. Rút gọn bài viết theo cấu trúc

Thay `truncate` trong `src/langchain/web-search.ts` bằng `condenseArticle(markdown)` ở file riêng `src/langchain/article-condense.ts`. Đầu vào là markdown đã bỏ ảnh (`stripImages`), như hiện nay.

### 4.1 Phân loại dòng

| Loại | Nhận biết | Xử lý |
| --- | --- | --- |
| Tiêu đề mục | `#`…`######`; dòng in đậm có số `**1. Tên**` / `**1) Tên**`; dòng danh sách có số `1. Tên` / `1) Tên` dài dưới 120 ký tự | Luôn giữ, tối đa 150 ký tự/dòng |
| Dòng rác | Link markdown chiếm hơn 60% ký tự của dòng; dưới 3 ký tự; trùng một dòng trước (sau `normalizeForMatch`); chứa cụm rác: "xem thêm", "chia sẻ", "đăng ký nhận", "bản quyền", "©", "cookie", "theo dõi chúng tôi" | Bỏ |
| Mục rác | Tiêu đề khớp "bài viết liên quan", "có thể bạn quan tâm", "bình luận", "tin mới nhất", "tin liên quan", "bài viết mới" | Bỏ tiêu đề và mọi dòng tới tiêu đề kế tiếp |
| Nội dung | Còn lại | Theo ngân sách §4.2 |

### 4.2 Ngân sách

- Mở bài (trước tiêu đề đầu): tối đa 600 ký tự.
- Mỗi mục: tiêu đề + tối đa **400 ký tự** nội dung, cắt ở cuối câu hoặc cuối từ.
- **Trần 12.000 ký tự mỗi bài.** Vượt thì giảm đều ngân sách nội dung mọi mục, tối thiểu 120 ký tự/mục; **không cắt tiêu đề**. Riêng các tiêu đề đã vượt trần thì chỉ giữ tiêu đề tới trần.
- **Bài không có cấu trúc** (dưới 3 tiêu đề): 6.000 ký tự đầu của nội dung đã lọc rác.
- Hằng số đặt đầu file, có comment lý do.

### 4.3 Những chỗ dùng bản rút gọn

- `WebSource.content`: prompt lượt 1, công cụ `search_web` của agent.
- Kiểm chứng tên và địa chỉ (`articlesMentioning`, `groundedAddress`) vẫn so trên đúng nội dung Gemini đã đọc.
- Ảnh vẫn trích từ `raw_content` đầy đủ (`extractImages`), không đổi.

### 4.4 Đo

`searchWeb` ghi log tổng ký tự trước/sau và số tiêu đề giữ được. Pipeline ghi số địa điểm qua kiểm chứng (đã có) và số lượt. So sánh bằng `pnpm bench:places` (có phí) trên vài vùng trước và sau khi đổi.

---

## 5. Kiểm thử

**Unit (vitest):**
- **Script:** bbox/tâm từ `Polygon` và `MultiPolygon`; làm tròn; chọn tỉnh cũ theo khung bao (nhiều khung chứa thì chọn nhỏ nhất); tỉnh không khớp thì báo lỗi.
- **`nominatimQueries`:** câu gốc rồi bản không dấu; bỏ tiền tố; không trùng.
- **Lọc nhập Nominatim:** bỏ xã/phường, giữ địa danh du lịch.
- **Tên vùng cho pipeline:** xã có tỉnh cũ; xã không có tỉnh cũ; tỉnh và điểm đến giữ như cũ.
- **`condenseArticle`:**
  - Bài "Top 20" dài với tiêu đề `##` giữ đủ 20 tiêu đề.
  - Các định dạng tiêu đề `**1. Tên**`, `1) Tên`.
  - Menu dạng link bị bỏ; mục "Bài viết liên quan" và "Bình luận" bị bỏ.
  - Dòng trùng bị bỏ.
  - Trần 12.000 ký tự giữ mọi tiêu đề.
  - Bài không cấu trúc lấy 6.000 ký tự.
  - Cắt ở ranh giới từ.
- **Hai lượt** (dependency giả):
  - Lượt 1 đủ ngưỡng thì không chạy lượt 2.
  - Lượt 1 được 7 thì chạy lượt 2, prompt chứa đủ 7 tên.
  - Gộp bỏ trùng không phân biệt dấu, giữ thứ tự.
  - Không có lượt 3.
  - Dưới ngưỡng thì vẫn lưu và cảnh báo; 0 địa điểm thì lỗi.
  - Làm mới ra ít hơn danh sách cũ thì giữ danh sách cũ.

**e2e (database thật, Nominatim và pipeline giả):**
- Sau seed: "phuoc hai", "Phước Hải", "long hai" ra đúng xã thuộc TP.HCM, đứng đầu, kèm tỉnh; không gọi Nominatim.
- "vung tau": điểm đến đứng trên phường.
- Khởi động lại không nhân đôi dòng; cùng phiên bản thì bỏ qua seed.
- Nominatim: câu có dấu rỗng thì gọi bản không dấu; kết quả là xã/phường thì không nhập.
- Các e2e hiện có của `region-search` và `web-places` vẫn pass.

**Kiểm tra tay sau deploy:** mở "Xã Phước Hải", "Xã Long Hải" thì danh sách có ít nhất 10 địa điểm (hoặc log ghi rõ vì sao thiếu), đúng khu vực Vũng Tàu cũ.

## 6. Rủi ro

- **Seed 3.321 dòng khi khởi động:** dùng upsert hàng loạt và bỏ qua theo phiên bản, nên khởi động thường không chậm. Lần đầu mất vài giây.
- **Tỉnh cũ đoán theo khung bao** có thể sai ở vùng giáp ranh, vì khung bao các tỉnh cũ chồng nhau. Chỉ ảnh hưởng câu tìm gửi Tavily, không ảnh hưởng địa giới hiển thị.
- **Chi phí dựng danh sách** tăng theo số xã được mở (mỗi xã một danh sách riêng, làm mới sau 30 ngày), cộng lượt 2 khi thiếu.
- **Bộ dữ liệu ngoài** (thanglequoc) có thể có sai sót. File sinh ra được commit nên mọi thay đổi đều review được qua diff.
