import type { ReactNode } from 'react';
import { KeyboardAvoidingView, StyleSheet, type KeyboardAvoidingViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';

/**
 * KeyboardAvoidingView với cấu hình chung của app. Dùng "padding" cho cả hai nền tảng:
 * Android chạy edge-to-edge nên cửa sổ không tự co lại khi bàn phím mở. Nếu cửa sổ có
 * co thì view không bị bàn phím đè, padding tính ra bằng 0, không bị đệm hai lần.
 */
export function KeyboardAvoider({ style, ...props }: KeyboardAvoidingViewProps) {
  return <KeyboardAvoidingView behavior="padding" style={[styles.flex, style]} {...props} />;
}

type ScreenProps = {
  children: ReactNode;
  /** Cạnh cần chừa vùng an toàn. Bỏ 'bottom' khi danh sách cuộn được xuống dưới thanh home. */
  edges?: Edge[];
  /** Nền của cả màn hình, kể cả phần dưới tai thỏ và thanh home. */
  style?: StyleProp<ViewStyle>;
  /** Bố cục nội dung bên trong vùng an toàn. */
  contentStyle?: StyleProp<ViewStyle>;
};

/**
 * Khung mặc định cho mọi màn hình: chừa tai thỏ, thanh home, và co nội dung lại khi bàn
 * phím mở để ô nhập và nút bấm không bị che.
 */
export function Screen({ children, edges = ['top', 'bottom'], style, contentStyle }: ScreenProps) {
  return (
    <SafeAreaView style={[styles.screen, style]} edges={edges}>
      <KeyboardAvoider style={contentStyle}>{children}</KeyboardAvoider>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: Colors.light.background },
});
