import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

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
  it('đăng nhập (chưa có ai → có người dùng): query đầu tiên của phiên mới vẫn tải xong', async () => {
    function FirstQuery() {
      const query = useQuery({ queryKey: ['first'], queryFn: async () => 'ok' });
      return <Text>{query.status}</Text>;
    }
    mockUserId = null;
    const view = await render(<QueryProvider>{null}</QueryProvider>);
    mockUserId = 'u2';
    await view.rerender(
      <QueryProvider>
        <FirstQuery />
      </QueryProvider>,
    );
    await waitFor(() => expect(screen.getByText('success')).toBeTruthy());
  });
});
