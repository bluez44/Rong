import type {
  ItineraryInput,
  PlaceCategory,
  TripParams,
} from '@rong/shared-types';

import { toVietnamLocal } from '../itineraries/planning/days.js';
import { MAX_TRIP_DAYS } from '../itineraries/planning/rules.js';
import { daysBetween, DRAFT_ANCHOR_DATE, tripBounds } from './draft-dates.js';

export const DEFAULT_TRIP_PARAMS: TripParams = {
  travelParty: 'couple',
  adults: 2,
  children: 0,
  pace: 'moderate',
  budgetTier: 'moderate',
  daysCount: 2,
};

/** Giá trị gặp nhiều nhất; hòa thì lấy giá trị xuất hiện trước (lịch trình mới hơn). */
function mode<T>(values: T[]): T {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0];
  for (const v of values) if (counts.get(v)! > counts.get(best)!) best = v;
  return best;
}

function tripDays(input: ItineraryInput): number {
  return (
    daysBetween(
      toVietnamLocal(input.startsAt).date,
      toVietnamLocal(input.endsAt).date,
    ) + 1
  );
}

/** Thông số hay dùng của người dùng, từ các lịch trình đã tạo (mới nhất trước). */
export function learnTripParams(inputs: ItineraryInput[]): TripParams {
  if (inputs.length === 0) return { ...DEFAULT_TRIP_PARAMS };
  const days = inputs.map(tripDays).sort((a, b) => a - b);
  const median = days[Math.floor((days.length - 1) / 2)];
  return {
    travelParty: mode(inputs.map((i) => i.travelParty)),
    adults: mode(inputs.map((i) => i.adults)),
    children: mode(inputs.map((i) => i.children)),
    pace: mode(inputs.map((i) => i.pace)),
    budgetTier: mode(inputs.map((i) => i.budgetTier)),
    daysCount: Math.min(MAX_TRIP_DAYS, Math.max(1, median)),
  };
}

/** Input lập lịch của một bản nháp: xếp từ ngày gốc, AI/thuật toán tự chọn điểm theo danh mục ưu tiên. */
export function draftInput(
  regionId: string,
  categories: PlaceCategory[],
  trip: TripParams,
): ItineraryInput {
  const { startsAt, endsAt } = tripBounds(DRAFT_ANCHOR_DATE, trip.daysCount);
  return {
    regionId,
    planningMode: 'ai',
    startsAt,
    endsAt,
    travelParty: trip.travelParty,
    adults: trip.adults,
    children: trip.children,
    selectedPlaceIds: [],
    accommodationPlaceId: null,
    allowAiSuggestions: true,
    budgetTier: trip.budgetTier,
    pace: trip.pace,
    transport: null,
    preferredCategories: [...new Set(categories)],
    notes: null,
  };
}
