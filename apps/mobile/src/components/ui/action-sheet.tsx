import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Icon, type IconName } from '@/components/ui/icon';
import { Colors, MinTouch, Radius, Spacing, Type } from '@/constants/theme';

export type SheetAction = {
  label: string;
  icon?: IconName;
  detail?: string;
  destructive?: boolean;
  onPress: () => void;
};

type ActionSheetProps = {
  visible: boolean;
  title?: string;
  message?: string;
  actions?: SheetAction[];
  /** Nội dung riêng thay cho danh sách hành động (ví dụ chỉnh giờ). */
  children?: ReactNode;
  onClose: () => void;
};

/**
 * Bảng hành động trượt từ dưới lên. Dùng thay `Alert` khi có hơn ba lựa chọn
 * (Android chỉ hiện tối đa ba nút). Chọn một hành động thì đóng bảng trước.
 */
export function ActionSheet({ visible, title, message, actions = [], children, onClose }: ActionSheetProps) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      header={
        title || message ? (
          <>
            {title ? (
              <Text style={styles.title} accessibilityRole="header">
                {title}
              </Text>
            ) : null}
            {message ? <Text style={styles.message}>{message}</Text> : null}
          </>
        ) : null
      }>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
        {actions.map((action) => (
          <Pressable
            key={action.label}
            accessibilityRole="button"
            onPress={() => {
              onClose();
              action.onPress();
            }}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
            {action.icon ? (
              <Icon name={action.icon} size={20} color={action.destructive ? Colors.light.danger : Colors.light.primary} />
            ) : null}
            <View style={styles.flex}>
              <Text numberOfLines={1} style={[styles.label, action.destructive && { color: Colors.light.danger }]}>{action.label}</Text>
              {action.detail ? <Text style={styles.detail}>{action.detail}</Text> : null}
            </View>
          </Pressable>
        ))}
        {children}
      </ScrollView>
      <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}>
        <Text numberOfLines={1} style={styles.cancelLabel}>Đóng</Text>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { ...Type.headline, color: Colors.light.text },
  message: { ...Type.subhead, color: Colors.light.textSecondary, marginTop: 2 },
  list: { marginTop: Spacing.two },
  listContent: { gap: Spacing.one, paddingBottom: Spacing.two },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: MinTouch,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Radius.md,
  },
  pressed: { backgroundColor: Colors.light.backgroundSelected },
  label: { ...Type.body, color: Colors.light.text },
  detail: { ...Type.footnote, color: Colors.light.textSecondary },
  cancel: { minHeight: MinTouch, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md },
  cancelLabel: { ...Type.headline, color: Colors.light.primary },
});
