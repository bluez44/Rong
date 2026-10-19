# Gợi ý lịch trình trang chủ — Giai đoạn 3: Mobile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trang chủ app hiện chip chủ đề và 3 thẻ gợi ý thật từ `GET /recommendations`, mở màn xem trước bản nháp (chỉnh thông số, lưu thành lịch trình), đồng bộ sở thích lên server và hỏi lại "Bạn đã đến những nơi nào?" sau chuyến đi.

**Architecture:** Phần hiển thị lịch trình trong `itinerary/[id].tsx` được tách ra `components/itinerary-view/` để màn xem trước bản nháp dùng lại. Hook mới gọi API qua `authFetch` (theo mẫu `use-region-places.ts`, hỏi lại khi `building`). Sở thích vẫn lưu trên máy (`lib/preferences.ts`), một component vô hình trong `(app)/_layout.tsx` đồng bộ với server.

**Tech Stack:** Expo / React Native, expo-router (typed routes), `@rong/shared-types`. Mobile không có test runner: kiểm bằng `tsc`, `expo lint` và chạy tay trên Expo.

**Spec:** `docs/superpowers/specs/2026-10-19-home-recommendations-design.md`

Yêu cầu: giai đoạn 1 và 2 đã xong và backend chạy được (`pnpm --filter @rong/backend start:dev`, có thể với `RECOMMENDATIONS_ENABLED=false` nếu không chạy Redis).

## Global Constraints

- Nhánh `feat/home-recommendations`. Chữ trên giao diện, comment: tiếng Việt.
- Tuân `apps/mobile/CLAUDE.md`: màn mới bọc `<Screen>`; form có bàn phím dùng `<KeyboardAvoider>` (không dùng `KeyboardAvoidingView` trực tiếp); màn tab dùng `useTabBarInset()` cho `paddingBottom`; bottom sheet dùng `BottomSheet` trong `components/ui`.
- Giữ nguyên kiểu thẻ hiện tại của trang chủ (style `tripCard`, `cardImageContainer`, `badgePill`, `cardFooter`…, token Stitch `Palette.forest900`, `parchment50`).
- Không có nút bookmark/lưu nhanh trên thẻ. Chi phí và thời tiết hiện "Đang cập nhật".
- Ảnh vùng luôn có dòng ghi công: `Ảnh: <author> / Unsplash` (nguồn `unsplash`) hoặc `Ảnh: <tên miền của sourceUrl>` (nguồn `web`); bấm mở link.
- Typed routes: sau khi thêm file route, sinh lại `.expo/types/router.d.ts` bằng `cd apps/mobile && CI=1 timeout 90 npx expo start --offline` (để nó tự dừng) trước khi chạy `tsc`.
- Hiện nguyên `ApiError.message` của backend khi lỗi (`UNKNOWN_THEME`, `DRAFT_NOT_FOUND`, `NOT_ENOUGH_PLACES`, `INVALID_DATES`…).
- Kiểm tra mỗi task: `pnpm --filter @rong/mobile typecheck && pnpm --filter @rong/mobile lint`.

## Review Focus

1. Feed `building` quá 30 giây (job lỗi, Redis tắt) → trang chủ hiện thông báo kèm "Thử lại" (gọi `?retry=1`), không quay vòng mãi. Task 3 `use-recommendations` dừng hỏi lại sau 10 lần.
2. Đang hỏi lại feed của chip A thì bấm chip B → phản hồi của A không ghi đè thẻ của B. Task 3 hủy vòng hỏi lại khi đổi chủ đề (`cancelled`).
3. Mở app sau mốc 15:00 mà app đã mở từ trưa (đang ở nền) → về foreground thì tải lại bộ mới. Task 3 `AppState` + `nextRefreshAt`.
4. Bấm chip sở thích liên tục ở trang Tài khoản → chỉ một `PATCH /users/me` sau khi ngừng 800 ms; mất mạng thì lần mở app sau gửi lại. Task 1.
5. Màn xem trước: bấm "Lưu" hai lần nhanh → chỉ một lịch trình (nút `loading` chặn bấm lại; backend cũng trả lịch trình cũ với 200). Task 4.

---

### Task 1: Đồng bộ sở thích với server

**Files:**
- Modify: `apps/mobile/src/lib/preferences.ts`
- Modify: `apps/mobile/src/auth/auth-context.tsx`
- Create: `apps/mobile/src/components/interests-sync.tsx`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx`

**Interfaces:**
- Consumes: `PATCH /users/me { interests }`, `GET /users/me` → `UserProfile.interests` (giai đoạn 1).
- Produces:
  ```ts
  // preferences.ts
  export type Preferences = { onboarded: boolean; interests: PlaceCategory[]; interestsDirty: boolean };
  export function subscribePreferences(listener: () => void): () => void;
  export function getPreferences(): Preferences | null;
  // auth-context
  updateInterests: (interests: PlaceCategory[]) => Promise<void>;
  ```

- [ ] **Step 1: `preferences.ts` — thêm cờ chưa đồng bộ và hàm đọc ngoài React**

```ts
export type Preferences = {
  onboarded: boolean;
  interests: PlaceCategory[];
  /** Sở thích đổi trên máy mà chưa gửi được lên server; gửi lại lần mở app sau. */
  interestsDirty: boolean;
};

const DEFAULTS: Preferences = { onboarded: false, interests: [], interestsDirty: false };
```

Đổi tên hàm `subscribe` thành `subscribePreferences` và export nó; thêm:

```ts
/** Đọc ngoài React (đồng bộ sở thích). null khi chưa đọc xong. */
export function getPreferences(): Preferences | null {
  return current;
}
```

Cập nhật `usePreferences` dùng `subscribePreferences`. Comment đầu file sửa thành: "… sở thích chọn ở giới thiệu / Tài khoản: điền sẵn form tạo lịch trình (F6) và gửi lên server cho gợi ý ở trang chủ."

- [ ] **Step 2: `auth-context.tsx` — `updateInterests`**

Thêm vào `AuthContextValue`:

```ts
  /** Gửi sở thích lên server (gợi ý trang chủ) rồi cập nhật phiên đang lưu. */
  updateInterests: (interests: PlaceCategory[]) => Promise<void>;
```

Thêm `PlaceCategory` vào import type từ `@rong/shared-types`. Trong `value`, cạnh `updateDisplayName`:

```ts
      updateInterests: async (interests) => {
        const user = await authFetch<UserProfile>('/users/me', { method: 'PATCH', body: { interests } });
        const current = sessionRef.current;
        if (!current) return;
        const next = { ...current, user };
        await saveSession(next);
        applySession(next);
      },
```

- [ ] **Step 3: `components/interests-sync.tsx`**

```tsx
import type { PlaceCategory, UserProfile } from '@rong/shared-types';
import { useEffect, useRef } from 'react';

import { useAuth } from '@/auth/auth-context';
import { getPreferences, subscribePreferences, updatePreferences } from '@/lib/preferences';

/** Chờ người dùng ngừng bấm chip rồi mới gửi. */
const DEBOUNCE_MS = 800;

