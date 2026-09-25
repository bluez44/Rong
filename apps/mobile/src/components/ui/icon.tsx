import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import type { ColorValue, StyleProp, ViewStyle } from 'react-native';

import { Colors } from '@/constants/theme';

type SymbolName = ComponentProps<typeof SymbolView>['name'];

/** SF Symbols trên iOS, Material Symbols trên Android và web. Thêm icon mới vào đây. */
const ICONS = {
  search: { ios: 'magnifyingglass', android: 'search', web: 'search' },
  clear: { ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' },
  layers: { ios: 'square.3.layers.3d', android: 'layers', web: 'layers' },
  pin: { ios: 'mappin', android: 'location_on', web: 'location_on' },
} satisfies Record<string, SymbolName>;

export type IconName = keyof typeof ICONS;

type IconProps = {
  name: IconName;
  size?: number;
  color?: ColorValue;
  style?: StyleProp<ViewStyle>;
};

/** Icon trang trí, luôn đi kèm chữ nên bị ẩn khỏi trình đọc màn hình. */
export function Icon({ name, size = 20, color = Colors.light.textSecondary, style }: IconProps) {
  return (
    <SymbolView
      name={ICONS[name]}
      size={size}
      tintColor={color}
      style={[{ width: size, height: size }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
