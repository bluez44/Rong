import type { GoogleAuthorAttribution, GooglePhoto, GooglePlaceContent, GoogleReview } from '@rong/shared-types';
import { Image } from 'expo-image';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Colors, MinTouch, Radius, Spacing, Type } from '@/constants/theme';

const PHOTO_HEIGHT = 180;

/**
 * Nội dung Google Maps trên màn chi tiết (F5). Tách hẳn khỏi dữ liệu của app,
 * có ghi "Google Maps"; ảnh và đánh giá ghi tên tác giả kèm link gốc (PRD 7.4).
 * Không tự viết lại hay tóm tắt đánh giá của Google.
 */
export function GooglePlaceContentBlock({ content }: { content: GooglePlaceContent }) {
  const hasSummary = content.rating !== null || content.address || content.openNow !== null;

  return (
    <View style={styles.block}>
      <View style={styles.blockHeader}>
        <Text style={styles.brand} accessibilityRole="header">
          Google Maps
        </Text>
        {content.googleMapsUri ? <ExternalLink label="Mở trên Google Maps" uri={content.googleMapsUri} /> : null}
      </View>

      {content.photos.length > 0 ? <Photos photos={content.photos} /> : null}

      {hasSummary ? (
        <View style={styles.section}>
          {content.rating !== null ? <Rating rating={content.rating} count={content.ratingCount} /> : null}
          {content.openNow !== null ? (
            <Text style={[styles.body, { color: content.openNow ? Colors.light.primary : Colors.light.danger }]}>
              {content.openNow ? 'Đang mở cửa' : 'Đang đóng cửa'}
            </Text>
          ) : null}
          {content.address ? <Text style={styles.body}>{content.address}</Text> : null}
        </View>
      ) : null}

      {content.weekdayHours.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Giờ mở cửa</Text>
          {content.weekdayHours.map((line) => (
            <Text key={line} style={styles.hours}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}

      {content.reviews.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Đánh giá trên Google</Text>
          {content.reviews.map((review, index) => (
            <Review key={review.googleMapsUri ?? index} review={review} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Photos({ photos }: { photos: GooglePhoto[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
      {photos.map((photo) => {
        const width = Math.round((PHOTO_HEIGHT * photo.width) / Math.max(photo.height, 1));
        return (
          <View key={photo.url} style={{ width: Math.min(Math.max(width, 140), 320) }}>
            {/* Không cache ra đĩa: URL ảnh Google là ngắn hạn và không được lưu (PRD 7.4). */}
            <Image source={photo.url} style={styles.photo} contentFit="cover" cachePolicy="memory" accessibilityIgnoresInvertColors />
            <Authors authors={photo.authors} prefix="Ảnh: " />
          </View>
        );
      })}
    </ScrollView>
  );
}

function Rating({ rating, count }: { rating: number; count: number | null }) {
  const countLabel = count !== null ? ` (${count.toLocaleString('vi-VN')} đánh giá)` : '';
  return (
    <View
      style={styles.rating}
      accessible
      accessibilityLabel={`Google: ${rating.toLocaleString('vi-VN')} trên 5 sao${countLabel}`}>
      <Icon name="star" size={16} color={Colors.light.warning} />
      <Text style={styles.ratingValue}>{rating.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</Text>
      {countLabel ? <Text style={styles.muted}>{countLabel.trim()}</Text> : null}
    </View>
  );
}

function Review({ review }: { review: GoogleReview }) {
  const meta = [review.rating !== null ? `${review.rating}★` : null, review.relativeTime].filter(Boolean).join(' · ');
  return (
    <View style={styles.review}>
      <View style={styles.reviewHeader}>
        {review.author.photoUri ? (
          <Image source={review.author.photoUri} style={styles.avatar} cachePolicy="memory" accessibilityIgnoresInvertColors />
        ) : (
          <View style={styles.avatar} />
        )}
        <View style={styles.flex}>
          <AuthorName author={review.author} />
          {meta ? <Text style={styles.muted}>{meta}</Text> : null}
        </View>
      </View>
      {review.text ? <Text style={styles.body}>{review.text}</Text> : null}
      {review.googleMapsUri ? <ExternalLink label="Xem đánh giá gốc" uri={review.googleMapsUri} /> : null}
    </View>
  );
}

function Authors({ authors, prefix }: { authors: GoogleAuthorAttribution[]; prefix: string }) {
  if (authors.length === 0) return null;
  return (
    <Text style={styles.credit} numberOfLines={1}>
      {prefix}
      {authors.map((author, index) => (
        <Text key={`${author.name}-${index}`}>
          {index > 0 ? ', ' : ''}
          <AuthorName author={author} inline />
        </Text>
      ))}
    </Text>
  );
}

function AuthorName({ author, inline }: { author: GoogleAuthorAttribution; inline?: boolean }) {
  const style = inline ? undefined : styles.author;
  if (!author.uri) return <Text style={style}>{author.name}</Text>;
  return (
    <Text style={[style, styles.link]} accessibilityRole="link" onPress={() => Linking.openURL(author.uri!)}>
      {author.name}
    </Text>
  );
}

function ExternalLink({ label, uri }: { label: string; uri: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      hitSlop={{ top: (MinTouch - 18) / 2, bottom: (MinTouch - 18) / 2 }}
      onPress={() => Linking.openURL(uri)}
      style={({ pressed }) => [styles.externalLink, pressed && styles.pressed]}>
      <Text style={styles.linkText}>{label}</Text>
      <Icon name="external" size={13} color={Colors.light.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  block: {
    gap: Spacing.four,
    paddingVertical: Spacing.four,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: Colors.light.hairline,
    backgroundColor: Colors.light.surface,
  },
  blockHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.four, gap: Spacing.two },
  brand: { ...Type.subhead, color: Colors.light.textSecondary },
  section: { gap: Spacing.one, paddingHorizontal: Spacing.four },
  sectionTitle: { ...Type.headline, color: Colors.light.text, marginBottom: Spacing.one },
  body: { ...Type.callout, color: Colors.light.text },
  muted: { ...Type.footnote, color: Colors.light.textSecondary },
  hours: { ...Type.footnote, color: Colors.light.text },
  photos: { gap: Spacing.two, paddingHorizontal: Spacing.four },
  photo: { height: PHOTO_HEIGHT, borderRadius: Radius.md, borderCurve: 'continuous', backgroundColor: Colors.light.backgroundElement },
  credit: { ...Type.caption, fontFamily: Type.footnote.fontFamily, color: Colors.light.textSecondary, marginTop: Spacing.one },
  rating: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  ratingValue: { ...Type.numeric, color: Colors.light.text },
  review: { gap: Spacing.two, paddingVertical: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.light.hairline },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  avatar: { width: 32, height: 32, borderRadius: Radius.pill, backgroundColor: Colors.light.backgroundElement },
  author: { ...Type.subhead, color: Colors.light.text },
  link: { color: Colors.light.primary },
  externalLink: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, alignSelf: 'flex-start' },
  linkText: { ...Type.subhead, color: Colors.light.primary },
  pressed: { opacity: 0.6 },
});