const same = (a: PlaceCategory[], b: PlaceCategory[]) =>
  a.length === b.length && a.every((c) => b.includes(c));

/**
 * Đồng bộ sở thích trên máy với server (spec 2026-10-19-home-recommendations):
 * khi mở app, server chưa có mà máy có thì đẩy lên, ngược lại lấy bản server;
 * sau đó mỗi lần đổi trên máy thì gửi lên (gộp các lần bấm liên tiếp).
 */
export function InterestsSync() {
  const { status, authFetch, updateInterests } = useAuth();
  const synced = useRef<PlaceCategory[] | null>(null);

  useEffect(() => {
    if (status !== 'signedIn') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const push = (interests: PlaceCategory[]) => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          await updateInterests(interests);
          if (cancelled) return;
          synced.current = interests;
          updatePreferences({ interestsDirty: false });
        } catch {
          // Mất mạng: giữ cờ, lần mở app sau gửi lại.
          updatePreferences({ interestsDirty: true });
        }
      }, DEBOUNCE_MS);
    };

    const start = async () => {
      // Chờ preferences đọc xong từ máy.
      while (!getPreferences() && !cancelled) await new Promise((r) => setTimeout(r, 50));
      const local = getPreferences();
      if (!local || cancelled) return;
      try {
        const me = await authFetch<UserProfile>('/users/me');
        if (cancelled) return;
        const server = me.interests ?? [];
        if (local.interestsDirty || (server.length === 0 && local.interests.length > 0)) {
          synced.current = server;
          push(local.interests);
        } else {
          synced.current = server;
          if (!same(server, local.interests)) updatePreferences({ interests: server });
        }
      } catch {
        // Không tải được hồ sơ: thử lại lần mở app sau.
      }
    };

    const unsubscribe = subscribePreferences(() => {
      const local = getPreferences();
      if (!local || synced.current === null) return;
      if (!same(local.interests, synced.current)) push(local.interests);
    });
    void start();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [status, authFetch, updateInterests]);

  return null;
}
```

Lưu ý: khi `start()` ghi bản server vào máy, listener thấy `local.interests` bằng `synced.current` nên không gửi lại.

- [ ] **Step 4: Gắn vào `(app)/_layout.tsx`**

```tsx
import { InterestsSync } from '@/components/interests-sync';
```

Trong `AppLayout`, ngay sau `<PendingInvite />`: `<InterestsSync />`.

- [ ] **Step 5: Kiểm tra**

Run: `pnpm --filter @rong/mobile typecheck && pnpm --filter @rong/mobile lint`
Expected: không lỗi.

Chạy tay (backend + `pnpm --filter @rong/mobile start`): đăng nhập, vào Tài khoản bấm 3 chip liên tiếp → log backend chỉ có một `PATCH /api/users/me`; `GET /api/users/me` trả đúng `interests`. Tắt mạng, đổi chip, bật lại mạng, mở lại app → sở thích lên server.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/preferences.ts apps/mobile/src/auth/auth-context.tsx apps/mobile/src/components/interests-sync.tsx "apps/mobile/src/app/(app)/_layout.tsx"
git commit -m "feat(mobile): sync travel interests with the server"
```

---

### Task 2: Tách phần hiển thị lịch trình ra `components/itinerary-view/`

**Files:**
- Create: `apps/mobile/src/components/itinerary-view/itinerary-view.tsx`
- Create: `apps/mobile/src/components/itinerary-view/styles.ts`
- Modify: `apps/mobile/src/app/(app)/itinerary/[id].tsx`

**Interfaces:**
- Produces:
  ```ts
  export type ItineraryViewData = Pick<Itinerary, 'input' | 'days' | 'unscheduled' | 'warnings' | 'tips' | 'planner'>;
  export function ItineraryStickyHeader(props: { itinerary: ItineraryViewData; regionName?: string; badge?: string; selectedDayIndex: number; onSelectDay: (i: number) => void }): JSX.Element;
  export function ItineraryViewBody(props: { itinerary: ItineraryViewData; regionName?: string; selectedDayIndex: number; onOpenDayMap: (dayIndex: number) => void; onStartEdit?: () => void; footer?: ReactNode }): JSX.Element;
  export function AiTipsAccess(props: { tips: string[] }): JSX.Element;
  ```
  `ItineraryStickyHeader.badge` mặc định "Chuyến đi"; màn bản nháp truyền "Bản nháp".

Đây là refactor thuần: giao diện màn lịch trình không đổi.

- [ ] **Step 1: Chuyển code**

Trong `app/(app)/itinerary/[id].tsx` (1418 dòng), **cắt nguyên văn** sang `components/itinerary-view/itinerary-view.tsx`:
- `type ItineraryStickyHeaderProps` + `function ItineraryStickyHeader` (dòng ~263–348),
- `type ItineraryViewBodyProps` + `function ItineraryViewBody` (dòng ~369–544),
- `AiTipsAccess`, `TimelineTravelLeg`, `TimelineItemCard`, `Warnings` (dòng ~546–729) và mọi hàm/hằng phụ trợ chỉ chúng dùng (tìm bằng cách xem tên nào còn bị tham chiếu trong file cũ sau khi cắt).

Giữ lại trong file cũ: `ItineraryScreen`, `SaveStatus`, `DeleteButton`.

Style: `StyleSheet.create` của file cũ (dòng 762 trở đi) dùng chung cho mọi component. Chuyển những khóa style mà **chỉ** các component vừa cắt dùng sang `components/itinerary-view/styles.ts` (`export const viewStyles = StyleSheet.create({...})`); khóa dùng ở cả hai nơi thì nhân đôi. Cách làm: sau khi cắt, chạy `tsc` — mỗi lỗi `Property 'x' does not exist` ở file nào cho biết khóa đó cần có ở file đó.

- [ ] **Step 2: Đổi props**

Trong `itinerary-view.tsx`:

```ts
import type { Itinerary } from '@rong/shared-types';
import type { ReactNode } from 'react';

/** Phần lịch trình dùng chung cho lịch trình đã lưu và bản nháp gợi ý. */
export type ItineraryViewData = Pick<
  Itinerary,
  'input' | 'days' | 'unscheduled' | 'warnings' | 'tips' | 'planner'
>;

type ItineraryStickyHeaderProps = {
  itinerary: ItineraryViewData;
  regionName?: string;
  /** Nhãn cạnh tên điểm đến. Mặc định "Chuyến đi". */
  badge?: string;
  selectedDayIndex: number;
  onSelectDay: (index: number) => void;
};

type ItineraryViewBodyProps = {
  itinerary: ItineraryViewData;
  regionName?: string;
  selectedDayIndex: number;
  onOpenDayMap: (dayIndex: number) => void;
  /** Không có thì ẩn lối vào chế độ sửa (người chỉ xem, bản nháp). */
  onStartEdit?: () => void;
  /** Vẽ cuối danh sách (nút xóa lịch trình). */
  footer?: ReactNode;
};
```

