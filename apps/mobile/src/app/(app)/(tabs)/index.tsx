import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { useAuth } from '@/auth/auth-context';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import {
  BottomTabInset,
  Colors,
  MinTouch,
  Palette,
  Radius,
  Shadow,
  Spacing,
  Type,
} from '@/constants/theme';

type MoodChip = {
  id: string;
  label: string;
  icon: IconName;
};

const MOOD_CHIPS: MoodChip[] = [
  { id: 'forest', label: 'Trốn phố về rừng', icon: 'forest' },
  { id: 'food', label: 'Ẩm thực miền Tây', icon: 'food' },
  { id: 'sea', label: 'Biển vắng hoàng hôn', icon: 'sun' },
  { id: 'cafe', label: 'Cà phê hoài niệm', icon: 'cafe' },
  { id: 'culture', label: 'Làng nghề thủ công', icon: 'culture' },
];

type FeaturedTrip = {
  id: string;
  title: string;
  region: string;
  imageUrl: string;
  duration: string;
  weather: string;
  activityIcon: IconName;
  estimatedCost: string;
};

const FEATURED_TRIPS: FeaturedTrip[] = [
  {
    id: 'can-tho',
    title: 'Cần Thơ - Về miền sông nước Cửu Long',
    region: 'TÂY NAM BỘ',
    imageUrl:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuAPFDrnc8DQMWOZLOE8SgO0tQG7WcKr7UqiZrMQpDW0m6PT3fkqDA0HdLucv9rdEY9W6KrkkLeCjcylFj--TYszLALABlNsgcngYTp-78yX-pFfVjSataKgAu-81-V2goupQNYs8grcN2GS_AHpOXS40eZjEfTvG7I7R6qZCmIiGboauc5zgqrx3vwSK9TZSZfGqR6VpJxJPgMkktR8ERWlGFhqG_4iKDu9xRhxFoTYtnfeHqSR4Z_j',
    duration: '2 ngày 1 đêm',
    weather: '29°C',
    activityIcon: 'kayak',
    estimatedCost: '1.250.000đ',
  },
  {
    id: 'ha-giang',
    title: 'Hà Giang - Mùa đá xám nở hoa',
    region: 'ĐÔNG BẮC',
    imageUrl:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuB_2kGopu7w9ZwGoG8BWrdPXdSmH3zsXycqpkkpzsAahB7v9F5Ks72LKCYLdC8wsm4vP4Kqg6m-R3-kP304z6xrkyBmDtyssZZ7wYc58hePNfPsgqCXFqd-uemXxXJz0OP8njvCjjHPyGi2goreKm2obU7S7TvE-9apwJP52UOHTGc_e8nxQasbeQAi605fsUL0d8JKusaiMk0stGh_gQyHBZrAKdmaJetzC4aKrQ0BaTvh7l9zqvQ0',
    duration: '3 ngày 2 đêm',
    weather: '18°C',
    activityIcon: 'motorcycle',
    estimatedCost: '2.400.000đ',
  },
  {
    id: 'hoi-an',
    title: 'Hội An - Đêm hoa đăng phố cổ',
    region: 'DUYÊN HẢI MIỀN TRUNG',
    imageUrl:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuD2iTNABe5gKDO_0Mjbb31UKp-7Pf0SWMTWSJBcLhOVcn9yAST86bE7TGf1u5DNeVP1P2f3oCLkqs_bmmntV-f4zq2UNLc5ZDDVctXVHzyLm9fBY9kBTLsJOEW5BpxVmp1ezbmy-4igjTQqF2PB-LfGq6uj91-M_Io7IoMrs_xbjTCeFGUFeSwDwXADviZwzxZ1q91AVdPaWJ7ZVrVXPnYgMDHxHF4YWDHGbaFb0dLGargGGws_-jEW',
    duration: '2 ngày 2 đêm',
    weather: '26°C',
    activityIcon: 'cafe',
    estimatedCost: '1.850.000đ',
  },
];

