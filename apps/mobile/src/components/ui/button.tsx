import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { Glass } from '@/components/glass';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Colors, MinTouch, Radius, Spacing, Type } from '@/constants/theme';

export type ButtonVariant = 'primary' | 'glass' | 'ai' | 'plain' | 'danger';

export type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  /** Đang chờ máy chủ: tắt nút và hiện vòng quay cạnh nhãn. */
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
};

const HEIGHT = { sm: 34, md: MinTouch, lg: 54 } as const;

export function Button({ label, variant = 'primary', size = 'md', loading, disabled, style, onPressIn, onPressOut, ...rest }: ButtonProps) {
  const inactive = disabled || loading;
  const [pressed, setPressed] = useState(false);
  const textColor = inactive && variant === 'primary' ? Colors.light.textDisabled : TEXT_COLOR[variant];

  const content = (
    <>
      {loading ? <ActivityIndicator size="small" color={textColor} /> : null}
      <Text
        style={[size === 'lg' ? styles.labelLg : size === 'sm' ? styles.labelSm : styles.label, styles.shrink, { color: textColor }]}
        numberOfLines={1}
        ellipsizeMode="tail">
        {label}
      </Text>
    </>
  );

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      hitSlop={size === 'sm' ? 5 : undefined}
      onPressIn={(e) => {
        setPressed(true);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setPressed(false);
        onPressOut?.(e);
      }}
      style={[
        styles.base,
        { minHeight: HEIGHT[size], paddingHorizontal: size === 'sm' ? Spacing.three : Spacing.five },
        variant === 'primary' && { backgroundColor: inactive ? Colors.light.backgroundElement : pressed ? Colors.light.primaryPressed : Colors.light.primary },
        variant === 'ai' && { backgroundColor: Colors.light.aiFill },
        style,
      ]}
      {...rest}>
      {variant === 'glass' ? (
        <Glass shape="capsule" interactive style={[StyleSheet.absoluteFill]} pointerEvents="none" />
      ) : null}
      {content}
    </PressableScale>
  );
}

const TEXT_COLOR: Record<ButtonVariant, string> = {
  primary: Colors.light.onPrimary,
  glass: Colors.light.text,
  ai: Colors.light.text,
  plain: Colors.light.primary,
  danger: Colors.light.danger,
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: Radius.pill,
  },
  label: { ...Type.headline, fontSize: 16, lineHeight: 22 },
  labelLg: Type.headline,
  labelSm: Type.subhead,
  // Nhãn luôn một dòng (numberOfLines): co lại để "…" hiện trong nút thay vì tràn ra ngoài.
  shrink: { flexShrink: 1 },
});
