import { itinerariesApi } from './itineraries';

describe('itinerariesApi', () => {
  const f = jest.fn().mockResolvedValue(undefined);
  const api = itinerariesApi(f);
  beforeEach(() => f.mockClear());

  it('đọc', async () => {
    await api.list();
    expect(f).toHaveBeenLastCalledWith('/itineraries');
    await api.get('it1');
    expect(f).toHaveBeenLastCalledWith('/itineraries/it1');
    await api.alternatives('it1', 'p1');
    expect(f).toHaveBeenLastCalledWith('/itineraries/it1/alternatives?placeId=p1');
    await api.shareLink('it1');
    expect(f).toHaveBeenLastCalledWith('/itineraries/it1/share-link');
  });

  it('ghi', async () => {
    const body = { regionId: 'r1' } as never;
    await api.create(body);
    expect(f).toHaveBeenLastCalledWith('/itineraries', { method: 'POST', body });
    await api.update('it1', body);
    expect(f).toHaveBeenLastCalledWith('/itineraries/it1', { method: 'PUT', body });
    await api.remove('it1');
    expect(f).toHaveBeenLastCalledWith('/itineraries/it1', { method: 'DELETE' });
    await api.setGroup('it1', 'g1');
    expect(f).toHaveBeenLastCalledWith('/itineraries/it1/group', { method: 'PATCH', body: { groupId: 'g1' } });
    await api.setGroup('it1', null);
    expect(f).toHaveBeenLastCalledWith('/itineraries/it1/group', { method: 'PATCH', body: { groupId: null } });
    await api.ensureShareLink('it1');
    expect(f).toHaveBeenLastCalledWith('/itineraries/it1/share-link', { method: 'PUT' });
  });
});