Trong thân:
- `ItineraryStickyHeader`: thay chữ cứng `Chuyến đi` trong badge bằng `{badge ?? 'Chuyến đi'}`.
- `ItineraryViewBody`: thay khối `router.push({ pathname: '/itinerary/day-map', params: { id: itinerary.id, day: String(selectedDayIndex) } })` bằng `onOpenDayMap(selectedDayIndex)`; thay `{canDelete ? <DeleteButton id={itinerary.id} /> : null}` bằng `{footer}`; bỏ prop `canDelete`.
- Export ba component `ItineraryStickyHeader`, `ItineraryViewBody`, `AiTipsAccess`.

- [ ] **Step 3: Dùng lại trong `itinerary/[id].tsx`**

```tsx
import { AiTipsAccess, ItineraryStickyHeader, ItineraryViewBody } from '@/components/itinerary-view/itinerary-view';
```

```tsx
        {data && !editing ? (
          <ItineraryViewBody
            itinerary={data}
            regionName={regionName}
            selectedDayIndex={selectedDayIndex}
            onOpenDayMap={(day) =>
              router.push({ pathname: '/itinerary/day-map', params: { id: data.id, day: String(day) } })
            }
            onStartEdit={canEdit ? () => setEditing(true) : undefined}
            footer={data.myRole === 'creator' || data.myRole === 'owner' ? <DeleteButton id={data.id} /> : null}
          />
        ) : null}
```

Xóa import không còn dùng (lint chỉ ra).

- [ ] **Step 4: Kiểm tra**

Run: `pnpm --filter @rong/mobile typecheck && pnpm --filter @rong/mobile lint`
Expected: không lỗi.

Chạy tay: mở một lịch trình có nhiều ngày → header, tab ngày, lộ trình, cảnh báo, timeline, "Chưa xếp được", nút "Bản đồ", mẹo AI, nút xóa trông và hoạt động như trước. Chụp màn hình trước và sau để so.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/itinerary-view "apps/mobile/src/app/(app)/itinerary/[id].tsx"
git commit -m "refactor(mobile): extract itinerary view components for reuse"
```

---

### Task 3: Trang chủ — chip chủ đề và 3 thẻ gợi ý

**Files:**
- Create: `apps/mobile/src/hooks/use-recommendations.ts`
- Create: `apps/mobile/src/components/recommendation-card.tsx`
- Create: `apps/mobile/src/components/theme-chips.tsx`
- Modify: `apps/mobile/src/app/(app)/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `GET /recommendations?theme=&retry=1` → `RecommendationFeed` (giai đoạn 2).
- Produces:
  ```ts
  export function useRecommendations(theme: string): {
    status: 'loading' | 'building' | 'ready' | 'timeout' | 'error';
    feed: RecommendationFeed | null;
    error: ApiError | null;
    retry: () => void;
    reload: () => void;
  };
  export function RecommendationCard(props: { card: RecommendationCard; onPress: () => void }): JSX.Element;
  export function RecommendationCardSkeleton(): JSX.Element;
  export function ThemeChips(props: { themes: RecommendationTheme[]; selected: string; onSelect: (key: string) => void }): JSX.Element;
  ```

- [ ] **Step 1: `hooks/use-recommendations.ts`**

```ts
import type { RecommendationFeed } from '@rong/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import { ApiError } from '@/lib/api';

const BUILDING_RETRY_MS = 3000;
/** ~30 giây: quá chừng này mà vẫn `building` thì báo và cho thử lại. */
const MAX_POLLS = 10;

type Status = 'loading' | 'building' | 'ready' | 'timeout' | 'error';

/**
 * Bảng tin gợi ý ở trang chủ (spec 2026-10-19-home-recommendations). Backend
 * trả `building` khi đang tạo bộ cho khung giờ này: hỏi lại mỗi 3 giây. Quay
 * lại app sau mốc làm mới (6:00/15:00) thì tải bộ mới.
 */
export function useRecommendations(theme: string) {
  const { authFetch } = useAuth();
  const [status, setStatus] = useState<Status>('loading');
  const [feed, setFeed] = useState<RecommendationFeed | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState({ n: 0, retry: false });
  const nextRefreshAt = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;

    const load = async (retry: boolean) => {
      try {
        const params = new URLSearchParams({ theme });
        if (retry) params.set('retry', '1');
        const next = await authFetch<RecommendationFeed>(`/recommendations?${params}`);
        if (cancelled) return;
        setFeed(next);
        setError(null);
        nextRefreshAt.current = Date.parse(next.nextRefreshAt);
        if (next.status === 'ready') {
          setStatus('ready');
          return;
        }
        if (++polls >= MAX_POLLS) {
          setStatus('timeout');
          return;
        }
        setStatus('building');
        timer = setTimeout(() => load(false), BUILDING_RETRY_MS);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Có lỗi không mong muốn. Thử lại sau.'));
        setStatus('error');
      }
    };

    // Đổi chủ đề: bỏ thẻ cũ để không hiện nhầm thẻ của chủ đề trước.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus('loading');
    void load(attempt.retry);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [authFetch, theme, attempt]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && nextRefreshAt.current !== null && Date.now() >= nextRefreshAt.current) {
        setAttempt((a) => ({ n: a.n + 1, retry: false }));
      }
    });
    return () => sub.remove();
  }, []);

  const retry = useCallback(() => setAttempt((a) => ({ n: a.n + 1, retry: true })), []);
  const reload = useCallback(() => setAttempt((a) => ({ n: a.n + 1, retry: false })), []);
  return { status, feed, error, retry, reload };
}
```

Khi đổi chủ đề, danh sách chip vẫn giữ vì `feed` cũ chưa bị xóa; chỉ thẻ chuyển sang khung xương (`status = 'loading'`).

- [ ] **Step 2: `components/recommendation-card.tsx`**

Chuyển các khóa style thẻ từ `(tabs)/index.tsx` (`tripCard`, `cardImageContainer`, `cardImage`, `imageOverlay`, `imageTopBadges`, `badgePill`, `badgePillText`, `imageBottomText`, `regionBadge`, `tripTitle`, `cardFooter`, `footerLeft`, `activityIconCircle`, `costLabel`, `costValue`, `exploreButton`, `exploreButtonText`) sang file này nguyên giá trị; thêm style mới ở cuối.

