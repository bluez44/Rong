import { describe, expect, it } from 'vitest';

import { hoursToday, parseOpeningHours } from './opening-hours.js';

/** Giờ Việt Nam → Date UTC. 2026-09-21 là thứ Hai. */
const vn = (iso: string) => new Date(`${iso}+07:00`);

describe('parseOpeningHours', () => {
  it('hiểu các dạng phổ biến', () => {
    expect(parseOpeningHours('24/7')?.[3]).toEqual([[0, 1440]]);
    expect(parseOpeningHours('Mo-Su 07:00-22:00')?.[6]).toEqual([[420, 1320]]);
    expect(parseOpeningHours('07:00-11:30, 13:30-17:00')?.[2]).toEqual([
      [420, 690],
      [810, 1020],
    ]);
  });

  it('luật sau ghi đè luật trước; khoảng thứ vắt qua cuối tuần', () => {
    const week = parseOpeningHours(
      'Mo-Su 08:00-17:00; Tu off; Sa-Mo 09:00-12:00',
    )!;
    expect(week[0]).toEqual([[540, 720]]); // thứ Hai bị Sa-Mo ghi đè
    expect(week[1]).toEqual([]); // thứ Ba nghỉ
    expect(week[2]).toEqual([[480, 1020]]);
    expect(week[6]).toEqual([[540, 720]]);
  });

  it('giờ qua nửa đêm', () => {
    expect(parseOpeningHours('Fr,Sa 18:00-02:00')?.[4]).toEqual([[1080, 1560]]);
  });

  it('cú pháp chưa hỗ trợ thì trả về null, không đoán', () => {
    expect(parseOpeningHours('Jan-Mar Mo-Fr 08:00-17:00')).toBeNull();
    expect(parseOpeningHours('Mo-Fr 08:00-17:00; PH off')).toBeNull();
    expect(parseOpeningHours('sunrise-sunset')).toBeNull();
    expect(parseOpeningHours('Mo-Fr 8h-17h')).toBeNull();
  });
});

describe('hoursToday (giờ Việt Nam)', () => {
  it('đang mở / đã đóng', () => {
    expect(hoursToday('Mo-Su 07:00-22:00', vn('2026-09-21T08:00:00'))).toEqual({
      openNow: true,
      today: '07:00–22:00',
    });
    expect(
      hoursToday('Mo-Su 07:00-22:00', vn('2026-09-21T22:00:00'))?.openNow,
    ).toBe(false);
  });

  it('dùng giờ Việt Nam kể cả khi giờ UTC đã sang ngày khác', () => {
    // 06:30 sáng thứ Ba ở VN = 23:30 thứ Hai UTC.
    expect(
      hoursToday('Mo 00:00-24:00; Tu 06:00-07:00', vn('2026-09-22T06:30:00')),
    ).toEqual({
      openNow: true,
      today: '06:00–07:00',
    });
  });

  it('quán mở qua đêm từ hôm qua vẫn tính là đang mở', () => {
    // Thứ Bảy 01:00, quán mở Fr 18:00-02:00.
    expect(hoursToday('Fr 18:00-02:00', vn('2026-09-26T01:00:00'))).toEqual({
      openNow: true,
      today: 'Đóng cửa hôm nay',
    });
  });

  it('24/7, không có dữ liệu, cú pháp lạ', () => {
    expect(hoursToday('24/7', vn('2026-09-21T03:00:00'))).toEqual({
      openNow: true,
      today: 'Mở cả ngày',
    });
    expect(hoursToday(null)).toBeNull();
    expect(hoursToday('Jan-Mar 08:00-17:00')).toEqual({
      openNow: null,
      today: null,
    });
  });
});
