import type { RecommendationTheme } from '@rong/shared-types';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { Icon, type IconName } from '@/components/ui/icon';
import { Colors, Palette, Radius, Shadow, Spacing, Type } from '@/constants/theme';

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
  hint: { ...Type.caption, color: Colors.light.textSecondary, maxWidth: 160 },
});