```tsx
import type { RecommendationCard as Card, RegionImage } from '@rong/shared-types';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Colors, Palette, Radius, Shadow, Spacing, Type } from '@/constants/theme';

/** "Ảnh: Nguyễn A / Unsplash" hoặc "Ảnh: blog.example". */
function credit(image: RegionImage): { text: string; url: string | null } {
  if (image.source === 'unsplash') {
    return { text: `Ảnh: ${image.author ?? 'Unsplash'} / Unsplash`, url: image.authorUrl ?? image.sourceUrl };
  }
  let host = 'nguồn bài viết';
  try {
    if (image.sourceUrl) host = new URL(image.sourceUrl).hostname.replace(/^www\./, '');
  } catch {
    // URL hỏng: giữ chữ mặc định.
  }
  return { text: `Ảnh: ${host}`, url: image.sourceUrl };
}

const duration = (card: Card) =>
  card.nightCount > 0 ? `${card.dayCount} ngày ${card.nightCount} đêm` : `${card.dayCount} ngày`;

export function RecommendationCard({ card, onPress }: { card: Card; onPress: () => void }) {
  const photo = card.image ? credit(card.image) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${card.title}, ${duration(card)}. ${card.reason}`}
      onPress={onPress}
      style={({ pressed }) => [styles.tripCard, pressed && styles.pressed]}>
      <View style={styles.cardImageContainer}>
        {card.image ? (
          <Image source={card.image.url} style={styles.cardImage} contentFit="cover" transition={250} />
        ) : (
          <LinearGradient colors={[Palette.forest700, Palette.forest900]} style={styles.cardImage} />
        )}
        <View style={styles.imageOverlay} />

        <View style={styles.imageTopBadges}>
          <View style={styles.badgePill}>
            <Icon name="clock" size={13} color={Colors.light.primary} />
            <Text style={styles.badgePillText}>{duration(card)}</Text>
          </View>
          {card.revisit ? (
            <View style={styles.badgePill}>
              <Icon name="undo" size={13} color={Colors.light.primary} />
              <Text style={styles.badgePillText}>Quay lại</Text>
            </View>
          ) : null}
          {card.savedItineraryId ? (
            <View style={styles.badgePill}>
              <Icon name="check" size={13} color={Colors.light.primary} />
              <Text style={styles.badgePillText}>Đã lưu</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.imageBottomText}>
          <Text style={styles.regionBadge}>{card.regionName.toUpperCase()}</Text>
          <Text style={styles.tripTitle}>{card.title}</Text>
        </View>

        {photo ? (
          <Text
            style={styles.credit}
            numberOfLines={1}
            accessibilityRole={photo.url ? 'link' : undefined}
            onPress={photo.url ? () => Linking.openURL(photo.url!) : undefined}>
            {photo.text}
          </Text>
        ) : null}
      </View>

      <View style={styles.body}>
        <Text style={styles.reason} numberOfLines={2}>{card.reason}</Text>
        {card.highlights.length > 0 ? (
          <Text style={styles.highlights} numberOfLines={1}>{card.highlights.join(' · ')}</Text>
        ) : null}
      </View>

      <View style={styles.cardFooter}>
        <View style={styles.footerLeft}>
          <View style={styles.activityIconCircle}>
            <Icon name="sun" size={18} color={Palette.forest900} />
          </View>
          <View>
            <Text style={styles.costLabel}>Chi phí · Thời tiết</Text>
            <Text style={styles.pending}>Đang cập nhật</Text>
          </View>
        </View>
        <View style={styles.exploreButton}>
          <Text style={styles.exploreButtonText}>{card.savedItineraryId ? 'Mở chuyến' : 'Xem lịch'}</Text>
          <Icon name="forward" size={15} color={Colors.light.primary} />
        </View>
      </View>
    </Pressable>
  );
}

