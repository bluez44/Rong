import { itineraryShareUrl, resolveShareToken } from './share-link';

describe('resolveShareToken', () => {
  it('người sửa được gọi PUT', async () => {
    const authFetch = jest.fn().mockResolvedValue({ token: 'tok', createdAt: '' });
    await expect(resolveShareToken(authFetch, 'trip-1', true)).resolves.toBe('tok');
    expect(authFetch).toHaveBeenCalledWith('/itineraries/trip-1/share-link', { method: 'PUT' });
  });

  it('người chỉ xem gọi GET; chưa có link thì null', async () => {
    const authFetch = jest.fn().mockResolvedValue({ link: null });
    await expect(resolveShareToken(authFetch, 'trip-1', false)).resolves.toBeNull();
    expect(authFetch).toHaveBeenCalledWith('/itineraries/trip-1/share-link');
  });

  it('người chỉ xem lấy được link có sẵn', async () => {
    const authFetch = jest.fn().mockResolvedValue({ link: { token: 'abc', createdAt: '' } });
    await expect(resolveShareToken(authFetch, 'trip-1', false)).resolves.toBe('abc');
  });

  it('URL web có dạng /t/<token>', () => {
    expect(itineraryShareUrl('abc')).toMatch(/\/t\/abc$/);
  });
});
