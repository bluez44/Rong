# Thời tiết theo ngày của chuyến đi — thiết kế

> **Trạng thái (2026-10-22):** đã duyệt từng phần trong buổi brainstorm; chờ người dùng đọc lại bản viết trước khi viết plan.

## Mục tiêu

Khi người dùng chọn ngày đi và ngày về, app cho biết thời tiết từng ngày của chuyến để họ chuẩn bị (áo mưa, áo ấm…).
Đợt này **chỉ hiển thị**: lịch trình không tự đổi theo thời tiết.

Dự báo chỉ đáng tin khoảng 7–16 ngày, trong khi người dùng hay lên lịch trước vài tuần, vài tháng. Vì vậy mỗi ngày có
một trong hai loại:

- **`forecast`**: ngày còn ≤ 16 ngày nữa, dùng dự báo thật.
- **`climate`**: ngày xa hơn, dùng khí hậu thường gặp của tháng đó (trung bình 10 năm), ghi rõ **không phải dự báo**.
  Tự chuyển sang `forecast` khi đến gần ngày.

**Thành công nghĩa là:** ở form tạo lịch trình, chi tiết lịch trình và thẻ gợi ý trang chủ, người dùng thấy nhiệt độ
cao/thấp, khả năng mưa và tình trạng của từng ngày (hoặc cả chuyến, trên thẻ), phân biệt được ngay dự báo thật với khí
hậu tham khảo; khi nguồn thời tiết lỗi, mọi màn vẫn chạy bình thường.

## Quyết định đã chốt

| Chủ đề | Quyết định |
| --- | --- |
| Nguồn dữ liệu | **Open-Meteo** (Rong là dự án phi thương mại, bản miễn phí, không cần key, CC BY 4.0). Dự báo: `api.open-meteo.com/v1/forecast`. Khí hậu: `archive-api.open-meteo.com/v1/archive` (ERA5). |
| Ngày ngoài tầm dự báo | Khí hậu theo tháng, có ghi chú. |
| Nơi hiển thị (đợt này) | Form tạo lịch trình, chi tiết lịch trình, thẻ gợi ý trang chủ. |
| Thông tin mỗi ngày | Tình trạng (icon + mô tả ngắn), nhiệt độ cao/thấp, % khả năng mưa. |
| Gọi từ đâu | Chỉ backend (gateway `modules/weather/`); app không gọi Open-Meteo trực tiếp. |
| Google Weather | Không dùng: Việt Nam thuộc vùng cấm của Google Maps Platform. |

## Ngoài phạm vi

- Tự đổi lịch hay cảnh báo khi điểm ngoài trời rơi vào ngày mưa (PRD: "tối ưu theo thời tiết thực tế").
- Dự báo theo giờ, gió, UV.
- Thời tiết trên link chia sẻ công khai (`apps/web`) và trong `trip-params-sheet`.

## Backend

### Module `modules/weather/`

Gateway duy nhất tới Open-Meteo, theo cách của `OpenDataService`: timeout 5 s, User-Agent từ `OPEN_DATA_CONTACT_EMAIL`,
throttle theo host.

- **`OpenMeteoClient`**: hai hàm thuần gọi HTTP, `forecast(lat, lng, from, to)` và `archive(lat, lng, from, to)`. Tách
  riêng để e2e thay bằng `overrideProvider`.
- **`WeatherService`**: `getRegionWeather(regionId, from, to)` và `summarizeTrip(regionId, from, to)` (cho thẻ gợi ý).
- **Tọa độ**: tâm bbox của vùng (`bbox.ts`).

### Dự báo

`daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max`, `timezone=Asia/Ho_Chi_Minh`,
tối đa 16 ngày. Cache theo (vùng, ngày) **3 giờ** trong bộ nhớ (không cần Postgres). Các request cùng vùng dùng chung
một lần gọi đang chạy.

### Khí hậu theo tháng

Lần đầu một vùng cần khí hậu, gọi archive **một lần** cho 10 năm gần nhất (`daily=temperature_2m_max,
temperature_2m_min,precipitation_sum`), tính cho từng tháng:

- `temp_max`, `temp_min`: trung bình nhiệt độ cao/thấp ngày.
- `rain_day_ratio`: tỉ lệ ngày có lượng mưa ≥ 1 mm.
- `precipitation_mm`: lượng mưa trung bình của tháng.
- `condition`: `rain` nếu `rain_day_ratio` ≥ 0,5; `cloudy` nếu ≥ 0,25; còn lại `clear`.

Lưu vào bảng mới **`region_climate`** (migration mới):

