import type { ExpoConfig } from 'expo/config';

/**
 * Cau hinh Expo doc tu bien moi truong.
 *
 * Google Maps API key KHONG duoc commit vao repo. Dat trong apps/mobile/.env
 * (xem .env.example) hoac trong EAS secrets khi build tren CI.
 */
const config: ExpoConfig = {
  name: 'Rong',
  slug: 'rong',
  // Project EAS Build (expo.dev/accounts/vlqvinh444/projects/rong).
  owner: 'vlqvinh444',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  // Scheme dung cho deep link moi nhom (FR-10.2).
  scheme: 'rong',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'vn.rong.app',
    supportsTablet: false,
    // Dùng icon.png chung. Muốn icon Liquid Glass của iOS 26 thì tạo file .icon bằng Icon Composer rồi trỏ tới đây.
    config: {
      googleMapsApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY,
    },
  },
  android: {
    package: 'vn.rong.app',
    adaptiveIcon: {
      backgroundColor: '#0A85EA',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
    },
    predictiveBackGestureEnabled: false,
    // Link mời nhóm (F10) mở thẳng app. Android xác minh qua /.well-known/assetlinks.json của backend
    // (env ANDROID_APP_LINK_SHA256 = SHA-256 chứng chỉ ký APK). Đổi phần này phải build APK mới.
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: 'www.rongthongdong.name.vn', pathPrefix: '/invite/' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
    config: {
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY,
      },
    },
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#0A85EA',
        // Nguyên tranh logo.
        image: './assets/images/splash-icon.png',
        imageWidth: 240,
      },
    ],
    // Lưu access token trong Keychain / Keystore.
    'expo-secure-store',
    // Đăng nhập Google (spec 2026-10-21-google-zalo-login). Client ID truyền lúc chạy qua EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.
    '@react-native-google-signin/google-signin',
    // Đăng nhập Zalo: chỉ cấu hình native khi có ZALO_APP_ID.
    ...(process.env.ZALO_APP_ID
      ? [['react-native-zalo-kit', { appId: process.env.ZALO_APP_ID }] as [string, object]]
      : []),
    // Vị trí hiện tại trên bản đồ vùng, chỉ khi đang dùng app (không chạy nền).
    [
      'expo-location',
      {
        locationWhenInUsePermission: 'Rong dùng vị trí của bạn để hiện bạn đang ở đâu trên bản đồ.',
      },
    ],
    // Nhận link/văn bản chia sẻ từ app khác (F4): iOS Share Extension, Android intent SEND.
    [
      'expo-share-intent',
      {
        iosActivationRules: { NSExtensionActivationSupportsWebURLWithMaxCount: 1, NSExtensionActivationSupportsText: true },
        iosAppGroupIdentifier: 'group.vn.rong.app',
        androidIntentFilters: ['text/*'],
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3001',
    // Bật nút đăng nhập Zalo (lib/oauth.ts); plugin native đọc cùng biến lúc build.
    zaloAppId: process.env.ZALO_APP_ID ?? null,
    eas: {
      projectId: 'ee0015b7-3b87-4e3d-8a5f-1edf7738cbb4',
    },
  },
};

export default config;
