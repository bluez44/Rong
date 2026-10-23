# Tái cấu trúc mã nguồn mobile — thiết kế

> **Trạng thái (2026-10-23):** đã duyệt từng phần trong buổi brainstorm; chờ người dùng đọc lại bản viết trước khi viết
> plan. Mỗi đợt có plan riêng, viết khi đợt trước đã merge.

## Mục tiêu

Mã nguồn `apps/mobile` theo SOLID, ít trùng lặp, không có hàm/export thừa và comment không cần thiết, để sửa và test
dễ hơn.

**Phạm vi:** chỉ `apps/mobile`. Không đổi backend, `packages/shared-types`, `apps/web`. **Giao diện không đổi.** Hành
vi chỉ được đổi ở hai chỗ: dữ liệu hiện ngay khi mở lại màn (cache) và tải lại sau khi sửa (invalidate).

**Thành công nghĩa là** (đo ở cuối đợt 4):

- Không màn hình/component nào gọi `authFetch` hay viết đường dẫn API.
- Logic loading/error/bỏ phản hồi cũ nằm ở một chỗ (TanStack Query + `src/api/client.ts`).
- jscpd (`--min-lines 6 --min-tokens 60`, bỏ test) không còn cụm trùng nào.
- knip không còn file/export thừa (trừ ngoại lệ đã ghi trong cấu hình).
- Không file nào trong `src/` quá ~300 dòng, trừ file style và dữ liệu.
- Toàn bộ test Jest xanh (111 test lúc bắt đầu, sửa theo cách làm mới khi cần) cộng test mới cho `src/api/`, hook và
  hàm thuần tách ra.

## Hiện trạng (khảo sát 2026-10-23)

- 151 file, ~17.500 dòng. Comment ~5% (phần lớn giải thích lý do).
- `useResource` có trong `hooks/use-itineraries.ts` nhưng ≥ 7 hook tự viết lại loading/error và cơ chế `latest.current`;
  chuỗi chuyển lỗi về `ApiError` ("Có lỗi không mong muốn…") chép ở 19 file; 14 màn/component gọi `authFetch` trực tiếp.
- jscpd: 17 cặp trùng trong code app (~300 dòng), nặng nhất `login.tsx` ↔ `register.tsx` (~150 dòng).
- knip: file thừa `components/themed-view.tsx`, `hooks/use-color-scheme.ts`; 16 export thừa (`MAX_PASSWORD_LENGTH`,
  `itemTitle`, `THEME_ICONS`, `themeGradient`, `APPROXIMATE_LOCATION_NOTE`, `WeatherDayChip`, `STAGGER_MS`, `EaseOut`,
  `FontFamily`, `MaxContentWidth`, `defaultDuration`, `newId`, `locate`, `formatShortDate`, `formatDayTitle`,
  `DAY_PART_LABELS`); dependency có thể thừa `expo-device`, `expo-web-browser`. Báo nhầm: 3 file `.web.tsx` (Metro chọn
  theo nền tảng) và `@rong/shared-types`. Mỗi mục phải kiểm tra lại trước khi xóa.
- File lớn: `itinerary-view/styles.ts` 648, `itinerary-editor.tsx` 560, `itinerary-view.tsx` 557, `account.tsx` 485,
  `itinerary/new.tsx` 470, `place/[id].tsx` 459, `(tabs)/index.tsx` 454, `place/pin.tsx` 397, `group/[id].tsx` 371.
- Jest (`jest-expo`): 23 suite, 111 test, xanh. Test giả lập `useAuth().authFetch` và kiểm tra đường dẫn.

## Quyết định đã chốt

| Chủ đề | Quyết định |
| --- | --- |
| Mức độ | Tái cấu trúc sâu: lớp service API tách khỏi UI (DIP). |
| Thư viện dữ liệu | `@tanstack/react-query` v5 (peer React ^18 \|\| ^19; app dùng React 19.2). |
| Cache | `staleTime` 30 s: mở lại màn hiện dữ liệu cũ ngay rồi tải lại nền; mutation invalidate đúng key; app trở lại foreground thì tải lại query đã cũ. |
| Giao hàng | 4 đợt, mỗi đợt một PR merge độc lập; người dùng thử app giữa các đợt. |

## Đợt 1 — Nền móng (rủi ro thấp, chưa màn nào đổi)

### Code thừa

Xóa file/export/dependency knip báo (sau khi kiểm tra từng cái bằng grep). Thêm `knip` vào devDependencies với cấu
hình `knip.json` bỏ qua `**/*.web.tsx` và `@rong/shared-types`, và script `knip`; thêm script `dup` chạy jscpd với
ngưỡng trên.

### `src/api/`

