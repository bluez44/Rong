// Reanimated/Worklets cần module native: dùng bản mock chúng tự cung cấp (Button dùng PressableScale).
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