```sql
CREATE TABLE region_climate (
  region_id uuid NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
  month smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  temp_max real NOT NULL,
  temp_min real NOT NULL,
  rain_day_ratio real NOT NULL,
  precipitation_mm real NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (region_id, month)
);
```

Chạy được cho mọi vùng (tỉnh, phường/xã, vùng nhập từ Nominatim), không cần seed theo tỉnh. Đã có thì không gọi lại.

### Giới hạn lượt gọi

Bản miễn phí: 10.000 lượt/ngày, 5.000/giờ, 600/phút; một request hơn 2 tuần dữ liệu tính thành nhiều lượt.

- Dự báo: ~1–2 lượt mỗi lần gọi, tỉ lệ với số vùng được xem trong 3 giờ, không với số người dùng.
- Khí hậu: ~260 lượt mỗi vùng, **một lần duy nhất**. Giới hạn số vùng tính mới mỗi ngày bằng
  `WEATHER_CLIMATE_DAILY_LIMIT` (mặc định 25, đếm trong bộ nhớ như giới hạn của admin refresh). Quá giới hạn: ngày xa
  của vùng đó tạm không có dữ liệu.
- Script `pnpm weather:warm-climate` (chạy tay) lấp khí hậu cho 34 tỉnh, dừng khi chạm giới hạn ngày; chạy lại hôm
  sau để làm tiếp.

### Cấu hình

Thêm vào `src/config/configuration.ts` và `.env.example`:

- `WEATHER_ENABLED` (mặc định `true`): `false` thì endpoint luôn trả `unavailable`, thẻ gợi ý `weather: null`.
- `WEATHER_CLIMATE_DAILY_LIMIT` (mặc định `25`).

### API

`GET /api/regions/:id/weather?from=YYYY-MM-DD&to=YYYY-MM-DD` (cần đăng nhập như mặc định). Khoảng ngày tối đa 14 ngày
(`MAX_TRIP_DAYS`).

Kiểu trong `packages/shared-types/src/weather.ts`:

```ts
export type WeatherCondition = 'clear' | 'partly_cloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'storm';

export interface WeatherDay {
  date: string;                 // YYYY-MM-DD, giờ Việt Nam
  kind: 'forecast' | 'climate';
  condition: WeatherCondition;
  tempMax: number;              // °C, làm tròn
  tempMin: number;
  /** forecast: % khả năng mưa; climate: % số ngày mưa trong tháng. */
  rainChance: number | null;
}

export interface RegionWeather {
  regionId: string;
  status: 'ready' | 'unavailable';
  days: WeatherDay[];
  attribution: 'Open-Meteo.com';
}

/** Tóm tắt cả chuyến, cho thẻ gợi ý. */
export interface TripWeatherSummary {
  kind: 'forecast' | 'climate' | 'mixed';
  condition: WeatherCondition;
  tempMin: number;
  tempMax: number;
  rainChance: number | null;
}
```

Quy tắc:

- Ngày `d` là `forecast` nếu `d − hôm nay (giờ VN) ≤ 15` (16 ngày tính cả hôm nay), ngược lại `climate`.
- Ngày đã qua bị bỏ khỏi `days`.
- Mã WMO `weather_code` → `condition`: 0–1 `clear`, 2 `partly_cloudy`, 3 `cloudy`, 45–48 `fog`, 51–57 `drizzle`,
  61–67 và 80–82 `rain`, 95–99 `storm`; mã khác (tuyết 71–77, 85–86) → `cloudy`.
- `summarizeTrip`: `condition` xuất hiện nhiều nhất, nhưng có ngày `rain`/`storm` thì lấy loại nặng nhất trong đó;
  `tempMin`/`tempMax` là min/max của cả chuyến; `rainChance` là giá trị lớn nhất; `kind` là `mixed` khi có cả hai loại.

`RecommendationCard.weather` đổi từ `null` thành `TripWeatherSummary | null`, điền ở `recommendations.service.ts` khi
dựng feed (dùng cùng cache; lỗi thì `null`).

### Xử lý lỗi

| Tình huống | Trả về |
| --- | --- |
| Open-Meteo lỗi, quá 5 s, hoặc `WEATHER_ENABLED=false` | `200 { status: 'unavailable', days: [] }` |
| Có dự báo nhưng thiếu khí hậu (hết quota, archive lỗi) | `200 ready`, chỉ các ngày `forecast` |
| `from`/`to` sai định dạng, `to < from`, quá 14 ngày | `400 INVALID_DATES` |
| Vùng không tồn tại | `404 REGION_NOT_FOUND` |
| Lỗi khi tóm tắt cho thẻ gợi ý | `weather: null`, ghi log |

