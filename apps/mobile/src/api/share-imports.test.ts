import { shareImportsApi } from './share-imports';

describe('shareImportsApi', () => {
  it('danh sách, chi tiết, tạo, lưu lựa chọn', async () => {
    const f = jest.fn().mockResolvedValue(undefined);
    const api = shareImportsApi(f);
    await api.list();
    expect(f).toHaveBeenLastCalledWith('/share-imports');
    await api.get('s1');
    expect(f).toHaveBeenLastCalledWith('/share-imports/s1');
    await api.create({ url: 'https://x', text: 'y' });
    expect(f).toHaveBeenLastCalledWith('/share-imports', { method: 'POST', body: { url: 'https://x', text: 'y' } });
    const selections = [{ candidateKey: 'k1' }] as never;
    await api.save('s1', selections);
    expect(f).toHaveBeenLastCalledWith('/share-imports/s1/save', { method: 'POST', body: { selections } });
  });
});