export default function HomeScreen() {
  const { session } = useAuth();
  const name = session?.user.displayName ?? session?.user.email?.split('@')[0] ?? 'bạn';
  const [selectedMood, setSelectedMood] = useState('forest');
  const [bookmarkedTrips, setBookmarkedTrips] = useState<Record<string, boolean>>({});

  const toggleBookmark = (id: string) => {
    setBookmarkedTrips((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <Screen edges={['top']} style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}>
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
            <Text style={styles.searchPlaceholder}>Tìm tỉnh, thành phố hoặc điểm đến...</Text>
            <View style={styles.filterButton}>
              <Icon name="tune" size={18} color={Colors.light.textSecondary} />
            </View>
          </View>
        </Pressable>

        {/* Mood & Vibe Chips Carousel */}
        <View style={styles.carouselContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.carouselContent}>
            {MOOD_CHIPS.map((chip) => {
              const active = selectedMood === chip.id;
              return (
                <Pressable
                  key={chip.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setSelectedMood(chip.id)}
                  style={[styles.moodChip, active ? styles.moodChipActive : styles.moodChipInactive]}>
                  <Icon
                    name={chip.icon}
                    size={16}
                    color={active ? Palette.onPine : Colors.light.primary}
                  />
                  <Text style={[styles.moodChipText, active && styles.moodChipTextActive]}>
                    {chip.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

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

        {/* Featured Journeys Section */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <View style={styles.sectionDot} />
              <ThemedText type="title2" style={styles.sectionTitle}>
                Hành trình cuối tuần
              </ThemedText>
            </View>
            <Pressable onPress={() => router.push('/search')}>
              <Text style={styles.seeAllText}>Xem tất cả</Text>
            </Pressable>
          </View>

          {/* Cards Stack */}
          <View style={styles.cardsStack}>
            {FEATURED_TRIPS.map((trip) => {
              const isBookmarked = !!bookmarkedTrips[trip.id];
              return (
                <View key={trip.id} style={styles.tripCard}>
                  {/* Card Image Banner */}
                  <View style={styles.cardImageContainer}>
                    <Image
                      source={trip.imageUrl}
                      style={styles.cardImage}
                      contentFit="cover"
                      transition={250}
                    />
                    <View style={styles.imageOverlay} />

                    {/* Top Badges */}
                    <View style={styles.imageTopBadges}>
                      <View style={styles.badgePill}>
                        <Icon name="clock" size={13} color={Colors.light.primary} />
                        <Text style={styles.badgePillText}>{trip.duration}</Text>
                      </View>
                      <View style={styles.badgePill}>
                        <Icon name="sun" size={13} color={Colors.light.warning} />
                        <Text style={styles.badgePillText}>{trip.weather}</Text>
                      </View>
                    </View>

                    {/* Bookmark Action */}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Lưu chuyến đi"
                      onPress={() => toggleBookmark(trip.id)}
                      style={styles.bookmarkButton}>
                      <Icon
                        name={isBookmarked ? 'bookmarkFill' : 'bookmark'}
                        size={18}
                        color={isBookmarked ? Colors.light.secondary : Colors.light.text}
                      />
                    </Pressable>

                    {/* Bottom Image Overlay Text */}
                    <View style={styles.imageBottomText}>
                      <Text style={styles.regionBadge}>{trip.region}</Text>
                      <Text style={styles.tripTitle}>{trip.title}</Text>
                    </View>
                  </View>

                  {/* Card Footer Info */}
                  <View style={styles.cardFooter}>
                    <View style={styles.footerLeft}>
                      <View style={styles.activityIconCircle}>
                        <Icon name={trip.activityIcon} size={18} color={Palette.forest900} />
                      </View>
                      <View>
                        <Text style={styles.costLabel}>Chi phí ước tính</Text>
                        <Text style={styles.costValue}>
                          {trip.estimatedCost}
                          <Text style={styles.costPerPerson}>/người</Text>
                        </Text>
                      </View>
                    </View>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Khám phá ${trip.title}`}
                      onPress={() => router.push('/search')}
                      style={styles.exploreButton}>
                      <Text style={styles.exploreButtonText}>Khám phá</Text>
                      <Icon name="forward" size={15} color={Colors.light.primary} />
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* Editorial Cultural Quote Footer */}
        <View style={styles.quoteCard}>
          <Text style={styles.quoteText}>
            {'“Rong chơi không chỉ là dịch chuyển, mà là để lòng mình rộng mở cùng xứ sở.”'}
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: Palette.parchment50,
  },
  scrollContent: {
    paddingBottom: BottomTabInset + Spacing.eight,
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
  carouselContainer: {
    marginTop: Spacing.two,
  },
  carouselContent: {
    paddingHorizontal: Spacing.five,
    gap: Spacing.two,
  },
  moodChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
  },
  moodChipActive: {
    backgroundColor: Colors.light.primary,
    ...Shadow.card,
  },
  moodChipInactive: {
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.mist200,
  },
  moodChipText: {
    ...Type.subhead,
    color: Colors.light.text,
  },
  moodChipTextActive: {
    color: Palette.onPine,
    fontFamily: Type.headline.fontFamily,
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
  seeAllText: {
    ...Type.subhead,
    color: Colors.light.secondary,
    fontFamily: Type.headline.fontFamily,
  },
  cardsStack: {
    gap: Spacing.four,
  },
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
  bookmarkButton: {
    position: 'absolute',
    top: Spacing.three,
    right: Spacing.three,
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(252, 249, 241, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
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
  costValue: {
    ...Type.headline,
    color: Palette.forest900,
  },
  costPerPerson: {
    ...Type.caption,
    fontSize: 11,
    color: Colors.light.textSecondary,
    fontFamily: Type.body.fontFamily,
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
