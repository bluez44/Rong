import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Glass } from '@/components/glass';
import { Icon, type IconName } from '@/components/ui/icon';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';

type ChipProps = {
  label: string;
  selected?: boolean;
  icon?: IconName;
  /** Chip nằm thẳng trên bản đồ. Trong bottom sheet (đã là kính) thì để false. */
  glass?: boolean;
  onPress: () => void;
};

/** Chip lọc. Đã chọn thì nền pine đặc, bỏ kính. */
export function Chip({ label, selected, icon, glass, onPress }: ChipProps) {
  const color = selected ? Colors.light.onPrimary : Colors.light.text;
  const content = (
    <>
      {icon ? <Icon name={icon} size={16} color={selected ? Colors.light.onPrimary : Colors.light.primary} /> : null}
      <Text style={[styles.label, { color }]}>{label}</Text>
    </>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={label}
      hitSlop={{ top: 6, bottom: 6 }}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed]}>
      {glass && !selected ? (
        <Glass shape="capsule" interactive style={styles.chip}>
          {content}
        </Glass>
      ) : (
        <View style={[styles.chip, selected ? styles.selected : styles.solid]}>{content}</View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    minHeight: 36,
    paddingHorizontal: Spacing.three + 2,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  solid: { backgroundColor: Colors.light.surface, borderWidth: 1, borderColor: Colors.light.hairline },
  selected: { backgroundColor: Colors.light.primary, borderWidth: 1, borderColor: Colors.light.primary },
  label: { ...Type.subhead },
  pressed: { opacity: 0.8 },
});
