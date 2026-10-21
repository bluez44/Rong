import type { PendingVisitReview } from '@rong/shared-types';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';

import { useAuth } from '@/auth/auth-context';
import { useTabBarInset } from '@/components/floating-tab-bar';
import { RecommendationCard, RecommendationCardSkeleton } from '@/components/recommendation-card';
import { Screen } from '@/components/screen';
import { ThemeChips } from '@/components/theme-chips';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { VisitReviewSheet } from '@/components/visit-review-sheet';
import { enterItem, fadeIn, fadeOut, layoutShift } from '@/constants/motion';
import {
  Colors,
  MinTouch,
  Palette,
  Radius,
  Shadow,
  Spacing,
  Type,
} from '@/constants/theme';
import { usePendingVisits } from '@/hooks/use-pending-visits';
import { useRecommendations } from '@/hooks/use-recommendations';

export default function HomeScreen() {
  const tabBarInset = useTabBarInset();
  const { session } = useAuth();
  const name = session?.user.displayName ?? session?.user.email?.split('@')[0] ?? 'bạn';
  const [theme, setTheme] = useState('default');
  const recs = useRecommendations(theme);
  const themes = recs.feed?.themes ?? [];
  // Chủ đề đang chọn đã hết hạn hoặc bị thay (chủ đề riêng làm mới hằng tuần): về "Dành cho bạn".
  // Đặt lại state ngay trong lúc render (không qua effect) theo cách React khuyên.
  if (recs.error?.code === 'UNKNOWN_THEME' && theme !== 'default') {
    setTheme('default');
  }
  const visits = usePendingVisits();
  const [reviewing, setReviewing] = useState(false);
  // Giữ chuyến đang hỏi trong sheet, kể cả khi nó vừa bị bỏ khỏi danh sách (để còn hiện lỗi).
  const [reviewTarget, setReviewTarget] = useState<PendingVisitReview | null>(null);

  // Quay về trang chủ (ví dụ sau khi lưu một gợi ý): tải lại ngầm để thẻ hiện "Đã lưu".
  const { refresh } = recs;
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focused.current) refresh();
      focused.current = true;
    }, [refresh]),
  );

  return (
    <Screen edges={['top']} style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarInset }]}>
        {/* Top Header Branding */}
        <View style={styles.header}>
          <View style={styles.brandContainer}>
            <View style={styles.logoPill}>
              <Icon name="nature" size={18} color={Palette.forest900} />
            </View>
            <ThemedText type="title2" style={styles.brandTitle}>
              Rong <Text style={styles.brandSubtitle}>Thong Dong</Text>
            </ThemedText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tài khoản cá nhân"
            onPress={() => router.push('/account')}
            style={styles.avatarButton}>
            <Icon name="person" size={20} color={Colors.light.primary} />
          </Pressable>
        </View>

        {/* Greeting & Headline */}
        <View style={styles.heroSection}>
          <Text style={styles.greeting}>CHÀO {name.toUpperCase()},</Text>
          <ThemedText type="display" style={styles.mainHeadline}>
            Cuối tuần này <Text style={styles.italicHeadline}>đi đâu?</Text>
          </ThemedText>
        </View>

        {/* Elevated Search Pill */}
        <Pressable
          accessibilityRole="search"
          accessibilityLabel="Tìm tỉnh, thành phố hoặc điểm đến"
          onPress={() => router.push('/search')}
          style={styles.searchContainer}>
          <View style={styles.searchPill}>
            <View style={styles.searchIconContainer}>
              <Icon name="explore" size={20} color={Colors.light.secondary} />
            </View>
            <Text style={styles.searchPlaceholder} numberOfLines={1} ellipsizeMode="tail">
              Tìm tỉnh, thành phố hoặc điểm đến
            </Text>
            <View style={styles.filterButton}>
              <Icon name="tune" size={18} color={Colors.light.textSecondary} />
            </View>
          </View>
        </Pressable>

        {themes.length > 0 ? <ThemeChips themes={themes} selected={theme} onSelect={setTheme} /> : null}

        {/* AI Travel Assistant Banner */}
        <View style={styles.sectionContainer}>
          <View style={styles.aiBanner}>
            <View style={styles.aiBadge}>
              <Icon name="sparkles" size={14} color={Palette.forest200} />
              <Text style={styles.aiBadgeText}>Trợ lý Rong AI</Text>
            </View>
            <Text style={styles.aiHeadline}>Lên lịch ngẫu hứng trong 30 giây?</Text>
            <Text style={styles.aiSubtitle}>
              Chỉ cần chọn ngân sách & cảm xúc, Rong gợi ý lịch trình trọn vẹn kèm phương tiện.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Khởi tạo ngẫu hứng"
              onPress={() => router.push('/itinerary/new')}
              style={styles.aiActionBtn}>
              <Icon name="arrowForward" size={20} color={Palette.forest900} />
            </Pressable>
          </View>
        </View>

        {visits.pending ? (
          <Animated.View entering={enterItem()} exiting={fadeOut} style={styles.sectionContainer}>
            <Notice
              title={`Chuyến ${visits.pending.regionName} đã kết thúc`}
              action={
                <View style={styles.visitActions}>
                  <Button label="Để sau" variant="plain" size="sm" onPress={visits.dismiss} />
                  <Button label="Trả lời" size="sm" onPress={() => {
                      setReviewTarget(visits.pending);
                      setReviewing(true);
                    }}
                  />
                </View>
              }>
              Bạn đã đến những nơi nào?
            </Notice>
          </Animated.View>
        ) : null}

        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <View style={styles.sectionDot} />
              <ThemedText type="title2" style={styles.sectionTitle}>
                Gợi ý cho bạn
              </ThemedText>
            </View>
          </View>

          <Animated.View layout={layoutShift} style={styles.cardsStack}>
            {recs.status === 'loading' || recs.status === 'building'
              ? [0, 1, 2].map((i) => (
                  <Animated.View key={`skeleton-${i}`} entering={fadeIn} exiting={fadeOut}>
                    <RecommendationCardSkeleton />
                  </Animated.View>
                ))
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
              ? recs.feed?.items.map((card, index) => (
                  <Animated.View key={card.id} entering={enterItem(index)} exiting={fadeOut} layout={layoutShift}>
                    <RecommendationCard
                      card={card}
                      themeIcon={themes.find((t) => t.key === theme)?.icon ?? 'sparkles'}
                      onPress={() =>
                        card.savedItineraryId
                          ? router.push({ pathname: '/itinerary/[id]', params: { id: card.savedItineraryId, regionName: card.regionName } })
                          : router.push({ pathname: '/recommendation/[id]', params: { id: card.id } })
                      }
                    />
                  </Animated.View>
                ))
              : null}
          </Animated.View>
        </View>

        {/* Editorial Cultural Quote Footer */}
        <View style={styles.quoteCard}>
          <Text style={styles.quoteText}>
            {'“Rong chơi không chỉ là dịch chuyển, mà là để lòng mình rộng mở cùng xứ sở.”'}
          </Text>
        </View>
      </ScrollView>

      {reviewTarget ? (
        <VisitReviewSheet
          review={reviewTarget}
          visible={reviewing}
          onClose={() => setReviewing(false)}
          onSubmit={async (ids) => {
            await visits.submit(reviewTarget.itineraryId, ids);
            recs.refresh();
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: Palette.parchment50,
  },
  scrollContent: {
    gap: Spacing.four,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.five,
    paddingTop: Spacing.two,
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  logoPill: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    backgroundColor: Palette.forest100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: {
    color: Palette.forest900,
    fontSize: 20,
    lineHeight: 26,
  },
  brandSubtitle: {
    color: Colors.light.secondary,
    fontFamily: Type.headline.fontFamily,
  },
  avatarButton: {
    width: 38,
    height: 38,
    borderRadius: Radius.pill,
    backgroundColor: Palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.card,
  },
  heroSection: {
    paddingHorizontal: Spacing.five,
    paddingTop: Spacing.one,
  },
  greeting: {
    ...Type.caption,
    color: Colors.light.secondary,
    letterSpacing: 1.2,
    marginBottom: Spacing.one,
  },
  mainHeadline: {
    color: Palette.forest900,
  },
  italicHeadline: {
    fontStyle: 'italic',
    color: Colors.light.secondary,
  },
  searchContainer: {
    paddingHorizontal: Spacing.five,
  },
  searchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.surface,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    minHeight: MinTouch + 6,
    ...Shadow.glass,
  },
  searchIconContainer: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    backgroundColor: Palette.terracotta100,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.two,
  },
  searchPlaceholder: {
    ...Type.subhead,
    color: Colors.light.textSecondary,
    flex: 1,
  },
  filterButton: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    backgroundColor: Palette.parchment100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionContainer: {
    paddingHorizontal: Spacing.five,
    marginTop: Spacing.two,
  },
  aiBanner: {
    backgroundColor: Colors.light.primaryContainer,
    borderRadius: Radius.lg,
    padding: Spacing.five,
    position: 'relative',
    ...Shadow.glass,
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one - 1,
    borderRadius: Radius.pill,
    marginBottom: Spacing.two,
  },
  aiBadgeText: {
    ...Type.caption,
    color: Palette.forest200,
    letterSpacing: 0.5,
  },
  aiHeadline: {
    ...Type.title2,
    color: Palette.surface,
    marginBottom: Spacing.one,
  },
  aiSubtitle: {
    ...Type.body,
    fontSize: 14,
    lineHeight: 20,
    color: Palette.forest200,
    paddingRight: Spacing.twelve,
  },
  aiActionBtn: {
    position: 'absolute',
    right: Spacing.four,
    bottom: Spacing.four,
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Palette.terracotta300,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.card,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.three,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  sectionDot: {
    width: 8,
    height: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.secondary,
  },
  sectionTitle: {
    color: Palette.forest900,
  },
  visitActions: { flexDirection: 'row', gap: Spacing.two },
  cardsStack: {
    gap: Spacing.four,
  },
  quoteCard: {
    marginHorizontal: Spacing.five,
    marginTop: Spacing.two,
    backgroundColor: Palette.parchment100,
    borderRadius: Radius.lg,
    padding: Spacing.four,
    alignItems: 'center',
  },
  quoteText: {
    ...Type.body,
    fontStyle: 'italic',
    textAlign: 'center',
    color: Colors.light.secondary,
    lineHeight: 22,
  },
});
