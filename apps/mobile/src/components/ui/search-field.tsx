import { forwardRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Glass } from '@/components/glass';
import { Icon } from '@/components/ui/icon';
import { Colors, MinTouch, Spacing, Type } from '@/constants/theme';

export type SearchFieldProps = Omit<TextInputProps, 'style'> & {
  /** Thường là nút "Hủy" khi đang tìm. Nằm ngoài viên kính. */
  trailing?: ReactNode;
};

/** Ô tìm điểm đến dạng viên kính, nổi ở đầu màn hình. */
export const SearchField = forwardRef<TextInput, SearchFieldProps>(function SearchField(
  { trailing, value, onChangeText, placeholder = 'Tìm tỉnh, thành phố hoặc điểm đến', ...rest },
  ref,
) {
  return (
    <View style={styles.row}>
      <Glass shape="capsule" style={styles.pill}>
        <Icon name="search" />
        <TextInput
          ref={ref}
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={Colors.light.textSecondary}
          selectionColor={Colors.light.primary}
          accessibilityLabel={placeholder}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          {...rest}
        />
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
  input: { flex: 1, ...Type.body, color: Colors.light.text, paddingVertical: Spacing.three },
});