Thời tiết là thông tin phụ: không bao giờ làm hỏng hay chặn việc tạo lịch trình, xem lịch trình hay feed gợi ý.

## Mobile

### Dùng chung

- **`hooks/use-region-weather.ts`**: `useRegionWeather(regionId, from, to)`, debounce ~400 ms khi đổi ngày; lỗi thì trả
  `null`, không hiện lỗi.
- **`components/weather-day-chip.tsx`**: thứ + ngày, icon, `24°/17°`, `💧 60%`. Ngày `climate`: viền đứt, màu nhạt
  hơn, nhiệt độ có `~` (`~24°/17°`), mưa ghi "hay mưa" (`rainChance` ≥ 50) hoặc "ít mưa".
- Map `condition` → `Icon` (nắng, nắng có mây, mây, sương mù, mưa phùn, mưa, giông) và mô tả tiếng Việt ("Nắng",
  "Mưa rào"…). Thiếu icon thì thêm vào bộ `Icon`.
- Dòng ghi nguồn nhỏ "Dữ liệu thời tiết: Open-Meteo" ở mọi chỗ hiện dải chip hoặc sheet chi tiết.

### Form tạo lịch trình (`app/(app)/itinerary/new.tsx`)

Trong section "Thời gian", dưới hai ô "Bắt đầu"/"Kết thúc": dải chip cuộn ngang, mỗi ngày của chuyến một chip.

- Có ngày `climate`: thêm dòng *"Ngày còn xa: nhiệt độ và mưa thường gặp trong tháng, không phải dự báo. Dự báo có khi
  còn ≤ 16 ngày."*
- Đang tải: chip skeleton. `unavailable` hoặc lỗi: ẩn cả dải, không chừa chỗ.

### Chi tiết lịch trình (`components/itinerary-view/itinerary-view.tsx`)

Cuối tiêu đề mỗi ngày (`Ngày 1 • T7, 25/10`): icon + `24°/17°` (`climate`: có `~`, màu nhạt). Bấm mở sheet nhỏ: mô tả,
khả năng mưa, giải thích dự báo hay khí hậu, nguồn. Ngày đã qua không hiện gì.

### Thẻ gợi ý trang chủ (`components/recommendation-card.tsx`)

Ô "Chi phí · Thời tiết / Đang cập nhật" thành:

- Icon theo `weather.condition` (thay icon `sun` cố định).
- Nhãn "Thời tiết", giá trị `24°/17° · Mưa rào`; `climate`/`mixed` có `~` và mô tả kiểu "Hay mưa".
- `weather: null` → giữ "Đang cập nhật". Chữ "Chi phí" bỏ khỏi nhãn cho đến khi có F7.

## Kiểm thử

**Unit (vitest, backend):**

- Map mã WMO → `condition`.
- Chia `forecast`/`climate` theo mốc 16 ngày giờ VN, bỏ ngày đã qua, ranh giới ngày 15/16.
- Tổng hợp khí hậu tháng từ dữ liệu ngày (trung bình nhiệt, tỉ lệ ngày mưa ≥ 1 mm, `condition`).
- `summarizeTrip` (ưu tiên mưa/giông, min/max, `mixed`).
- Đếm giới hạn khí hậu theo ngày.

**e2e (`test/weather.e2e-spec.ts`, `OpenMeteoClient` thay bằng `overrideProvider`):**

- Khoảng ngày vắt qua mốc 16 ngày → kết quả hỗn hợp.
- Client ném lỗi → `unavailable`.
- `INVALID_DATES`, `REGION_NOT_FOUND`.
- Khí hậu chỉ gọi archive một lần; lần sau đọc `region_climate`.
- `recommendations.e2e-spec.ts`: `weather` được điền khi có dữ liệu, `null` khi client lỗi.

**Mobile:** typecheck, lint; kiểm tra tay trên Android với chuyến trong 16 ngày, chuyến hơn một tháng sau, và chuyến
vắt qua mốc 16 ngày; tắt mạng backend tới Open-Meteo (`WEATHER_ENABLED=false`) để thấy các màn ẩn thời tiết gọn.

## Tài liệu cần cập nhật khi làm

- `src/modules/README.md`: thêm `modules/weather`.
- `CLAUDE.md` (gốc): thêm Open-Meteo vào bảng gateway.
- Spec trang chủ (`2026-10-19-home-recommendations-design.md`): ghi chú `weather` không còn là placeholder.
