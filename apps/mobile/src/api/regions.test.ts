import { regionsApi } from './regions';

describe('regionsApi', () => {
  const f = jest.fn().mockResolvedValue(undefined);
  const api = regionsApi(f);
  beforeEach(() => f.mockClear());

  it('tìm vùng, online khi bấm tìm', async () => {
    await api.search('Đà Lạt');
    expect(f).toHaveBeenLastCalledWith(`/regions/search?${new URLSearchParams({ q: 'Đà Lạt' })}`);
    await api.search('Hội An', true);
    expect(f).toHaveBeenLastCalledWith(`/regions/search?${new URLSearchParams({ q: 'Hội An', online: 'true' })}`);
  });

  it('danh sách địa điểm, lọc theo loại', async () => {
    await api.places('r1');
    expect(f).toHaveBeenLastCalledWith('/regions/r1/places?');
    await api.places('r1', 'cafe,food');
    expect(f).toHaveBeenLastCalledWith('/regions/r1/places?categories=cafe%2Cfood');
  });

  it('tìm địa điểm theo tên trong vùng', async () => {
    await api.searchPlaces('r1', 'bún bò');
    expect(f).toHaveBeenLastCalledWith(`/regions/r1/places/search?${new URLSearchParams({ q: 'bún bò' })}`);
    await api.searchPlaces('r1', 'bún bò', true);
    expect(f).toHaveBeenLastCalledWith(
      `/regions/r1/places/search?${new URLSearchParams({ q: 'bún bò', online: 'true' })}`,
    );
  });

  it('thời tiết', async () => {
    await api.weather('r1', '2026-10-25', '2026-10-26');
    expect(f).toHaveBeenLastCalledWith('/regions/r1/weather?from=2026-10-25&to=2026-10-26');
  });
});
