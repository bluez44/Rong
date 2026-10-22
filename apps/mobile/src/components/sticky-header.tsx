import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { Palette, Radius, Shadow } from "@/constants/theme";

/** Chỗ chừa dưới header cho bóng (iOS: offset 10 + radius 18). */
const SHADOW_ROOM = 32;

type StickyHeaderProps = {
  children: ReactNode;
  /** Nội dung bên dưới đã cuộn: header đổ bóng xuống. */
  scrolled: boolean;
  /**
   * Bố cục riêng của từng màn (padding, hàng ngang...). Không đặt tên `style`: ScrollView chuyển `style`
   * của phần tử trong `stickyHeaderIndices` sang view bọc nó, làm padding rơi ra ngoài nền header.
   */
  contentStyle?: StyleProp<ViewStyle>;
};

/**
 * Header dính đầu các tab, bo góc dưới và đổ bóng khi cuộn. View bọc ngoài cắt bóng
 * (`overflow: 'hidden'`) để chỉ còn bóng ở cạnh dưới, không lan lên thanh trạng thái.
 */
export function StickyHeader({ children, scrolled, contentStyle }: StickyHeaderProps) {
  return (
    <View style={styles.clip} pointerEvents="box-none">
      <View style={[styles.header, scrolled && styles.scrolled, contentStyle]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: "hidden",
    paddingBottom: SHADOW_ROOM,
    marginBottom: -SHADOW_ROOM,
    zIndex: 1,
  },
  header: {
    backgroundColor: Palette.parchment50,
    borderBottomLeftRadius: Radius.lg,
    borderBottomRightRadius: Radius.lg,
  },
  scrolled: { ...Shadow.header },
});
