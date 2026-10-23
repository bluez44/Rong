import { placesApi } from './places';

describe('placesApi', () => {
  const f = jest.fn().mockResolvedValue(undefined);
  const api = placesApi(f);
  beforeEach(() => f.mockClear());

  it('chi tiết và ghi chú', async () => {
    await api.detail('p1');
    expect(f).toHaveBeenLastCalledWith('/places/p1');
    await api.updateNotes('p1', { note: 'ngon' });
    expect(f).toHaveBeenLastCalledWith('/places/p1/notes', { method: 'PATCH', body: { note: 'ngon' } });
  });

  it('địa điểm tự ghim', async () => {
    const body = { name: 'Quán' } as never;
    await api.createUserPlace(body);
    expect(f).toHaveBeenLastCalledWith('/places/user', { method: 'POST', body });
    await api.updateUserPlace('p1', body);
    expect(f).toHaveBeenLastCalledWith('/places/user/p1', { method: 'PATCH', body });
  });

  it('Google: xem trước (mã hóa id) và lưu', async () => {
    await api.googlePreview('ChIJ a/b');
    expect(f).toHaveBeenLastCalledWith('/places/google/ChIJ%20a%2Fb');
    const body = { googlePlaceId: 'g1', name: 'X', category: 'cafe', regionId: 'r1' } as never;
    await api.saveGoogle(body);
    expect(f).toHaveBeenLastCalledWith('/places/google', { method: 'POST', body });
  });

  it('địa chỉ dưới ghim', async () => {
    await api.reverseGeocode(10.5, 106.25);
    expect(f).toHaveBeenLastCalledWith('/places/reverse-geocode?lat=10.5&lng=106.25');
  });
});
