/**
 * Design system của Rong — Liquid Glass, bảng màu "Sương Đà Lạt".
 * Nguồn gốc: artifact Design System "Rong" (tokens.json). Đổi giá trị ở đây
 * thì cập nhật cả bên đó để hai nơi không lệch nhau.
 *
 * App hiện chỉ có giao diện sáng.
 */

import '@/global.css';

import { Platform, type TextStyle, type ViewStyle } from 'react-native';

export const Palette = {
  pine900: '#1E4A3B',
  pine700: '#2F6B55',
  pine500: '#4F8A72',
  pine200: '#C4DDD1',
  pine100: '#E1EEE7',
  lavender700: '#5B4BC4',
  lavender400: '#9C8CF2',
  lavender100: '#ECE8FD',
  persimmon700: '#A8431A',
  persimmon500: '#E8702A',
  persimmon100: '#FCE6D8',
  mist50: '#F1F3F0',
  mist100: '#E6EAE5',
  mist200: '#D5DCD6',
  surface: '#FFFFFF',
  ink: '#16231D',
  inkMuted: '#56645C',
  inkSubtle: '#7C8A82',
  onPine: '#FFFFFF',
  amber700: '#8A5A00',
  amber100: '#FBF0D9',
  danger700: '#B3261E',
  danger100: '#FBE4E1',
  scrim: 'rgba(22, 35, 29, 0.32)',
  mapLand: '#E3E9E1',
  mapWater: '#BCD7D3',
  mapPark: '#CFE1C8',
  mapRoad: '#FFFFFF',
} as const;

/** Vai trò màu. Mỗi màu có một việc: pine = hành động, lavender = AI, persimmon = "Đang hot". */
export const Colors = {
  light: {
    text: Palette.ink,
    textSecondary: Palette.inkMuted,
    textDisabled: Palette.inkSubtle,
    background: Palette.mist50,
    backgroundElement: Palette.mist100,
    backgroundSelected: Palette.pine100,
    surface: Palette.surface,
    hairline: Palette.mist200,
    primary: Palette.pine700,
    primaryPressed: Palette.pine900,
    onPrimary: Palette.onPine,
    ai: Palette.lavender700,
    aiFill: Palette.lavender400,
    aiBackground: Palette.lavender100,
    hot: Palette.persimmon700,
    hotFill: Palette.persimmon500,
    hotBackground: Palette.persimmon100,
    warning: Palette.amber700,
    warningBackground: Palette.amber100,
    danger: Palette.danger700,
    dangerBackground: Palette.danger100,
    focus: Palette.lavender700,
  },
} as const;

export type ThemeColor = keyof typeof Colors.light;

/**
 * Kính. Trên iOS 26+ `Glass` dùng GlassView gốc; các màu dưới đây là bản dự
 * phòng cho iOS cũ, Android, web và khi bật Giảm độ trong suốt.
 */
export const GlassTokens = {
  regular: 'rgba(255, 255, 255, 0.58)',
  clear: 'rgba(255, 255, 255, 0.24)',
  strong: 'rgba(250, 252, 250, 0.84)',
  /** Nền đặc hơn khi không có blur thật phía sau. */
  fallback: 'rgba(250, 252, 250, 0.94)',
  tint: 'rgba(47, 107, 85, 0.86)',
  rim: 'rgba(255, 255, 255, 0.78)',
} as const;

export const Spacing = {
  one: 4,
  two: 8,
  three: 12,
  four: 16,
  five: 20,
  six: 24,
  eight: 32,
  twelve: 48,
} as const;

/** Bo góc lồng nhau: bo trong = bo ngoài − padding. Mọi thứ bấm được là viên thuốc. */
export const Radius = {
  sm: 10,
  md: 16,
  lg: 24,
  sheet: 32,
  pill: 999,
} as const;

export const Shadow = {
  glass: Platform.select<ViewStyle>({
    ios: { shadowColor: Palette.ink, shadowOpacity: 0.14, shadowRadius: 15, shadowOffset: { width: 0, height: 10 } },
    default: { elevation: 6 },
  }),
  card: Platform.select<ViewStyle>({
    ios: { shadowColor: Palette.ink, shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 4 } },
    default: { elevation: 1 },
  }),
  marker: Platform.select<ViewStyle>({
    ios: { shadowColor: Palette.ink, shadowOpacity: 0.28, shadowRadius: 5, shadowOffset: { width: 0, height: 4 } },
    default: { elevation: 4 },
  }),
};

/**
 * Be Vietnam Pro, nạp bằng @expo-google-fonts/be-vietnam-pro trong _layout.
 * React Native không tự chọn file theo fontWeight với font tự nạp, nên mỗi độ
 * đậm là một family riêng.
 */
export const FontFamily = {
  regular: 'BeVietnamPro_400Regular',
  medium: 'BeVietnamPro_500Medium',
  semibold: 'BeVietnamPro_600SemiBold',
  bold: 'BeVietnamPro_700Bold',
  extrabold: 'BeVietnamPro_800ExtraBold',
} as const;

/**
 * Thang chữ. Tiếng Việt có dấu chồng (Ở, Ễ, Ự) nên line-height luôn ≥ 1,2 lần
 * cỡ chữ. letterSpacing tính bằng px (RN không nhận em).
 */
export const Type = {
  display: { fontFamily: FontFamily.extrabold, fontSize: 34, lineHeight: 42, letterSpacing: -0.68 },
  title1: { fontFamily: FontFamily.bold, fontSize: 28, lineHeight: 36, letterSpacing: -0.42 },
  title2: { fontFamily: FontFamily.bold, fontSize: 22, lineHeight: 30, letterSpacing: -0.22 },
  headline: { fontFamily: FontFamily.semibold, fontSize: 17, lineHeight: 24 },
  body: { fontFamily: FontFamily.regular, fontSize: 16, lineHeight: 24 },
  callout: { fontFamily: FontFamily.regular, fontSize: 15, lineHeight: 22 },
  subhead: { fontFamily: FontFamily.medium, fontSize: 14, lineHeight: 20 },
  footnote: { fontFamily: FontFamily.regular, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: FontFamily.semibold, fontSize: 12, lineHeight: 16, letterSpacing: 0.12 },
  numeric: { fontFamily: FontFamily.semibold, fontSize: 15, lineHeight: 20, fontVariant: ['tabular-nums'] },
} satisfies Record<string, TextStyle>;

export type TypeStyle = keyof typeof Type;

/** Vùng chạm tối thiểu. */
export const MinTouch = 44;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
