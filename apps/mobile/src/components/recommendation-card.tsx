import type { RecommendationCard as Card, RegionImage } from '@rong/shared-types';
import { LinearGradient } from 'expo-linear-gradient';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { AdaptiveImage } from '@/components/ui/adaptive-image';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Icon, type IconName } from '@/components/ui/icon';
import { Colors, Palette, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { formatTemps, summaryLabel, WEATHER_ICONS } from '@/lib/weather';

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

/** Icon chủ đề app biết vẽ; icon lạ từ backend thì dùng sparkles. */
const THEME_ICONS = [
  'sparkles',
  'forest',
  'sun',
  'cafe',
  'food',
  'culture',
  'nature',
  'kids',
  'nightlife',
  'kayak',
  'motorcycle',
  'explore',
] as const satisfies readonly IconName[];

type ThemeIcon = (typeof THEME_ICONS)[number];

export const isThemeIcon = (name: string): name is ThemeIcon => (THEME_ICONS as readonly string[]).includes(name);

/** Mảng màu khi vùng chưa có ảnh: theo chủ đề (icon của chủ đề), chỉ dùng token Palette. */
const THEME_GRADIENTS: Record<ThemeIcon, [string, string]> = {
  forest: [Palette.forest700, Palette.forest900],
  nature: [Palette.pine500, Palette.pine900],
  sun: [Palette.turmeric500, Palette.terracotta700],
  kayak: [Palette.pine500, Palette.forest900],
  cafe: [Palette.terracotta500, Palette.turmeric700],
  food: [Palette.persimmon500, Palette.persimmon700],
  culture: [Palette.terracotta700, Palette.charcoalMuted],
  nightlife: [Palette.lavender700, Palette.charcoal],
  kids: [Palette.lavender400, Palette.lavender700],
  motorcycle: [Palette.amber700, Palette.charcoalMuted],
  explore: [Palette.pine700, Palette.forest900],
  sparkles: [Palette.forest700, Palette.forest900],
};

function themeGradient(icon: string): [string, string] {
  return THEME_GRADIENTS[isThemeIcon(icon) ? icon : 'sparkles'];
}

const duration = (card: Card) =>
  card.nightCount > 0 ? `${card.dayCount} ngày ${card.nightCount} đêm` : `${card.dayCount} ngày`;

export function RecommendationCard({
  card,
  themeIcon,
  onPress,
}: {
  card: Card;
  /** Icon của chủ đề đang chọn: quyết định mảng màu khi vùng không có ảnh. */
  themeIcon: string;
  onPress: () => void;
}) {
  const photo = card.image ? credit(card.image) : null;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${card.title}, ${duration(card)}. ${card.reason}`}
      onPress={onPress}
      scaleTo={0.98}
      style={styles.tripCard}>
      <View style={styles.cardImageContainer}>
        {card.image ? (
          <AdaptiveImage uri={card.image.url} fit="box" style={styles.cardImage} transition={250} />
        ) : (
          <LinearGradient colors={themeGradient(themeIcon)} style={styles.cardImage} />
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
              <Text numberOfLines={1} style={styles.badgePillText}>Quay lại</Text>
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
            onPress={photo.url ? () => Linking.openURL(photo.url!).catch(() => {}) : undefined}>
            {photo.text}
          </Text>
        ) : null}
      </View>

      <View style={styles.body}>
        <Text style={styles.reason} numberOfLines={2}>
          {card.reason}
        </Text>
        {card.highlights.length > 0 ? (
          <Text style={styles.highlights} numberOfLines={1}>
            {card.highlights.join(' · ')}
          </Text>
        ) : null}
      </View>

      <View style={styles.cardFooter}>
        <View style={styles.footerLeft}>
          <View style={styles.activityIconCircle}>
            <Icon name={card.weather ? WEATHER_ICONS[card.weather.condition] : 'sun'} size={18} color={Palette.forest900} />
          </View>
          <View>
            <Text style={styles.costLabel}>Thời tiết</Text>
            {card.weather ? (
              <Text style={styles.weatherValue} numberOfLines={1}>
                {formatTemps(card.weather)} · {summaryLabel(card.weather)}
              </Text>
            ) : (
              <Text style={styles.pending}>Đang cập nhật</Text>
            )}
          </View>
        </View>
        <View style={styles.exploreButton}>
          <Text numberOfLines={1} style={styles.exploreButtonText}>{card.savedItineraryId ? 'Mở chuyến' : 'Xem lịch'}</Text>
          <Icon name="forward" size={15} color={Colors.light.primary} />
        </View>
      </View>
    </PressableScale>
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
  tripCard: {
    backgroundColor: Palette.surface,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    ...Shadow.card,
  },
  cardImageContainer: {
    height: 190,
    width: '100%',
    position: 'relative',
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  imageOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(8, 60, 41, 0.4)',
  },
  imageTopBadges: {
    position: 'absolute',
    top: Spacing.three,
    left: Spacing.three,
    flexDirection: 'row',
    gap: Spacing.two,
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(252, 249, 241, 0.92)',
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  badgePillText: {
    ...Type.caption,
    fontSize: 11,
    lineHeight: 14,
    color: Colors.light.text,
  },
  imageBottomText: {
    position: 'absolute',
    bottom: Spacing.three,
    left: Spacing.three,
    right: Spacing.three,
  },
  regionBadge: {
    ...Type.caption,
    fontSize: 11,
    color: Palette.turmeric100,
    letterSpacing: 1,
    marginBottom: 2,
  },
  tripTitle: {
    ...Type.title2,
    fontSize: 18,
    lineHeight: 24,
    color: Palette.surface,
  },
  cardFooter: {
    padding: Spacing.four,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
  },
  activityIconCircle: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    backgroundColor: Palette.forest100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  costLabel: {
    ...Type.caption,
    fontSize: 11,
    color: Colors.light.textSecondary,
  },
  exploreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Palette.parchment100,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
  },
  exploreButtonText: {
    ...Type.subhead,
    color: Colors.light.primary,
    fontFamily: Type.headline.fontFamily,
  },
  credit: {
    position: 'absolute',
    right: Spacing.three,
    top: Spacing.two,
    maxWidth: '60%',
    ...Type.caption,
    color: 'rgba(255,255,255,0.85)',
  },
  body: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three, gap: Spacing.one },
  reason: { ...Type.subhead, color: Colors.light.text },
  highlights: { ...Type.footnote, color: Colors.light.textSecondary },
  pending: { ...Type.subhead, color: Colors.light.textSecondary },
  weatherValue: { ...Type.subhead, color: Palette.forest900 },
  skeleton: { backgroundColor: Palette.parchment200 },
  skeletonLine: { height: 12, borderRadius: Radius.sm, backgroundColor: Palette.parchment200 },
});
