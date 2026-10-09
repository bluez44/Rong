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
    // Vị trí hiện tại trên bản đồ vùng, chỉ khi đang dùng app (không chạy nền).
    [
      'expo-location',
      {
        locationWhenInUsePermission: 'Rong dùng vị trí của bạn để hiện bạn đang ở đâu trên bản đồ.',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3001',
    eas: {
      projectId: 'ee0015b7-3b87-4e3d-8a5f-1edf7738cbb4',
    },
  },
};

export default config;