```
src/api/
  client.ts          # type Fetcher; toApiError(error): ApiError (thay 19 bản chép); UNKNOWN_ERROR_MESSAGE
  itineraries.ts     # list, get, create, update, remove, shareLink (get/put/post), alternatives, setGroup…
  places.ts          # detail, notes, user pins (create/update), google preview/save, reverseGeocode
  regions.ts         # search, places, placeSearch, weather
  groups.ts          # list, get, create, members, invites, removeItinerary…
  recommendations.ts # feed, draft, save
  saved-places.ts    # list, add, remove
  share-imports.ts   # create, get, list, save
  users.ts, visits.ts, invites.ts
  index.ts           # createApi(fetcher) gom mọi module; useApi()
  query-keys.ts      # qk: mọi query key
  query-client.ts    # createQueryClient(): mặc định + AppState focusManager
```

- `type Fetcher = <T>(path: string, options?: Omit<RequestOptions, 'token'>) => Promise<T>` — đúng chữ ký `authFetch`.
- Mỗi module là `(f: Fetcher) => ({ … })`, hàm thuần, không import React hay `useAuth`. Đường dẫn và kiểu trả về giữ
  y như các lời gọi hiện có (lấy từ code, không đoán).
- `useApi()` = `useMemo(() => createApi(authFetch), [authFetch])`. Cơ chế làm mới token / 401 vẫn nằm trong `authFetch`.
- Các lời gọi `apiFetch` không cần đăng nhập (`/auth/*`, `invites/:token` preview) vẫn đi qua `apiFetch`, không vào
  `useApi()`.

### Query key (`query-keys.ts`)

Theo cây để invalidate cả nhánh:

```ts
export const qk = {
  itineraries: { all: ['itineraries'], list: () => ['itineraries', 'list'], detail: (id: string) => ['itineraries', id] },
  places: { detail: (id: string) => ['places', id], google: (googlePlaceId: string) => ['places', 'google', googlePlaceId] },
  regions: {
    search: (q: string, online: boolean) => ['regions', 'search', q, online],
    places: (id: string) => ['regions', id, 'places'],
    placeSearch: (id: string, q: string) => ['regions', id, 'place-search', q],
    weather: (id: string, from: string, to: string) => ['regions', id, 'weather', from, to],
  },
  groups: { all: ['groups'], detail: (id: string) => ['groups', id] },
  savedPlaces: ['saved-places'],
  recommendations: { all: ['recommendations'], feed: (theme: string) => ['recommendations', 'feed', theme] },
  shareImports: { all: ['share-imports'], detail: (id: string) => ['share-imports', id] },
  me: ['users', 'me'],
  pendingVisits: ['visits', 'pending'],
} as const;
```

Key cụ thể của từng hook được chốt trong plan đợt 2 theo đúng tham số hook đang nhận.

### `QueryClient` (`query-client.ts`)

- `staleTime: 30_000`; `gcTime` mặc định (5 phút).
- `retry`: tối đa 2 lần, chỉ khi `ApiError.code === 'NETWORK_ERROR'` hoặc `status >= 500`; không retry 4xx.
- Mutation: `retry: false`.
- `focusManager` nối `AppState` (`active` → focused). Không thêm NetInfo (chưa có trong dự án).
- `QueryClientProvider` đặt trong `app/_layout.tsx`, bên trong `AuthProvider` (để `useApi` dùng được) và ngoài các
  provider dùng dữ liệu. Đăng xuất / hết phiên → `queryClient.clear()`.

### Test đợt 1

- `src/api/*.test.ts`: mỗi hàm gọi `Fetcher` giả đúng method, path, body.
- `client.test.ts`: `toApiError` giữ nguyên `ApiError`, bọc lỗi khác thành `UNKNOWN`.
- `query-client.test.ts`: quy tắc retry (network/5xx có, 4xx không).
- Helper test `src/test-utils/render-with-client.tsx` (QueryClient `retry: false`, `gcTime: Infinity`) cho các đợt sau.

## Đợt 2 — Dữ liệu sang TanStack Query (rủi ro cao nhất)

- Viết lại các hook `use-*` bằng `useQuery`/`useMutation` gọi `useApi()`. Giữ tên hook và hình dạng giá trị trả về
  (`{ status, data, error, reload }` với `status: 'loading' | 'refreshing' | 'done' | 'error'` suy ra từ
  `isPending`/`isFetching`/`isError`) để màn đổi ít nhất. Xóa `useResource` và mọi `latest.current`.
- Hook tìm/debounce (`use-region-search`, `use-place-search`, `use-pin-address`, `use-region-weather`) dùng chung
  `useDebouncedValue(value, ms)`; query key là giá trị đã debounce, `enabled` khi đủ điều kiện. TanStack bỏ phản hồi
  cũ theo key, nên không cần cơ chế tự viết.
- Polling bằng `refetchInterval: (query) => …` theo dữ liệu: danh sách địa điểm `building`, feed gợi ý `building`,
  share-import đang chạy; dừng khi xong.
