// Ngoài src/app: expo-router coi mọi file trong app/ là một route.
import { fireEvent, render, screen } from '@testing-library/react-native';
import LoginScreen from '@/app/(auth)/login';

const mockLogin = jest.fn();
jest.mock('@/auth/auth-context', () => ({
  useAuth: () => ({ login: mockLogin, resendVerification: jest.fn(), sessionExpired: false }),
}));
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: unknown }) => children,
  useLocalSearchParams: () => ({ email: 'an@gmail.com' }),
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
// Thay nút Google/Zalo bằng một nút giả báo "đang đăng nhập".
jest.mock('@/components/oauth-buttons', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    OAuthButtons: ({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) => (
      <Pressable accessibilityRole="button" onPress={() => onBusyChange?.(true)}>
        <Text>giả lập đang đăng nhập Google</Text>
      </Pressable>
    ),
  };
});

describe('LoginScreen', () => {
  it('đang đăng nhập Google/Zalo thì phím "Go" trên bàn phím không gửi form email', async () => {
    await render(<LoginScreen />);
    await fireEvent.press(screen.getByText('giả lập đang đăng nhập Google'));
    const password = screen.getByLabelText('MẬT KHẨU');
    await fireEvent.changeText(password, 'mat-khau-du-dai');
    await fireEvent(password, 'submitEditing');
    expect(mockLogin).not.toHaveBeenCalled();
  });
});
