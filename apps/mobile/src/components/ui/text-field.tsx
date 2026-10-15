import { forwardRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
} from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';

export type TextFieldProps = Omit<TextInputProps, 'style'> & {
  label: string;
  /** Gợi ý luôn hiện dưới ô, ví dụ yêu cầu độ dài mật khẩu. Bị thay bằng `error` khi có lỗi. */
  hint?: string;
  error?: string | null;
  /** Ô mật khẩu: ẩn chữ và có nút Hiện/Ẩn. */
  password?: boolean;
  /** Biểu tượng đầu ô, nếu màn hình cần. */
  leadingIcon?: IconName;
  /** Tuỳ chỉnh nhãn cho kiểu micro-label. */
  labelStyle?: StyleProp<TextStyle>;
};

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, hint, error, password, leadingIcon, labelStyle, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const message = error ?? hint;

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, labelStyle]}>{label}</Text>
      <View style={[styles.box, focused && styles.boxFocused, !!error && styles.boxError]}>
        {leadingIcon ? (
          <Icon
            name={leadingIcon}
            size={18}
            color={Colors.light.textSecondary}
            style={styles.leadingIcon}
          />
        ) : null}
        <TextInput
          ref={ref}
          style={styles.input}
          placeholderTextColor={Colors.light.textSecondary}
          selectionColor={Colors.light.primary}
          secureTextEntry={password && !revealed}
          autoCorrect={false}
          accessibilityLabel={label}
          accessibilityHint={message ?? undefined}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
        {password ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
            hitSlop={8}
            onPress={() => setRevealed((v) => !v)}
            style={styles.reveal}>
            <Text style={styles.revealText}>{revealed ? 'Ẩn' : 'Hiện'}</Text>
          </Pressable>
        ) : null}
      </View>
      {message ? <Text style={[styles.message, !!error && styles.messageError]}>{message}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  label: { ...Type.subhead, color: Colors.light.text },
  leadingIcon: { marginLeft: Spacing.four },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    backgroundColor: Colors.light.surface,
    borderWidth: 1,
    borderColor: Colors.light.hairline,
  },
  boxFocused: { borderColor: Colors.light.primary, borderWidth: 2 },
  boxError: { borderColor: Colors.light.danger, borderWidth: 2 },
  input: { flex: 1, ...Type.body, color: Colors.light.text, paddingHorizontal: Spacing.four, paddingVertical: Spacing.three },
  reveal: { paddingHorizontal: Spacing.four, alignSelf: 'stretch', justifyContent: 'center' },
  revealText: { ...Type.subhead, color: Colors.light.primary },
  message: { ...Type.footnote, color: Colors.light.textSecondary },
  messageError: { color: Colors.light.danger },
});
