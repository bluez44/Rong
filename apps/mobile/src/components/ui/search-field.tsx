import { forwardRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { Glass } from '@/components/glass';
import { Icon } from '@/components/ui/icon';
import { Colors, MinTouch, Spacing, Type } from '@/constants/theme';

export type SearchFieldProps = Omit<TextInputProps, 'style'> & {
  /** Thường là nút "Hủy" khi đang tìm. Nằm ngoài viên kính. */
  trailing?: ReactNode;
};

/**
 * Ô tìm điểm đến dạng viên kính, nổi ở đầu màn hình. Luôn một dòng: chữ gợi ý và chữ đã gõ (lúc ô không được
 * chọn) dài quá thì cắt bằng "…". Chữ gợi ý tự vẽ vì placeholder gốc của Android tự xuống dòng.
 */
export const SearchField = forwardRef<TextInput, SearchFieldProps>(function SearchField(
  { trailing, value, onChangeText, placeholder = 'Tìm tỉnh, thành phố hoặc điểm đến', onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  // Ô không được chọn: chữ đã gõ hiện bằng một dòng Text cắt "…", chữ của ô nhập ẩn đi.
  const overlay = value ? (focused ? null : value) : placeholder;

  return (
    <View style={styles.row}>
      <Glass shape="capsule" style={styles.pill}>
        <Icon name="search" />
        <View style={styles.field}>
          <TextInput
            ref={ref}
            style={[styles.input, !!value && !focused && styles.hiddenText]}
            value={value}
            onChangeText={onChangeText}
            selectionColor={Colors.light.primary}
            accessibilityLabel={placeholder}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            numberOfLines={1}
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
          {overlay ? (
            <Text
              style={[styles.overlay, !value && styles.placeholder]}
              numberOfLines={1}
              ellipsizeMode="tail"
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants">
              {overlay}
            </Text>
          ) : null}
        </View>
        {value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Xóa nội dung tìm kiếm"
            hitSlop={12}
            onPress={() => onChangeText?.('')}>
            <Icon name="clear" size={18} color={Colors.light.textDisabled} />
          </Pressable>
        ) : null}
      </Glass>
      {trailing}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: MinTouch + 8,
    paddingHorizontal: Spacing.four,
  },
  field: { flex: 1, justifyContent: 'center' },
  input: { ...Type.body, color: Colors.light.text, paddingVertical: Spacing.three, paddingHorizontal: 0 },
  hiddenText: { color: 'transparent' },
  // Nằm giữa theo chiều dọc nhờ `justifyContent` của `field`.
  overlay: { position: 'absolute', left: 0, right: 0, ...Type.body, color: Colors.light.text },
  placeholder: { color: Colors.light.textSecondary },
});
