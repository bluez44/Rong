import { Text, type TextProps } from 'react-native';

import { Type, type ThemeColor, type TypeStyle } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  /** Một style trong thang chữ của design system. Mặc định `body`. */
  type?: TypeStyle;
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'body', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return <Text style={[Type[type], { color: theme[themeColor ?? 'text'] }, style]} {...rest} />;
}
