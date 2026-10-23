import { invitesApi } from './invites';

describe('invitesApi', () => {
  it('xem trước và nhận lời mời, mã hóa token', async () => {
    const f = jest.fn().mockResolvedValue(undefined);
    const api = invitesApi(f);
    await api.preview('a b/c');
    expect(f).toHaveBeenLastCalledWith('/invites/a%20b%2Fc');
    await api.accept('a b/c');
    expect(f).toHaveBeenLastCalledWith('/invites/a%20b%2Fc/accept', { method: 'POST' });
  });
});
