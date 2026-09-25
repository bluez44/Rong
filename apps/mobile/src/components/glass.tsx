import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View, type ViewProps } from 'react-native';

import { GlassTokens, Palette, Radius, Shadow, Spacing } from '@/constants/theme';

export type GlassVariant = 'regular' | 'clear' | 'strong' | 'tinted';
export type GlassShape = 'rounded' | 'capsule' | 'circle';

export type GlassProps = ViewProps & {
  variant?: GlassVariant;
  shape?: GlassShape;
  padded?: boolean;
  /** Kính phản hồi khi chạm (iOS 26). Bật cho nút và tab. */
  interactive?: boolean;
};

const nativeGlass = Platform.OS === 'ios' && isGlassEffectAPIAvailable();

/**
 * Lớp kính cho điều khiển nổi trên nội dung: ô tìm kiếm, bottom sheet, tab
 * bar, nút trên bản đồ. Nội dung (dòng địa điểm, thẻ lịch trình) không đặt
 * trên kính, và không chồng kính lên kính.
 */
export function Glass({ variant = 'regular', shape = 'rounded', padded, interactive, style, children, ...rest }: GlassProps) {
  const reduceTransparency = useReduceTransparency();
  const shapeStyle = [styles[shape], padded && styles.padded];

  if (nativeGlass && !reduceTransparency) {
    return (
      <GlassView
        glassEffectStyle={variant === 'clear' ? 'clear' : 'regular'}
        tintColor={variant === 'tinted' ? Palette.pine700 : undefined}
        colorScheme="light"
        isInteractive={interactive}
        style={[shapeStyle, style]}
        {...rest}>
        {children}
      </GlassView>
    );
  }

  return (
    <View style={[styles.fallback, variant === 'tinted' && styles.fallbackTinted, Shadow.glass, shapeStyle, style]} {...rest}>
      {children}
    </View>
  );
}

function useReduceTransparency() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceTransparencyEnabled().then(setEnabled);
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setEnabled);
    return () => sub.remove();
  }, []);
  return enabled;
}

const styles = StyleSheet.create({
  rounded: { borderRadius: Radius.lg, borderCurve: 'continuous' },
  capsule: { borderRadius: Radius.pill },
  circle: { borderRadius: Radius.pill, aspectRatio: 1 },
  padded: { padding: Spacing.four },
  // Không có blur thật phía sau nên dùng nền gần đặc, viền sáng ở mép trên.
  fallback: {
    backgroundColor: GlassTokens.fallback,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GlassTokens.rim,
  },
  fallbackTinted: { backgroundColor: Palette.pine700, borderColor: 'transparent' },
});
