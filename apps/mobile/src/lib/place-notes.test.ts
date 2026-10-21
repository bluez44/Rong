import { buildOpeningHours, formatPrice, notesSummary, parseSimpleHours } from '@/lib/place-notes';

const all = Array(7).fill(true);

describe('buildOpeningHours', () => {
  it('cả tuần', () => expect(buildOpeningHours({ open: '07:00', close: '22:00', days: all })).toBe('Mo-Su 07:00-22:00'));
  it('gộp ngày liền nhau', () =>
    expect(buildOpeningHours({ open: '08:00', close: '17:00', days: [true, false, true, true, true, false, false] })).toBe(
      'Mo,We-Fr 08:00-17:00',
    ));
  it('hai ngày liền nhau viết bằng dấu phẩy', () =>
    expect(buildOpeningHours({ open: '08:00', close: '17:00', days: [false, false, false, false, false, true, true] })).toBe(
      'Sa,Su 08:00-17:00',
    ));
  it('qua đêm giữ nguyên giờ đóng nhỏ hơn giờ mở', () =>
    expect(buildOpeningHours({ open: '18:00', close: '02:00', days: all })).toBe('Mo-Su 18:00-02:00'));
  it('không chọn ngày nào → null', () =>
    expect(buildOpeningHours({ open: '07:00', close: '22:00', days: Array(7).fill(false) })).toBeNull());
});

describe('parseSimpleHours', () => {
  it('đọc lại chuỗi do form sinh', () =>
    expect(parseSimpleHours('Mo,We-Fr 08:00-17:00')).toEqual({
      open: '08:00',
      close: '17:00',
      days: [true, false, true, true, true, false, false],
    }));
  it('"07:00-22:00" không có ngày = cả tuần', () =>
    expect(parseSimpleHours('07:00-22:00')).toEqual({ open: '07:00', close: '22:00', days: all }));
  it('nhiều khung giờ → null (form không biểu diễn được)', () =>
    expect(parseSimpleHours('Mo-Fr 08:00-12:00,13:30-17:00')).toBeNull());
});

describe('formatPrice / notesSummary', () => {
  it.each([
    [0, 0, 'Miễn phí'],
    [null, 50000, '< 50k'],
    [50000, 150000, '50–150k'],
    [300000, null, '> 300k'],
    [25500, 40000, '25.500đ–40k'],
    [null, null, null],
  ])('%s–%s → %s', (min, max, out) => expect(formatPrice(min, max)).toBe(out));

  it('tóm tắt giờ và giá', () =>
    expect(notesSummary({ note: 'x', openingHours: 'Mo-Su 07:00-22:00', priceMin: 50000, priceMax: 150000 })).toBe(
      '07:00–22:00 · 50–150k',
    ));
  it('chuỗi giờ phức tạp thì tóm tắt "Có giờ mở cửa"', () =>
    expect(notesSummary({ note: null, openingHours: 'Mo-Fr 08:00-12:00,13:30-17:00', priceMin: null, priceMax: null })).toBe(
      'Có giờ mở cửa',
    ));
  it('không có giờ lẫn giá → null', () =>
    expect(notesSummary({ note: 'chỉ có ghi chú', openingHours: null, priceMin: null, priceMax: null })).toBeNull());
});
