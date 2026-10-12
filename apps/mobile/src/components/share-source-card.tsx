import type { SharePlatform, ShareSource } from '@rong/shared-types';
import { Image } from 'expo-image';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';

export const PLATFORM_LABELS: Record<SharePlatform, string> = {
  tiktok: 'TikTok',
  youtube: 'YouTube',
  facebook: 'Facebook',
  instagram: 'Instagram',
  web: 'Trang web',
};

/** Ghi nguồn nội dung được chia sẻ (FR-4.5): chỉ metadata công khai, chạm để mở bài gốc. */
export function ShareSourceCard({ source }: { source: ShareSource }) {
  const url = source.url;
  const open = url ? () => Linking.openURL(url) : undefined;
  return (
    <Pressable
      accessibilityRole={open ? 'link' : undefined}
      accessibilityLabel={`Nguồn: ${PLATFORM_LABELS[source.platform]}${source.title ? `, ${source.title}` : ''}`}
      onPress={open}
      style={({ pressed }) => [styles.card, pressed && open && styles.pressed]}>
      {source.thumbnailUrl ? (
        <Image source={{ uri: source.thumbnailUrl }} style={styles.thumb} contentFit="cover" />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]} />
      )}
      <View style={styles.flex}>
        <Text style={styles.platform}>{PLATFORM_LABELS[source.platform]}</Text>
        {source.title ? (
          <Text style={styles.title} numberOfLines={2}>
            {source.title}
          </Text>
        ) : null}
        {source.authorName ? <Text style={styles.meta}>{source.authorName}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    backgroundColor: Colors.light.surface,
  },
  pressed: { opacity: 0.7 },
  thumb: { width: 64, height: 64, borderRadius: Radius.sm, borderCurve: 'continuous' },
  thumbEmpty: { backgroundColor: Colors.light.backgroundSelected },
  flex: { flex: 1, gap: 2 },
  platform: { ...Type.subhead, color: Colors.light.primary },
  title: { ...Type.headline, color: Colors.light.text },
  meta: { ...Type.subhead, color: Colors.light.textSecondary },
});
