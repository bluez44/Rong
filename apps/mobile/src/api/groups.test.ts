import { groupsApi } from './groups';

describe('groupsApi', () => {
  const f = jest.fn().mockResolvedValue(undefined);
  const api = groupsApi(f);
  beforeEach(() => f.mockClear());

  it('nhóm', async () => {
    await api.list();
    expect(f).toHaveBeenLastCalledWith('/groups');
    await api.get('g1');
    expect(f).toHaveBeenLastCalledWith('/groups/g1');
    await api.create('Đà Lạt 2026');
    expect(f).toHaveBeenLastCalledWith('/groups', { method: 'POST', body: { name: 'Đà Lạt 2026' } });
    await api.rename('g1', 'Mới');
    expect(f).toHaveBeenLastCalledWith('/groups/g1', { method: 'PATCH', body: { name: 'Mới' } });
    await api.remove('g1');
    expect(f).toHaveBeenLastCalledWith('/groups/g1', { method: 'DELETE' });
  });

  it('thành viên, lời mời, lịch trình trong nhóm', async () => {
    await api.setMemberRole('g1', 'u2', 'editor');
    expect(f).toHaveBeenLastCalledWith('/groups/g1/members/u2', { method: 'PATCH', body: { role: 'editor' } });
    await api.removeMember('g1', 'u2');
    expect(f).toHaveBeenLastCalledWith('/groups/g1/members/u2', { method: 'DELETE' });
    await api.createInvite('g1', 'viewer');
    expect(f).toHaveBeenLastCalledWith('/groups/g1/invites', { method: 'POST', body: { role: 'viewer' } });
    await api.removeItinerary('g1', 'it1');
    expect(f).toHaveBeenLastCalledWith('/groups/g1/itineraries/it1', { method: 'DELETE' });
  });
});
