import type { TabTriggerSlotProps } from 'expo-router/ui';
import { forwardRef, useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/ui/icon';
import { Palette, Radius, Spacing } from '@/constants/theme';

/** Chiều cao thanh tab nổi (không gồm khoảng cách tới đáy màn hình). */
export const TAB_BAR_HEIGHT = 64;

/** Khoảng cách từ đáy màn hình tới thanh: nằm trên thanh home, máy không có thanh home thì vẫn nổi lên một chút. */
export function useTabBarBottom() {
  const insets = useSafeAreaInsets();
  return Math.max(insets.bottom, Spacing.four);
}

/** `paddingBottom` cho nội dung cuộn của màn tab, để mục cuối không nằm dưới thanh tab nổi. */
export function useTabBarInset() {
  return useTabBarBottom() + TAB_BAR_HEIGHT + Spacing.four;
}

/**
 * Bàn phím đang mở. Thanh tab ẩn đi lúc đó: nếu cửa sổ co lại theo bàn phím (Android), thanh sẽ nổi ngay trên bàn
 * phím và che ô đang gõ.
 */
export function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    // iOS báo trước khi bàn phím chạy lên nên thanh ẩn cùng lúc; Android chỉ có sự kiện "Did".
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

type TabButtonProps = TabTriggerSlotProps & {
  label: string;
  icon: IconName;
};

/** Một tab trong thanh tab nổi. Dùng làm con của `<TabTrigger asChild>`, nhận `isFocused` và `onPress` từ đó. */
export const TabButton = forwardRef<View, TabButtonProps>(function TabButton(
  { label, icon, isFocused, href: _href, style: _style, ...rest },
  ref,
) {
  const color = isFocused ? Palette.onPine : Palette.charcoalMuted;
  return (
    <Pressable
      ref={ref}
      accessibilityRole="tab"
      accessibilityState={{ selected: !!isFocused }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tab, isFocused && styles.tabFocused, pressed && styles.pressed]}
      {...rest}>
      <Icon name={icon} size={20} color={color} />
      <Text style={[styles.label, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: Radius.pill,
  },
  tabFocused: { backgroundColor: Palette.forest900 },
  pressed: { transform: [{ scale: 0.97 }] },
  label: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 10, lineHeight: 14 },
});
