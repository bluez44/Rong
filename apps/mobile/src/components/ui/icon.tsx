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
  back: { ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' },
  // Danh mục địa điểm, khớp PlaceCategory.
  check_in: { ios: 'camera', android: 'photo_camera', web: 'photo_camera' },
  food: { ios: 'fork.knife', android: 'restaurant', web: 'restaurant' },
  cafe: { ios: 'cup.and.saucer', android: 'local_cafe', web: 'local_cafe' },
  nature: { ios: 'leaf', android: 'park', web: 'park' },
  kids: { ios: 'figure.and.child.holdinghands', android: 'child_care', web: 'child_care' },
  culture: { ios: 'building.columns', android: 'account_balance', web: 'account_balance' },
  nightlife: { ios: 'moon.stars', android: 'nightlife', web: 'nightlife' },
  stay: { ios: 'bed.double', android: 'hotel', web: 'hotel' },
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
