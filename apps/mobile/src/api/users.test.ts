import { usersApi } from './users';

describe('usersApi', () => {
  it('sửa hồ sơ và xóa tài khoản', async () => {
    const f = jest.fn().mockResolvedValue(undefined);
    const api = usersApi(f);
    await api.update({ displayName: 'Lan' });
    expect(f).toHaveBeenLastCalledWith('/users/me', { method: 'PATCH', body: { displayName: 'Lan' } });
    await api.update({ interests: ['cafe'] });
    expect(f).toHaveBeenLastCalledWith('/users/me', { method: 'PATCH', body: { interests: ['cafe'] } });
    await api.remove();
    expect(f).toHaveBeenLastCalledWith('/users/me', { method: 'DELETE' });
  });
});
