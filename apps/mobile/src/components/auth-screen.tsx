import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Colors, Palette, Radius, Spacing } from '@/constants/theme';

type AuthScreenProps = {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  /** Dòng cuối màn hình, thường là link chuyển giữa đăng nhập và đăng ký. */
  footer?: ReactNode;
};

/**
 * Khung chung cho đăng ký, nhập mã, đăng nhập: dải "sương trên rừng thông"
 * giống cover của design system, rồi tiêu đề và form trên nền sương.
 */
export function AuthScreen({ title, subtitle, children, footer }: AuthScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.six }]}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never">
        <MistBand topInset={insets.top} />
        <View style={styles.header}>
          <ThemedText type="title1" accessibilityRole="header">
            {title}
          </ThemedText>
          {subtitle ? (
            <ThemedText type="body" themeColor="textSecondary">
              {subtitle}
            </ThemedText>
          ) : null}
        </View>
        <View style={styles.form}>{children}</View>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Khối thông tràn mép trên, vài dải sương trôi ngang, một quả hồng. Trang trí, không mang nghĩa. */
function MistBand({ topInset }: { topInset: number }) {
  return (
    <View style={[styles.band, { height: 148 + topInset }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.pine, { height: 124 + topInset }]}>
        <View style={[styles.mist, { width: 96, top: topInset + 28, left: 20 }]} />
        <View style={[styles.mist, { width: 120, top: topInset + 60, left: 52 }]} />
        <View style={[styles.mist, { width: 72, top: topInset + 92, left: 16 }]} />
      </View>
      <View style={[styles.lavender, { top: topInset + 24 }]} />
      <View style={[styles.persimmon, { top: topInset + 88 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.light.background },
  content: { flexGrow: 1 },
  band: { position: 'relative', overflow: 'hidden' },
  pine: {
    position: 'absolute',
    left: Spacing.four,
    top: -Spacing.eight,
    width: 196,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    backgroundColor: Palette.pine700,
    overflow: 'hidden',
  },
  mist: { position: 'absolute', height: 14, borderRadius: 7, backgroundColor: Palette.mist50 },
  lavender: {
    position: 'absolute',
    left: 228,
    right: -Spacing.six,
    height: 72,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    backgroundColor: Palette.lavender400,
  },
  persimmon: { position: 'absolute', left: 244, width: 44, height: 44, borderRadius: 22, backgroundColor: Palette.persimmon500 },
  header: { paddingHorizontal: Spacing.four, paddingTop: Spacing.six, gap: Spacing.two },
  form: { paddingHorizontal: Spacing.four, paddingTop: Spacing.six, gap: Spacing.five },
  footer: { marginTop: 'auto', paddingTop: Spacing.eight, paddingHorizontal: Spacing.four, alignItems: 'center' },
});
