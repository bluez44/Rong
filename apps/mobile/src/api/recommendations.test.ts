import { recommendationsApi } from './recommendations';

describe('recommendationsApi', () => {
  const f = jest.fn().mockResolvedValue(undefined);
  const api = recommendationsApi(f);
  beforeEach(() => f.mockClear());

  it('feed theo chủ đề, retry=1 khi thử lại', async () => {
    await api.feed('user:abc');
    expect(f).toHaveBeenLastCalledWith('/recommendations?theme=user%3Aabc');
    await api.feed('default', true);
    expect(f).toHaveBeenLastCalledWith('/recommendations?theme=default&retry=1');
  });

  it('bản nháp: xem, xem trước với thông số, lưu', async () => {
    await api.draft('d1');
    expect(f).toHaveBeenLastCalledWith('/recommendations/d1');
    const body = { startDate: '2026-10-25', daysCount: 2 } as never;
    await api.preview('d1', body);
    expect(f).toHaveBeenLastCalledWith('/recommendations/d1/preview', { method: 'POST', body });
    await api.save('d1', 'draft-9');
    expect(f).toHaveBeenLastCalledWith('/recommendations/d1/save', { method: 'POST', body: { draftId: 'draft-9' } });
  });
});
