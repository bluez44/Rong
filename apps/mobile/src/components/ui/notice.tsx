import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';

export type NoticeTone = 'warning' | 'danger' | 'info' | 'ai';

const TONE = {
  warning: { background: Colors.light.warningBackground, accent: Colors.light.warning },
  danger: { background: Colors.light.dangerBackground, accent: Colors.light.danger },
  info: { background: Colors.light.surface, accent: Colors.light.primary },
  ai: { background: Colors.light.aiBackground, accent: Colors.light.ai },
} as const;

/** Khối thông báo trong nội dung. Tiêu đề nói điều gì xảy ra, phần thân nói cách xử lý. */
export function Notice({ tone = 'info', title, children, action }: { tone?: NoticeTone; title?: string; children?: ReactNode; action?: ReactNode }) {
  const t = TONE[tone];
  return (
    <View
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={[styles.box, { backgroundColor: t.background }, tone === 'info' && styles.outlined]}>
      <View style={styles.body}>
        {title ? <Text style={[styles.title, { color: t.accent }]}>{title}</Text> : null}
        {children ? <Text style={styles.text}>{children}</Text> : null}
        {action}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: Spacing.four, borderRadius: Radius.md, borderCurve: 'continuous' },
  outlined: { borderWidth: 1, borderColor: Colors.light.hairline },
  body: { flex: 1, gap: 2, alignItems: 'flex-start' },
  title: { ...Type.callout, fontFamily: Type.headline.fontFamily },
  text: { ...Type.callout, color: Colors.light.text },
});
