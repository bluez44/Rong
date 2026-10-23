import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';

import { QueryProvider } from './query-provider';

let mockUserId: string | null = 'u1';
jest.mock('@/auth/auth-context', () => ({
  useAuth: () => ({ session: mockUserId ? { user: { id: mockUserId } } : null }),
}));

describe('QueryProvider', () => {
  it('đổi người dùng hay đăng xuất thì xóa cache của người trước', async () => {
    let client: QueryClient | null = null;
    function Capture() {
      client = useQueryClient();
      return null;
    }
    const tree = () => (
      <QueryProvider>
        <Capture />
      </QueryProvider>
    );

    mockUserId = 'u1';
    const view = await render(tree());
    client!.setQueryData(['probe'], 'của u1');
    await view.rerender(tree());
    expect(client!.getQueryData(['probe'])).toBe('của u1');

    mockUserId = 'u2';
    await view.rerender(tree());
    expect(client!.getQueryData(['probe'])).toBeUndefined();

    client!.setQueryData(['probe'], 'của u2');
    mockUserId = null;
    await view.rerender(tree());
    expect(client!.getQueryData(['probe'])).toBeUndefined();
  });
});
