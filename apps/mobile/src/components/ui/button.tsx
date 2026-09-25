import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { Glass } from '@/components/glass';
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

export function Button({ label, variant = 'primary', size = 'md', loading, disabled, style, ...rest }: ButtonProps) {
  const inactive = disabled || loading;
  const textColor = inactive && variant === 'primary' ? Colors.light.textDisabled : TEXT_COLOR[variant];

  const content = (
    <>
      {loading ? <ActivityIndicator size="small" color={textColor} /> : null}
      <Text style={[size === 'lg' ? styles.labelLg : size === 'sm' ? styles.labelSm : styles.label, { color: textColor }]}>{label}</Text>
    </>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      hitSlop={size === 'sm' ? 5 : undefined}
      style={({ pressed }) => [
        styles.base,
        { minHeight: HEIGHT[size], paddingHorizontal: size === 'sm' ? Spacing.three : Spacing.five },
        variant === 'primary' && { backgroundColor: inactive ? Colors.light.backgroundElement : pressed ? Colors.light.primaryPressed : Colors.light.primary },
        variant === 'ai' && { backgroundColor: Colors.light.aiFill },
        pressed && !inactive && styles.pressed,
        style,
      ]}
      {...rest}>
      {variant === 'glass' ? (
        <Glass shape="capsule" interactive style={[StyleSheet.absoluteFill]} pointerEvents="none" />
      ) : null}
      {content}
    </Pressable>
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
  pressed: { transform: [{ scale: 0.97 }] },
  label: { ...Type.headline, fontSize: 16, lineHeight: 22 },
  labelLg: Type.headline,
  labelSm: Type.subhead,
});
