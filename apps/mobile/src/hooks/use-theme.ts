import { Colors } from '@/constants/theme';

/** App hiện chỉ có giao diện sáng; khi thêm giao diện tối, chọn theo useColorScheme ở đây. */
export function useTheme() {
  return Colors.light;
}