export function RecommendationCardSkeleton() {
  return (
    <View style={styles.tripCard} accessibilityLabel="Đang tạo gợi ý">
      <View style={[styles.cardImageContainer, styles.skeleton]} />
      <View style={styles.body}>
        <View style={[styles.skeletonLine, { width: '70%' }]} />
        <View style={[styles.skeletonLine, { width: '45%' }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // …dán nguyên các khóa style thẻ chuyển từ (tabs)/index.tsx ở đây…
  pressed: { opacity: 0.92 },
  credit: {
    position: 'absolute',
    right: Spacing.three,
    bottom: Spacing.two,
    maxWidth: '60%',
    ...Type.caption,
    color: 'rgba(255,255,255,0.85)',
  },
  body: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three, gap: Spacing.one },
  reason: { ...Type.subhead, color: Colors.light.text },
  highlights: { ...Type.footnote, color: Colors.light.textSecondary },
  pending: { ...Type.subhead, color: Colors.light.textSecondary },
  skeleton: { backgroundColor: Palette.parchment200 },
  skeletonLine: { height: 12, borderRadius: Radius.sm, backgroundColor: Palette.parchment200 },
});
```

Trước khi viết, kiểm tra:
- `expo-linear-gradient` có trong `apps/mobile/package.json`; nếu không, thay `LinearGradient` bằng `<View style={[styles.cardImage, { backgroundColor: Palette.forest700 }]} />`.
- Các token dùng ở trên (`Palette.forest700`, `Palette.parchment200`, `Type.caption`, `Radius.sm`, `Shadow`) có trong `constants/theme.ts`; thay bằng token gần nhất nếu thiếu, không viết màu hex mới.

Mảng màu khi không có ảnh dùng một gradient chung (spec nói "theo chủ đề"; thẻ không mang icon chủ đề nên dùng một màu nhận diện thương hiệu là đủ cho lượt này).

- [ ] **Step 3: `components/theme-chips.tsx`**

Giữ style `moodChip*` của trang chủ (chuyển sang file này):

```tsx
import type { RecommendationTheme } from '@rong/shared-types';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { Icon, type IconName } from '@/components/ui/icon';
import { Colors, Palette, Spacing, Type } from '@/constants/theme';

/** Icon backend gửi phải có trong app; lạ thì dùng sparkles. */
const iconOf = (name: string): IconName =>
  (['sparkles', 'forest', 'sun', 'cafe', 'food', 'culture', 'nature', 'kids', 'nightlife', 'kayak', 'motorcycle', 'explore'] as const).includes(
    name as never,
  )
    ? (name as IconName)
    : 'sparkles';

export function ThemeChips({
  themes,
  selected,
  onSelect,
}: {
  themes: RecommendationTheme[];
  selected: string;
  onSelect: (key: string) => void;
}) {
  return (
    <View style={styles.carouselContainer}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carouselContent}>
        {themes.map((theme) => {
          const active = theme.key === selected;
          return (
            <Pressable
              key={theme.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={theme.regionHint ? `${theme.label}, ${theme.regionHint}` : theme.label}
              onPress={() => onSelect(theme.key)}
              style={[styles.moodChip, active ? styles.moodChipActive : styles.moodChipInactive]}>
              <Icon name={iconOf(theme.icon)} size={16} color={active ? Palette.onPine : Colors.light.primary} />
              <View>
                <Text style={[styles.moodChipText, active && styles.moodChipTextActive]}>{theme.label}</Text>
                {theme.regionHint ? (
                  <Text style={[styles.hint, active && styles.moodChipTextActive]} numberOfLines={1}>
                    {theme.regionHint}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // …dán nguyên carouselContainer, carouselContent, moodChip, moodChipActive, moodChipInactive,
  // moodChipText, moodChipTextActive từ (tabs)/index.tsx…
  hint: { ...Type.caption, color: Colors.light.textSecondary, maxWidth: 160 },
});
```

- [ ] **Step 4: Sửa `(tabs)/index.tsx`**

1. Xóa `MoodChip`, `MOOD_CHIPS`, `FeaturedTrip`, `FEATURED_TRIPS`, `selectedMood`, `bookmarkedTrips`, `toggleBookmark`, và các khóa style đã chuyển ở Step 2–3.
2. Thêm:

```tsx
import { RecommendationCard, RecommendationCardSkeleton } from '@/components/recommendation-card';
import { ThemeChips } from '@/components/theme-chips';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { useRecommendations } from '@/hooks/use-recommendations';
import { formatTime } from '@/lib/trip-format';
```

```tsx
  const [theme, setTheme] = useState('default');
  const recs = useRecommendations(theme);
  const themes = recs.feed?.themes ?? [];
```

3. Thay khối hàng chip mood bằng:

```tsx
        {themes.length > 0 ? <ThemeChips themes={themes} selected={theme} onSelect={setTheme} /> : null}
```

4. Thay khối "Featured Journeys Section" (từ `{/* Featured Journeys Section */}` tới hết `cardsStack`) bằng:

```tsx
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <View style={styles.sectionDot} />
              <ThemedText type="title2" style={styles.sectionTitle}>
                Gợi ý cho bạn
              </ThemedText>
            </View>
            {recs.feed ? (
              <Text style={styles.refreshHint}>Làm mới lúc {formatTime(recs.feed.nextRefreshAt)}</Text>
            ) : null}
          </View>

          <View style={styles.cardsStack}>
            {recs.status === 'loading' || recs.status === 'building'
              ? [0, 1, 2].map((i) => <RecommendationCardSkeleton key={i} />)
              : null}

            {recs.status === 'timeout' ? (
              <Notice
                title="Chưa có gợi ý"
                action={<Button label="Thử lại" variant="plain" size="sm" onPress={recs.retry} />}>
                Rong đang bận một chút. Thử lại sau ít phút nhé.
              </Notice>
            ) : null}

            {recs.status === 'error' && recs.error ? (
              <Notice
                tone="danger"
                title="Chưa tải được gợi ý"
                action={<Button label="Thử lại" variant="plain" size="sm" onPress={recs.reload} />}>
                {recs.error.message}
              </Notice>
            ) : null}

            {recs.status === 'ready' && recs.feed?.items.length === 0 ? (
              <Notice
                title="Chưa có gợi ý"
                action={<Button label="Chọn sở thích" variant="plain" size="sm" onPress={() => router.push('/account')} />}>
                Chọn sở thích hoặc mở vài điểm đến để Rong gợi ý cho bạn.
              </Notice>
            ) : null}

            {recs.status === 'ready'
              ? recs.feed?.items.map((card) => (
                  <RecommendationCard
                    key={card.id}
                    card={card}
                    onPress={() =>
                      card.savedItineraryId
                        ? router.push({ pathname: '/itinerary/[id]', params: { id: card.savedItineraryId, regionName: card.regionName } })
                        : router.push({ pathname: '/recommendation/[id]', params: { id: card.id } })
                    }
                  />
                ))
              : null}
          </View>
        </View>
```

5. Thêm style `refreshHint: { ...Type.footnote, color: Colors.light.textSecondary }`. Xóa style `seeAllText` nếu không còn dùng.

Màn `/recommendation/[id]` tạo ở Task 4; tới lúc đó `tsc` sẽ báo route chưa có. Làm Task 3 và Task 4 liền nhau, hoặc tạm thời dùng `router.push(\`/recommendation/${card.id}\` as never)` rồi sửa lại ở Task 4. Chọn cách thứ nhất: **chưa commit Task 3 cho tới khi Task 4 typecheck qua**; Step 6 dưới đây chỉ chạy lint.

- [ ] **Step 5: Kiểm tra lint**

Run: `pnpm --filter @rong/mobile lint`
Expected: không lỗi.

- [ ] **Step 6: Chạy tay (sau Task 4)**

Ghi chú để làm sau Task 4: mở app → trang chủ hiện chip "Dành cho bạn" + chủ đề cố định, 3 khung xương rồi 3 thẻ; bấm chip khác → khung xương rồi 3 thẻ khác; ảnh có ghi công, bấm mở link; tắt backend → "Chưa tải được gợi ý" + Thử lại.

---

### Task 4: Màn xem trước bản nháp

**Files:**
- Create: `apps/mobile/src/hooks/use-recommendation-draft.ts`
- Create: `apps/mobile/src/components/trip-params-sheet.tsx`
- Create: `apps/mobile/src/app/(app)/recommendation/[id].tsx`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx` (đăng ký route)
- Modify: `apps/mobile/src/app/(app)/itinerary/day-map.tsx`

**Interfaces:**
- Consumes: `GET /recommendations/:id` → `ItineraryDraft`; `POST /recommendations/:id/preview` (`PreviewDraftRequest`); `POST /recommendations/:id/save` (`SaveDraftRequest`) → `Itinerary`.
- Produces:
  ```ts
  export function useRecommendationDraft(id: string): {
    status: 'loading' | 'done' | 'error'; draft: ItineraryDraft | null; error: ApiError | null;
    reload: () => void;
    preview: (req: PreviewDraftRequest) => Promise<void>; previewing: boolean;
    save: () => Promise<Itinerary>; saving: boolean;
  };
  export function TripParamsSheet(props: { visible: boolean; initial: PreviewDraftRequest; onClose: () => void; onSubmit: (req: PreviewDraftRequest) => Promise<void> }): JSX.Element;
  ```
- Route: `/recommendation/[id]`; `/itinerary/day-map` nhận thêm `recommendationId`.

- [ ] **Step 1: `hooks/use-recommendation-draft.ts`**

```ts
import type { Itinerary, ItineraryDraft, PreviewDraftRequest } from '@rong/shared-types';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/auth/auth-context';
import { ApiError } from '@/lib/api';

const toApiError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Có lỗi không mong muốn. Thử lại sau.');

/** Bản nháp của một gợi ý: xem, đổi thông số (xếp lại), lưu thành lịch trình. */
export function useRecommendationDraft(id: string) {
  const { authFetch } = useAuth();
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [draft, setDraft] = useState<ItineraryDraft | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    authFetch<ItineraryDraft>(`/recommendations/${id}`)
      .then((d) => {
        if (cancelled) return;
        setDraft(d);
        setStatus('done');
      })
      .catch((e) => {
        if (cancelled) return;
        setError(toApiError(e));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [authFetch, id, attempt]);

  /** Lỗi ném ra cho sheet hiện; bản nháp đang xem giữ nguyên. */
  const preview = useCallback(
    async (req: PreviewDraftRequest) => {
      setPreviewing(true);
      try {
        setDraft(await authFetch<ItineraryDraft>(`/recommendations/${id}/preview`, { method: 'POST', body: req }));
      } catch (e) {
        throw toApiError(e);
      } finally {
        setPreviewing(false);
      }
    },
    [authFetch, id],
  );

  const save = useCallback(async () => {
    if (!draft) throw new ApiError(0, 'UNKNOWN', 'Bản nháp chưa tải xong.');
    setSaving(true);
    try {
      return await authFetch<Itinerary>(`/recommendations/${id}/save`, {
        method: 'POST',
        body: { draftId: draft.draftId },
      });
    } catch (e) {
      throw toApiError(e);
    } finally {
      setSaving(false);
    }
  }, [authFetch, draft, id]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { status, draft, error, reload, preview, previewing, save, saving };
}
```

- [ ] **Step 2: `components/trip-params-sheet.tsx`**

Dùng lại `Stepper`, `Chip`, `DateTimeField`, nhãn từ `lib/trip-format.ts` (`TRAVEL_PARTY_LABELS`, `PACE_LABELS`, `BUDGET_LABELS`, như `itinerary/new.tsx:24`).

```tsx
import type { BudgetTier, Pace, PreviewDraftRequest, TravelParty } from '@rong/shared-types';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { KeyboardAvoider } from '@/components/screen';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { DateTimeField } from '@/components/ui/date-time-field';
import { Notice } from '@/components/ui/notice';
import { Stepper } from '@/components/ui/stepper';
import { Colors, Spacing, Type } from '@/constants/theme';
import { ApiError } from '@/lib/api';
import { BUDGET_LABELS, PACE_LABELS, TRAVEL_PARTY_LABELS } from '@/lib/trip-format';

const PARTIES = Object.keys(TRAVEL_PARTY_LABELS) as TravelParty[];
const PACES = Object.keys(PACE_LABELS) as Pace[];
const BUDGETS = Object.keys(BUDGET_LABELS) as BudgetTier[];

/** "YYYY-MM-DD" ↔ Date ở 8:00 giờ máy (chỉ dùng phần ngày). */
const toDate = (s: string) => new Date(`${s}T08:00:00`);
const toDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Đổi ngày đi, số ngày, đối tượng, số người, nhịp độ, ngân sách của bản nháp. */
export function TripParamsSheet({
  visible,
  initial,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  initial: PreviewDraftRequest;
  onClose: () => void;
  onSubmit: (req: PreviewDraftRequest) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    // Mở lại sheet: lấy thông số hiện tại của bản nháp.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(initial);
    setError(null);
  }, [visible, initial]);

  const set = <K extends keyof PreviewDraftRequest>(key: K, v: PreviewDraftRequest[K]) =>
    setValue((cur) => ({ ...cur, [key]: v }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(value);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chưa xếp lại được. Thử lại sau.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} header={<Text style={styles.title}>Chỉnh thông tin chuyến đi</Text>}>
      <KeyboardAvoider>
        <ScrollView contentContainerStyle={styles.content}>
          <DateTimeField
            label="Ngày đi"
            value={toDate(value.startDate)}
            minimumDate={new Date()}
            onChange={(d) => set('startDate', toDay(d))}
          />
          <Stepper label="Số ngày" value={value.daysCount} min={1} max={7} onChange={(n) => set('daysCount', n)} />

          <Text style={styles.label}>Ai đi</Text>
          <View style={styles.chips}>
            {PARTIES.map((p) => (
              <Chip key={p} label={TRAVEL_PARTY_LABELS[p]} selected={value.travelParty === p} onPress={() => set('travelParty', p)} />
            ))}
          </View>
          <Stepper label="Người lớn" value={value.adults} min={1} max={30} onChange={(n) => set('adults', n)} />
          <Stepper label="Trẻ em" hint="Dưới 12 tuổi" value={value.children} min={0} max={30} onChange={(n) => set('children', n)} />

          <Text style={styles.label}>Nhịp độ</Text>
          <View style={styles.chips}>
            {PACES.map((p) => (
              <Chip key={p} label={PACE_LABELS[p]} selected={value.pace === p} onPress={() => set('pace', p)} />
            ))}
          </View>

          <Text style={styles.label}>Ngân sách</Text>
          <View style={styles.chips}>
            {BUDGETS.map((b) => (
              <Chip key={b} label={BUDGET_LABELS[b]} selected={value.budgetTier === b} onPress={() => set('budgetTier', b)} />
            ))}
          </View>

          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button label="Xếp lại lịch" size="lg" loading={busy} onPress={submit} />
        </ScrollView>
      </KeyboardAvoider>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { ...Type.headline, color: Colors.light.text },
  content: { gap: Spacing.three, paddingBottom: Spacing.six },
  label: { ...Type.subhead, color: Colors.light.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
```

`DateTimeField` chọn cả ngày lẫn giờ; chỉ phần ngày được dùng (bản nháp luôn 8:00 → 18:00). Nếu `DateTimeField` có chế độ chỉ chọn ngày (xem `components/ui/date-time-field.tsx`), dùng chế độ đó.

- [ ] **Step 3: `app/(app)/recommendation/[id].tsx`**

```tsx
import type { PreviewDraftRequest } from '@rong/shared-types';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glass } from '@/components/glass';
import { AiTipsAccess, ItineraryStickyHeader, ItineraryViewBody } from '@/components/itinerary-view/itinerary-view';
import { Screen } from '@/components/screen';
import { TripParamsSheet } from '@/components/trip-params-sheet';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { Colors, Spacing } from '@/constants/theme';
import { useRecommendationDraft } from '@/hooks/use-recommendation-draft';
import { ApiError } from '@/lib/api';

type Params = { id: string };

/** Bản nháp gợi ý ở trang chủ: xem như lịch trình thật, chỉnh thông số, lưu thành chuyến của tôi. */
export default function RecommendationDraftScreen() {
  const { id } = useLocalSearchParams<Params>();
  const insets = useSafeAreaInsets();
  const { status, draft, error, reload, preview, save, saving } = useRecommendationDraft(id);
  const [day, setDay] = useState(0);
  const [editing, setEditing] = useState(false);

  const params = useMemo<PreviewDraftRequest | null>(
    () => (draft ? { ...draft.params, startDate: draft.days[0]?.date ?? draft.input.startsAt.slice(0, 10) } : null),
    [draft],
  );

  const onSave = async () => {
    if (draft?.savedItineraryId) {
      router.replace({ pathname: '/itinerary/[id]', params: { id: draft.savedItineraryId, regionName: draft.regionName } });
      return;
    }
    try {
      const itinerary = await save();
      router.replace({ pathname: '/itinerary/[id]', params: { id: itinerary.id, regionName: draft?.regionName } });
    } catch (e) {
      Alert.alert('Chưa lưu được', e instanceof ApiError ? e.message : 'Thử lại sau.');
      if (e instanceof ApiError && e.code === 'DRAFT_NOT_FOUND') reload();
    }
  };

  return (
    <Screen edges={['top']}>
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Quay lại" onPress={() => router.back()}>
          <Glass shape="circle" interactive style={styles.backGlass}>
            <Icon name="back" color={Colors.light.text} />
          </Glass>
        </Pressable>
      </View>

      {draft ? (
        <ItineraryStickyHeader
          itinerary={draft}
          regionName={draft.regionName}
          badge="Bản nháp"
          selectedDayIndex={day}
          onSelectDay={setDay}
        />
      ) : null}

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 140 }]}>
        {status === 'loading' ? <ActivityIndicator color={Colors.light.primary} accessibilityLabel="Đang tải" /> : null}
        {status === 'error' && error ? (
          <Notice
            tone="danger"
            title={error.code === 'RECOMMENDATION_NOT_FOUND' ? 'Gợi ý không còn nữa' : 'Chưa tải được bản nháp'}
            action={
              error.code === 'RECOMMENDATION_NOT_FOUND' ? null : (
                <Button label="Thử lại" variant="plain" size="sm" onPress={reload} />
              )
            }>
            {error.message}
          </Notice>
        ) : null}
        {draft ? (
          <ItineraryViewBody
            itinerary={draft}
            regionName={draft.regionName}
            selectedDayIndex={day}
            onOpenDayMap={(d) =>
              router.push({ pathname: '/itinerary/day-map', params: { recommendationId: draft.recommendationId, day: String(d) } })
            }
          />
        ) : null}
      </ScrollView>

      {draft && draft.tips.length > 0 ? <AiTipsAccess tips={draft.tips} /> : null}

      {draft ? (
        <View style={[styles.actions, { paddingBottom: insets.bottom + Spacing.three }]}>
          {draft.savedItineraryId ? null : (
            <Button label="Chỉnh thông tin" variant="glass" onPress={() => setEditing(true)} style={styles.action} />
          )}
          <Button
            label={draft.savedItineraryId ? 'Mở lịch trình đã lưu' : 'Lưu thành chuyến của tôi'}
            loading={saving}
            onPress={onSave}
            style={styles.action}
          />
        </View>
      ) : null}

      {params ? (
        <TripParamsSheet
          visible={editing}
          initial={params}
          onClose={() => setEditing(false)}
          onSubmit={async (req) => {
            await preview(req);
            setDay(0);
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
  backGlass: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: Spacing.four, gap: Spacing.four },
  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    backgroundColor: Colors.light.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.light.hairline,
  },
  action: { flex: 1 },
});
```

So các giá trị `topBar`, `backGlass`, `content` với style cùng tên trong `itinerary/[id].tsx` và dùng đúng giá trị đó để hai màn trông như nhau. Nếu `AiTipsAccess` là nút nổi ở đáy màn, đặt `actions` cao hơn hoặc ẩn `AiTipsAccess` khi có thanh hành động để không chồng nhau (kiểm tay ở Step 6).

- [ ] **Step 4: Đăng ký route và sửa `day-map.tsx`**

`(app)/_layout.tsx`: thêm `<Stack.Screen name="recommendation/[id]" />` sau `itinerary/day-map`.

`itinerary/day-map.tsx`:

```tsx
import { useRecommendationDraft } from '@/hooks/use-recommendation-draft';

type Params = { id?: string; recommendationId?: string; day?: string };
```

```tsx
  const { id, recommendationId, day } = useLocalSearchParams<Params>();
  // Bản đồ của lịch trình đã lưu hoặc của bản nháp gợi ý (spec 2026-10-19-home-recommendations).
  const itinerary = useItinerary(id ?? '');
  const draft = useRecommendationDraft(recommendationId ?? '');
  const days = recommendationId ? draft.draft?.days : itinerary.data?.days;
```

Thay `itinerary.data?.days[dayIndex] ?? itinerary.data?.days[0]` bằng `days?.[dayIndex] ?? days?.[0]`. Hai hook đều chạy (quy tắc hook), hook không dùng gọi API với id rỗng và nhận lỗi 404/400 — để tránh request thừa, thêm vào cả `useResource` (`hooks/use-itineraries.ts`) và `useRecommendationDraft` điều kiện: id rỗng thì không gọi API và giữ `status: 'loading'`.

`useResource`: trong `reload`, đầu hàm thêm `if (!path || path.endsWith('/')) return;`. `useRecommendationDraft`: trong `useEffect`, đầu hàm thêm `if (!id) return;`.

Mở bản đồ từ bản nháp gọi lại `GET /recommendations/:id`, làm tăng `view_count` lần đầu xem — không sao vì `viewed_at` chỉ ghi một lần.

- [ ] **Step 5: Sinh lại typed routes và kiểm tra**

Run: `cd apps/mobile && CI=1 timeout 90 npx expo start --offline; cd ../.. && pnpm --filter @rong/mobile typecheck && pnpm --filter @rong/mobile lint`
Expected: không lỗi (cả Task 3).

- [ ] **Step 6: Chạy tay Task 3 + Task 4**

Trên Expo (backend chạy, đã đăng nhập, có sở thích):
1. Trang chủ: chip, 3 thẻ (xem ghi chú Task 3 Step 6).
2. Bấm thẻ → màn "Bản nháp": header có nhãn "Bản nháp", ngày là thứ Bảy tới, timeline có giờ, nút "Bản đồ" mở bản đồ ngày.
3. "Chỉnh thông tin" → đổi số ngày 3, Nhóm bạn → "Xếp lại lịch" → lịch 3 ngày. Đổi chỉ ngày đi → ngày đổi, các điểm giữ nguyên.
4. "Lưu thành chuyến của tôi" → chuyển sang màn lịch trình thật, sửa được. Quay về trang chủ (kéo để tải lại hoặc mở lại tab) → thẻ có nhãn "Đã lưu", bấm mở lịch trình đó.
5. Bấm "Lưu" hai lần thật nhanh → chỉ một lịch trình trong tab Chuyến đi.

- [ ] **Step 7: Commit Task 3 và Task 4**

```bash
git add apps/mobile/src/hooks/use-recommendations.ts apps/mobile/src/components/recommendation-card.tsx apps/mobile/src/components/theme-chips.tsx "apps/mobile/src/app/(app)/(tabs)/index.tsx"
git commit -m "feat(mobile): show personalized recommendations on the home screen"
git add apps/mobile/src/hooks/use-recommendation-draft.ts apps/mobile/src/hooks/use-itineraries.ts apps/mobile/src/components/trip-params-sheet.tsx "apps/mobile/src/app/(app)/recommendation" "apps/mobile/src/app/(app)/_layout.tsx" "apps/mobile/src/app/(app)/itinerary/day-map.tsx"
git commit -m "feat(mobile): preview, adjust and save recommended itinerary drafts"
```

---

### Task 5: Hỏi lại nơi đã đi sau chuyến đi

**Files:**
- Create: `apps/mobile/src/hooks/use-pending-visits.ts`
- Create: `apps/mobile/src/components/visit-review-sheet.tsx`
- Modify: `apps/mobile/src/app/(app)/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `GET /visits/pending` → `PendingVisitReview[]`; `POST /visits/review` (`ReviewVisitsRequest`) → 204 (giai đoạn 1).
- Produces:
  ```ts
  export function usePendingVisits(): { pending: PendingVisitReview | null; dismiss: () => void; submit: (visitedPlaceIds: string[]) => Promise<void> };
  export function VisitReviewSheet(props: { review: PendingVisitReview; visible: boolean; onClose: () => void; onSubmit: (ids: string[]) => Promise<void> }): JSX.Element;
  ```

- [ ] **Step 1: `hooks/use-pending-visits.ts`**

```ts
import type { PendingVisitReview } from '@rong/shared-types';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/auth/auth-context';

/** Chuyến đã kết thúc chưa xác nhận "đã đến những nơi nào" — chỉ chuyến mới nhất. "Để sau" ẩn trong phiên. */
export function usePendingVisits() {
  const { authFetch } = useAuth();
  const [pending, setPending] = useState<PendingVisitReview | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const list = await authFetch<PendingVisitReview[]>('/visits/pending');
      setPending(list.find((p) => !dismissed.has(p.itineraryId)) ?? null);
    } catch {
      // Không quan trọng: lần mở trang chủ sau thử lại.
    }
  }, [authFetch, dismissed]);

  useEffect(() => {
    void load();
  }, [load]);

  const dismiss = useCallback(() => {
    if (pending) setDismissed((s) => new Set(s).add(pending.itineraryId));
  }, [pending]);

  const submit = useCallback(
    async (visitedPlaceIds: string[]) => {
      if (!pending) return;
      await authFetch<void>('/visits/review', {
        method: 'POST',
        body: { itineraryId: pending.itineraryId, visitedPlaceIds },
      });
      await load();
    },
    [authFetch, pending, load],
  );

  return { pending, dismiss, submit };
}
```

- [ ] **Step 2: `components/visit-review-sheet.tsx`**

```tsx
import type { PendingVisitReview } from '@rong/shared-types';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { CATEGORY_LABELS } from '@/constants/places';
import { Colors, MinTouch, Radius, Spacing, Type } from '@/constants/theme';
import { ApiError } from '@/lib/api';

/** "Bạn đã đến những nơi nào?": mặc định tích hết, bỏ tích nơi không đến. */
export function VisitReviewSheet({
  review,
  visible,
  onClose,
  onSubmit,
}: {
  review: PendingVisitReview;
  visible: boolean;
  onClose: () => void;
  onSubmit: (visitedPlaceIds: string[]) => Promise<void>;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChecked(new Set(review.places.map((p) => p.placeId)));
    setError(null);
  }, [visible, review]);

  const toggle = (id: string) =>
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit([...checked]);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chưa lưu được. Thử lại sau.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      header={
        <View>
          <Text style={styles.title}>Bạn đã đến những nơi nào?</Text>
          <Text style={styles.subtitle}>Chuyến {review.regionName}. Bỏ chọn nơi bạn chưa ghé để Rong gợi ý chính xác hơn.</Text>
        </View>
      }>
      <ScrollView contentContainerStyle={styles.list}>
        {review.places.map((place) => {
          const on = checked.has(place.placeId);
          return (
            <Pressable
              key={place.placeId}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => toggle(place.placeId)}
              style={styles.row}>
              <View style={[styles.box, on && styles.boxOn]}>
                {on ? <Icon name="check" size={14} color={Colors.light.onPrimary} /> : null}
              </View>
              <View style={styles.flex}>
                <Text style={styles.name}>{place.name}</Text>
                <Text style={styles.meta}>{CATEGORY_LABELS[place.category]}</Text>
              </View>
            </Pressable>
          );
        })}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button label="Xác nhận" size="lg" loading={busy} onPress={confirm} />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { ...Type.headline, color: Colors.light.text },
  subtitle: { ...Type.footnote, color: Colors.light.textSecondary, marginTop: Spacing.one },
  list: { gap: Spacing.two, paddingBottom: Spacing.six },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: MinTouch },
  box: {
    width: 24,
    height: 24,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    borderColor: Colors.light.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: Colors.light.primary, borderColor: Colors.light.primary },
  flex: { flex: 1 },
  name: { ...Type.body, color: Colors.light.text },
  meta: { ...Type.footnote, color: Colors.light.textSecondary },
});
```

- [ ] **Step 3: Banner trên trang chủ**

Trong `(tabs)/index.tsx`:

```tsx
import { VisitReviewSheet } from '@/components/visit-review-sheet';
import { usePendingVisits } from '@/hooks/use-pending-visits';
```

```tsx
  const visits = usePendingVisits();
  const [reviewing, setReviewing] = useState(false);
```

Ngay trước khối "Gợi ý cho bạn":

```tsx
        {visits.pending ? (
          <View style={styles.sectionContainer}>
            <Notice
              title={`Chuyến ${visits.pending.regionName} đã kết thúc`}
              action={
                <View style={styles.visitActions}>
                  <Button label="Để sau" variant="plain" size="sm" onPress={visits.dismiss} />
                  <Button label="Trả lời" size="sm" onPress={() => setReviewing(true)} />
                </View>
              }>
              Bạn đã đến những nơi nào?
            </Notice>
          </View>
        ) : null}
```

Cuối `ScrollView` (trước `</Screen>`):

```tsx
      {visits.pending ? (
        <VisitReviewSheet
          review={visits.pending}
          visible={reviewing}
          onClose={() => setReviewing(false)}
          onSubmit={async (ids) => {
            await visits.submit(ids);
            recs.reload();
          }}
        />
      ) : null}
```

Style: `visitActions: { flexDirection: 'row', gap: Spacing.two }`.

Lưu ý: `recs.reload()` chỉ đọc lại bộ đang cache của khung giờ hiện tại (bộ mới không chứa nơi vừa xác nhận chỉ có từ khung giờ sau). Đây đúng hành vi của spec (gợi ý làm mới lúc 6:00/15:00); job `generate-user-themes` thì chạy ngay.

- [ ] **Step 4: Kiểm tra**

Run: `pnpm --filter @rong/mobile typecheck && pnpm --filter @rong/mobile lint`
Expected: không lỗi.

Chạy tay: tạo (hoặc sửa trong DB dev) một lịch trình có `ends_at` hôm qua → mở trang chủ thấy banner → "Trả lời" → bỏ tích một nơi → "Xác nhận" → banner biến mất; `SELECT status FROM visited_places WHERE user_id = …` có `confirmed`/`rejected` đúng. "Để sau" ẩn banner tới khi mở lại app.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/hooks/use-pending-visits.ts apps/mobile/src/components/visit-review-sheet.tsx "apps/mobile/src/app/(app)/(tabs)/index.tsx"
git commit -m "feat(mobile): ask which places were visited after a trip"
```

---

### Task 6: Kiểm tra toàn nhánh

- [ ] **Step 1: Kiểm tra toàn repo**

Run: `pnpm build && pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS.

Run: `pnpm --filter @rong/backend test:e2e`
Expected: PASS.

- [ ] **Step 2: Chạy tay toàn luồng với Redis**

1. `pnpm infra:up`; backend `RECOMMENDATIONS_ENABLED=true`, `start:dev`; mobile `start`.
2. Người dùng mới: onboarding chọn 2 sở thích → đăng ký → trang chủ có "Dành cho bạn" + chủ đề cố định (chủ đề khớp sở thích xếp trước), sau vài giây có chip chủ đề riêng (Gemini) khi mở lại trang chủ.
3. Đi hết luồng Task 4 Step 6 và Task 5 Step 4.
4. `npx tsx apps/backend/scripts/enqueue-recommendation-job.ts refresh-window` → mở lại app sau khi job chạy: bộ gợi ý vẫn hiện (cùng khung giờ thì giữ nguyên thẻ).

Ghi kết quả từng bước. Bước nào hỏng thì dừng, báo người dùng kèm log.

- [ ] **Step 3: Dùng superpowers:finishing-a-development-branch để chốt nhánh.**
