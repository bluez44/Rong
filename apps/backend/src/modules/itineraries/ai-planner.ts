import type { ItineraryInput } from '@rong/shared-types';

import type { ItineraryPlanType } from '../../chat-models/itinerary-schema.js';
import { parseOpeningHours } from '../places/opening-hours.js';
import type { DayWindow } from './planning/days.js';
import type { Candidate, PlannedStop } from './planning/planning.types.js';
import {
  MAX_VISIT_MINUTES,
  MIN_VISIT_MINUTES,
  VISIT_MINUTES,
  type PartyRules,
} from './planning/rules.js';

const PARTY_LABEL: Record<ItineraryInput['travelParty'], string> = {
  friends: 'nhóm bạn trẻ',
  family_with_kids: 'gia đình có trẻ nhỏ',
  couple: 'cặp đôi',
  solo: 'đi một mình',
  with_elderly: 'có người lớn tuổi',
};

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export const PLANNER_SYSTEM_PROMPT =
  'Bạn là chuyên gia lập lịch trình du lịch Việt Nam. Chỉ dùng các địa điểm có trong danh sách ' +
  'được cung cấp (theo id), không thêm địa điểm khác. Có thể tra Google Maps để biết giờ mở cửa, ' +
  'thời lượng tham quan hợp lý và thời điểm đẹp. Sắp xếp để ít di chuyển qua lại, hợp đối tượng ' +
  'và nhịp độ. Bữa ăn và giờ nghỉ do hệ thống tự chèn — không đưa quán ăn hay khách sạn vào. ' +
  'Trả lời bằng tiếng Việt.';

/** Nội dung gửi Gemini: thông tin chuyến, khung giờ từng ngày, phương án gom cụm và các điểm có thể thêm. */
export function buildPlannerRequest(options: {
  input: ItineraryInput;
  regionName: string;
  rules: PartyRules;
  days: DayWindow[];
  assignment: Candidate[][];
  extraPool: Candidate[];
  targetPerDay: number;
}): string {
  const {
    input,
    regionName,
    rules,
    days,
    assignment,
    extraPool,
    targetPerDay,
  } = options;
  const brief = (c: Candidate) => ({
    id: c.id,
    name: c.name,
    category: c.category,
    lat: Number(c.lat.toFixed(5)),
    lng: Number(c.lng.toFixed(5)),
    required: c.mandatory,
    openingHours: c.openingHours,
    description: c.description,
  });

  return [
    `Chuyến đi: ${regionName}, ${PARTY_LABEL[input.travelParty]}, ${input.adults} người lớn, ${input.children} trẻ em.`,
    `Nhịp độ: ${input.pace}; ngân sách: ${input.budgetTier}; khoảng ${targetPerDay} điểm mỗi ngày trọn.`,
    input.notes ? `Ghi chú của khách: ${input.notes}` : '',
    `Chặng di chuyển nên dưới ${rules.maxLegMinutes} phút.`,
    '',
    'Các ngày (giờ Việt Nam):',
    ...days.map(
      (d) =>
        `- dayIndex ${d.index}: ${d.date}, ${hhmm(d.start)}–${hhmm(d.end)}`,
    ),
    '',
    'Phương án gom theo khu vực (có thể đổi, nhưng mọi điểm required phải có mặt):',
    JSON.stringify(
      assignment.map((list, i) => ({
        dayIndex: i,
        placeIds: list.map((c) => c.id),
      })),
    ),
    '',
    'Địa điểm:',
    JSON.stringify([...assignment.flat(), ...extraPool].map(brief)),
  ]
    .filter((line) => line !== '')
    .join('\n');
}

const HOURS = /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/;

/**
 * Chuyển phương án của Gemini thành các điểm dừng, không tin bất kỳ trường
 * nào: id lạ bị bỏ (FR-6.3), trùng lặp bị bỏ, thời lượng bị kẹp trong giới
 * hạn, giờ mở cửa phải đọc được. Điểm bắt buộc mà AI bỏ sót được trả về ngày
 * gom cụm đã xếp cho nó — không bao giờ mất (FR-6.2, FR-6.7).
 */
export function validatePlan(
  plan: ItineraryPlanType,
  days: DayWindow[],
  assignment: Candidate[][],
  extraPool: Candidate[],
): { stops: PlannedStop[][]; tips: string[] } {
  const allowed = new Map(
    [...assignment.flat(), ...extraPool].map((c) => [c.id, c]),
  );
  const used = new Set<string>();
  const stops: PlannedStop[][] = days.map(() => []);

  for (const planned of plan.days ?? []) {
    if (
      !Number.isInteger(planned.dayIndex) ||
      planned.dayIndex < 0 ||
      planned.dayIndex >= days.length
    ) {
      continue;
    }
    for (const s of planned.stops ?? []) {
      const candidate = allowed.get(s.placeId);
      if (!candidate || used.has(candidate.id)) continue;
      used.add(candidate.id);

      const hint = s.openingHours?.trim() ?? '';
      stops[planned.dayIndex].push({
        candidate,
        visitMinutes: Number.isFinite(s.visitMinutes)
          ? Math.min(
              MAX_VISIT_MINUTES,
              Math.max(MIN_VISIT_MINUTES, Math.round(s.visitMinutes)),
            )
          : VISIT_MINUTES[candidate.category],
        reason: s.reason?.trim().slice(0, 200) || null,
        openingHoursHint:
          HOURS.test(hint) && parseOpeningHours(hint) !== null
            ? hint.replace(/\s/g, '')
            : null,
        isAiSuggested: !candidate.mandatory,
      });
    }
  }

  assignment.forEach((list, dayIndex) => {
    for (const candidate of list) {
      if (candidate.mandatory && !used.has(candidate.id)) {
        used.add(candidate.id);
        stops[dayIndex].push(defaultStop(candidate));
      }
    }
  });

  const tips = (plan.tips ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 5);
  return { stops, tips };
}

export function defaultStop(candidate: Candidate): PlannedStop {
  return {
    candidate,
    visitMinutes: VISIT_MINUTES[candidate.category],
    reason: null,
    openingHoursHint: null,
    isAiSuggested: !candidate.mandatory,
  };
}
