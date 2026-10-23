import { savedPlacesApi } from './saved-places';

describe('savedPlacesApi', () => {
  it('danh sách, thêm (PUT kèm vùng), bỏ', async () => {
    const f = jest.fn().mockResolvedValue(undefined);
    const api = savedPlacesApi(f);
    await api.list();
    expect(f).toHaveBeenLastCalledWith('/saved-places');
    await api.add('p1', 'r1');
    expect(f).toHaveBeenLastCalledWith('/saved-places/p1', { method: 'PUT', body: { regionId: 'r1' } });
    await api.remove('p1');
    expect(f).toHaveBeenLastCalledWith('/saved-places/p1', { method: 'DELETE' });
  });
});
