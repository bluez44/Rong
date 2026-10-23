import { visitsApi } from './visits';

describe('visitsApi', () => {
  it('chuyến chờ hỏi và trả lời', async () => {
    const f = jest.fn().mockResolvedValue(undefined);
    const api = visitsApi(f);
    await api.pending();
    expect(f).toHaveBeenLastCalledWith('/visits/pending');
    await api.review({ itineraryId: 'it1', visitedPlaceIds: ['p1'] });
    expect(f).toHaveBeenLastCalledWith('/visits/review', {
      method: 'POST',
      body: { itineraryId: 'it1', visitedPlaceIds: ['p1'] },
    });
  });
});
