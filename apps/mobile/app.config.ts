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
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  // Scheme dung cho deep link moi nhom (FR-10.2).
  scheme: 'rong',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'vn.rong.app',
    supportsTablet: false,
    icon: './assets/expo.icon',
    config: {
      googleMapsApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY,
    },
  },
  android: {
    package: 'vn.rong.app',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
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
        backgroundColor: '#208AEF',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3001',
  },
};

export default config;
