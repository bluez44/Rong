import { useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';

type CodeInputProps = {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  error?: boolean;
  editable?: boolean;
  autoFocus?: boolean;
};

/**
 * Ô nhập mã xác minh. Một TextInput thật (trong suốt) phủ lên các ô hiển thị,
 * để dán mã và tự điền mã từ bàn phím (one-time-code) đều hoạt động.
 */
export function CodeInput({ value, onChange, length = 6, error, editable = true, autoFocus }: CodeInputProps) {
  const inputRef = useRef<TextInput>(null);
  const activeIndex = Math.min(value.length, length - 1);

  return (
    <Pressable onPress={() => inputRef.current?.focus()} style={styles.row} accessible={false}>
      {Array.from({ length }, (_, i) => (
        <View
          key={i}
          style={[styles.cell, error ? styles.cellError : i === activeIndex && editable && styles.cellActive]}>
          <Text style={styles.digit}>{value[i] ?? ''}</Text>
        </View>
      ))}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={length}
        editable={editable}
        autoFocus={autoFocus}
        caretHidden
        accessibilityLabel={`Mã xác minh ${length} chữ số`}
        style={styles.hiddenInput}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two, justifyContent: 'space-between' },
  cell: {
    flex: 1,
    maxWidth: 52,
    height: 60,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
    backgroundColor: Colors.light.surface,
    borderWidth: 1,
    borderColor: Colors.light.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellActive: { borderWidth: 2, borderColor: Colors.light.primary },
  cellError: { borderWidth: 2, borderColor: Colors.light.danger },
  digit: { fontFamily: 'BeVietnamPro_700Bold', fontSize: 26, lineHeight: 32, color: Colors.light.text, fontVariant: ['tabular-nums'] },
  hiddenInput: { ...StyleSheet.absoluteFill, opacity: 0.02, color: 'transparent' },
});
