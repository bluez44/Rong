import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Colors, MinTouch, Radius, Spacing, Type } from '@/constants/theme';

type StepperProps = {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
};

/** Tăng giảm một số nguyên. Với trình đọc màn hình là một phần tử "adjustable" (vuốt lên/xuống). */
export function Stepper({ label, hint, value, min, max, onChange }: StepperProps) {
  const dec = () => value > min && onChange(value - 1);
  const inc = () => value < max && onChange(value + 1);

  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={hint ? `${label}, ${hint}` : label}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'increment' ? inc() : dec())}>
      <View style={styles.flex}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <StepButton icon="remove" disabled={value <= min} onPress={dec} />
      <Text style={styles.value}>{value}</Text>
      <StepButton icon="add" disabled={value >= max} onPress={inc} />
    </View>
  );
}

function StepButton({ icon, disabled, onPress }: { icon: 'add' | 'remove'; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.button, disabled && styles.disabled, pressed && styles.pressed]}>
      <Icon name={icon} size={18} color={disabled ? Colors.light.textDisabled : Colors.light.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: MinTouch },
  label: { ...Type.body, color: Colors.light.text },
  hint: { ...Type.footnote, color: Colors.light.textSecondary },
  value: { ...Type.numeric, color: Colors.light.text, minWidth: 24, textAlign: 'center' },
  button: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light.backgroundSelected,
  },
  disabled: { backgroundColor: Colors.light.backgroundElement },
  pressed: { opacity: 0.7 },
});
