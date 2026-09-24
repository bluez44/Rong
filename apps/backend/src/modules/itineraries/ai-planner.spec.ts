import { describe, expect, it } from 'vitest';

import { buildPlannerRequest, validatePlan } from './ai-planner.js';
import type { DayWindow } from './planning/days.js';
import type { Candidate } from './planning/planning.types.js';
import { PARTY_RULES } from './planning/rules.js';

const c = (id: string, patch: Partial<Candidate> = {}): Candidate => ({
  id,
  name: `Điểm ${id}`,
  category: 'nature',
  score: 50,
  description: null,
  openingHours: null,
  mandatory: false,
  lat: 11.94,
  lng: 108.44,
  ...patch,
});
const days: DayWindow[] = [0, 1].map((index) => ({
  index,
  date: `2026-10-0${5 + index}`,
  weekday: index,
  start: 480,
  end: 1320,
  isFirst: index === 0,
  isLast: index === 1,
}));

describe('validatePlan', () => {
  const required = c('req', { mandatory: true });
  const extra = c('extra');
  const spare = c('spare', { category: 'culture' });
  const assignment = [[required], [extra]];

  it('bỏ id lạ và id trùng; kẹp thời lượng; chỉ nhận giờ mở cửa đọc được', () => {
    const { stops } = validatePlan(
      {
        days: [
          {
            dayIndex: 0,
            stops: [
              {
                placeId: 'req',
                visitMinutes: 9999,
                reason: '  Đẹp buổi sáng ',
                openingHours: '07:00-17:00',
              },
              {
                placeId: 'made-up-by-ai',
                visitMinutes: 60,
                reason: 'x',
                openingHours: '',
              },
              {
                placeId: 'spare',
                visitMinutes: 5,
                reason: '',
                openingHours: 'sáng tới chiều',
              },
            ],
          },
          {
            dayIndex: 1,
            stops: [
              {
                placeId: 'req',
                visitMinutes: 60,
                reason: 'lặp',
                openingHours: '',
              },
            ],
          },
          {
            dayIndex: 7,
            stops: [
              {
                placeId: 'extra',
                visitMinutes: 60,
                reason: '',
                openingHours: '',
              },
            ],
          },
        ],
        tips: [' Mang áo ấm ', '', 'a', 'b', 'c', 'd', 'e'],
      },
      days,
      assignment,
      [spare],
    );

    expect(stops[0].map((s) => s.candidate.id)).toEqual(['req', 'spare']);
    expect(stops[0][0]).toMatchObject({
      visitMinutes: 240,
      reason: 'Đẹp buổi sáng',
      openingHoursHint: '07:00-17:00',
      isAiSuggested: false,
    });
    expect(stops[0][1]).toMatchObject({
      visitMinutes: 20,
      reason: null,
      openingHoursHint: null,
      isAiSuggested: true,
    });
    // Ngày 1: "req" đã dùng ở ngày 0, "extra" nằm ở dayIndex 7 không hợp lệ → AI bỏ, và extra không bắt buộc.
    expect(stops[1]).toEqual([]);
  });

  it('điểm bắt buộc AI bỏ sót được trả về ngày gom cụm đã xếp', () => {
    const { stops, tips } = validatePlan(
      { days: [], tips: [] },
      days,
      assignment,
      [],
    );
    expect(stops[0].map((s) => s.candidate.id)).toEqual(['req']);
    expect(stops[1]).toEqual([]);
    expect(tips).toEqual([]);
  });

  it('tối đa 5 mẹo, bỏ mẹo rỗng', () => {
    const { tips } = validatePlan(
      { days: [], tips: [' Mang áo ấm ', '', 'a', 'b', 'c', 'd', 'e'] },
      days,
      assignment,
      [],
    );
    expect(tips).toEqual(['Mang áo ấm', 'a', 'b', 'c', 'd']);
  });
});

describe('buildPlannerRequest', () => {
  it('gửi đủ khung ngày, phương án gom cụm, và đánh dấu điểm bắt buộc', () => {
    const text = buildPlannerRequest({
      input: {
        regionId: 'r',
        planningMode: 'ai',
        startsAt: '2026-10-05T08:00:00+07:00',
        endsAt: '2026-10-06T22:00:00+07:00',
        travelParty: 'couple',
        adults: 2,
        children: 0,
        selectedPlaceIds: ['req'],
        allowAiSuggestions: true,
        budgetTier: 'moderate',
        pace: 'moderate',
        notes: 'Thích chụp ảnh',
      },
      regionName: 'Đà Lạt, Lâm Đồng',
      rules: PARTY_RULES.couple,
      days,
      assignment: [[c('req', { mandatory: true })], []],
      extraPool: [c('spare')],
      targetPerDay: 4,
    });

    expect(text).toContain('Đà Lạt, Lâm Đồng, cặp đôi, 2 người lớn, 0 trẻ em');
    expect(text).toContain('Ghi chú của khách: Thích chụp ảnh');
    expect(text).toContain('dayIndex 0: 2026-10-05, 08:00–22:00');
    expect(text).toContain(
      '[{"dayIndex":0,"placeIds":["req"]},{"dayIndex":1,"placeIds":[]}]',
    );
    expect(text).toContain('"id":"req"');
    expect(text).toContain('"required":true');
    expect(text).toContain('"id":"spare"');
  });
});