- `SavedPlacesProvider` → query `qk.savedPlaces` + mutation thêm/bỏ (cập nhật cache lạc quan nếu hiện tại đã làm vậy,
  không thì invalidate). Giữ API `useSavedPlaces()` cho màn.
- 27 chỗ `reload()`/`refresh()` → `invalidateQueries` đúng key (sau mutation) hoặc `refetch()`; `useFocusEffect` +
  reload giữ lại dạng `refetch()` để quay về tab vẫn thấy dữ liệu mới.
- 14 màn/component gọi `authFetch` trực tiếp → dùng hook/mutation.
- Mọi lỗi query/mutation đi qua `toApiError` đúng một lần: màn luôn nhận `ApiError`.
- Test: hook bằng `renderHook` + `renderWithClient`; test màn cũ bọc provider. Thử tay Android: từng tab tải + tải lại,
  sửa/lưu lịch trình, "Muốn đi", nhóm (mời, gỡ lịch trình), share-import, ghim địa điểm, gợi ý trang chủ.

## Đợt 3 — Gộp UI trùng lặp

| Cặp trùng (jscpd) | Gộp thành |
| --- | --- |
| `(auth)/login.tsx` ↔ `(auth)/register.tsx` (6 cụm, ~150 dòng) | `components/auth/auth-form-layout.tsx` (khung, tiêu đề, vùng nút Google/Zalo, lỗi) + `hooks/use-auth-submit.ts` (submit/lỗi/loading) |
| `(tabs)/groups.tsx` ↔ `(tabs)/trips.tsx` | `components/tab-header.tsx` + `components/list-state.tsx` (loading/trống/lỗi + "Thử lại") |
| `components/points-map.tsx` ↔ `components/region-map.tsx` | `lib/map-region.ts` (hàm thuần tính region bao điểm, có unit test) |
| `itinerary/day-map.tsx` ↔ `place/pin.tsx` | `components/map-screen-chrome.tsx` (nút quay lại nổi, chừa vùng an toàn) |
| `create-group-sheet` / `add-itinerary-sheet` ↔ `invite-sheet` | `components/ui/sheet-actions.tsx` |
| `saved.tsx` ↔ `place/google/[googlePlaceId].tsx`, `share-import/[id].tsx` | `components/screen-state.tsx` |
| `lib/pending-invite.ts` ↔ `lib/preferences.ts` | `lib/json-storage.ts` (`readJson`/`writeJson`, try/catch) |
| `use-google-place-preview` ↔ `use-place-detail` | Hết trùng sau đợt 2 |

Thành phần gộp phải cho ra cây giao diện y như trước (cùng style, thứ tự, nhãn trợ năng). Test cũ của các màn
(`login-screen.test.tsx`…) phải xanh không sửa assert.

## Đợt 4 — Tách file lớn (SRP) và dọn comment

Logic (state, API, tính toán) → hook `use-<màn>.ts` hoặc hàm thuần trong `lib/` (có test); UI → component con một
nhiệm vụ; màn chỉ ghép.

| File | Tách thành |
| --- | --- |
| `itinerary-view/styles.ts` | Style theo component con dùng nó |
| `itinerary-view/itinerary-view.tsx` | `sticky-header`, `day-summary`, `stop-list` / `stop-card`, `tips-sheet`, `warnings` |
| `itinerary-editor.tsx` | `use-editor-actions.ts`, `editor-day`, `editor-item-row`, `unscheduled-tray` |
| `itinerary/new.tsx` | `use-new-itinerary-form.ts` + các section (thời gian, người đi, sở thích…) |
| `(tabs)/account.tsx` | `use-account.ts` + `profile-card`, `trip-stats`, `settings-list` |
| `place/[id].tsx`, `(tabs)/index.tsx`, `place/pin.tsx`, `group/[id].tsx` | Hook màn + 2–4 component con |

Tên component con chốt trong plan đợt 4 theo cấu trúc thật của từng file.

**Quy tắc comment (mọi đợt):** giữ comment giải thích *vì sao* (ràng buộc PRD, lỗi nền tảng, quyết định không hiển
nhiên); xóa comment kể lại code và comment JSX chỉ đặt tên khối (`{/* Header */}`). Tiếng Việt như quy ước.

Thử tay Android cuối đợt 4: so giao diện từng màn đã tách với bản trước.

## Kiểm tra mỗi đợt

`pnpm --filter @rong/mobile typecheck`, `expo lint`, `jest` xanh; `knip` và `dup` đạt mục tiêu của đợt (đợt 1: knip
sạch; đợt 3: jscpd sạch; đợt 4: kích thước file). Không cần e2e backend.

## Ngoài phạm vi

- Thay đổi giao diện, thêm tính năng.
- Backend, `shared-types`, `apps/web`.
- Đưa knip/jscpd vào CI (người dùng tự quyết sau).
- NetInfo / chế độ offline.
