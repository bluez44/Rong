import { randomUUID } from 'node:crypto';

import type {
  DayPart,
  ItineraryItem,
  ItineraryWarning,
  MealType,
  Transport,
  UnscheduledPlace,
} from '@rong/shared-types';

import { parseOpeningHours } from '../../places/opening-hours.js';
import { vietnamIso, type DayWindow } from './days.js';
import type { Candidate, PlannedStop } from './planning.types.js';
import { MEALS, TYPICAL_HOURS, type PartyRules } from './rules.js';
import { estimateLeg, type LatLng } from './travel.js';

/** Quán người dùng đã chọn được ưu tiên cho bữa ăn nếu cách không quá chừng này. */
const PREFERRED_FOOD_MAX_MINUTES = 30;
/** Được trễ bữa tối đa chừng này so với cuối khung giờ ăn. */
const MEAL_GRACE_MINUTES = 30;
/** Chờ điểm mở cửa tối đa chừng này; lâu hơn thì bỏ qua điểm đó trong ngày. */
const MAX_WAIT_MINUTES = 60;

export interface ScheduleContext {
  day: DayWindow;
  rules: PartyRules;
  transport: Transport;
  accommodation: Candidate | null;
  /** Quán ăn trong vùng, dùng chung cho cả chuyến (một quán không lặp lại). */
  foodPool: Candidate[];
  usedFood: Set<string>;
}

export interface ScheduledDay {
  items: ItineraryItem[];
  unscheduled: UnscheduledPlace[];
  warnings: ItineraryWarning[];
}

function dayPartOf(minute: number): DayPart {
  if (minute < 11 * 60) return 'morning';
  if (minute < 14 * 60) return 'noon';
  if (minute < 18 * 60) return 'afternoon';
  return 'evening';
}

/**
 * Giờ mở cửa trong ngày: dữ liệu riêng, rồi giờ AI tra được, rồi giờ thông
 * thường của danh mục. `assumed` = đang dùng giờ thông thường; [] = đóng cả ngày;
 * null = không giới hạn.
 */
function rangesFor(
  stop: PlannedStop,
  weekday: number,
): { ranges: Array<[number, number]> | null; assumed: boolean } {
  const raw = stop.candidate.openingHours ?? stop.openingHoursHint;
  const week = raw ? parseOpeningHours(raw) : null;
  if (week !== null) return { ranges: week[weekday], assumed: false };
  const typical = TYPICAL_HOURS[stop.candidate.category];
  return { ranges: typical ? [typical] : null, assumed: typical !== null };
}

/**
 * Tính giờ cho các điểm của một ngày theo đúng thứ tự đã chọn, chèn bữa ăn
 * theo khung giờ và giờ nghỉ trưa theo đối tượng. Điểm đóng cửa, không kịp
 * trước giờ đóng hoặc tràn quá cuối ngày được đưa vào "Chưa xếp được" kèm lý
 * do (FR-6.7) thay vì bị xếp sai.
 */
export function scheduleDay(
  stops: PlannedStop[],
  ctx: ScheduleContext,
): ScheduledDay {
  const { day, rules, transport, accommodation } = ctx;
  const items: ItineraryItem[] = [];
  const unscheduled: UnscheduledPlace[] = [];
  const warnings: ItineraryWarning[] = [];
  const dayId = `day-${day.index + 1}`;

  let cursor = day.start;
  // Có nơi ở: các ngày sau ngày đầu bắt đầu từ nơi ở (PRD F6 "Mốc thời gian và lưu trú").
  let here: LatLng | null =
    accommodation && !day.isFirst ? accommodation : null;
  let order = 0;
  let restDone = rules.middayRestMinutes === 0;

  // Ngày đầu chỉ tính bữa bắt đầu sau giờ khởi hành; các ngày sau chuyến đi đã
  // phủ cả buổi sáng nên bữa sáng vẫn được xếp nếu khung giờ chưa qua.
  const pendingMeals = MEALS.filter(
    (meal) =>
      (day.isFirst
        ? meal.start >= day.start - MEAL_GRACE_MINUTES
        : meal.end > day.start) && meal.start + meal.minutes <= day.end,
  ).map((meal) => ({ ...meal }));

  const push = (
    item: Omit<ItineraryItem, 'id' | 'order' | 'dayPart'>,
    startMinute: number,
  ) => {
    items.push({
      ...item,
      id: randomUUID(),
      order: order++,
      dayPart: dayPartOf(startMinute),
    });
  };

  const addMeal = (
    meal: (typeof MEALS)[number],
    nextStop: LatLng | null,
  ): void => {
    const anchor = here ?? nextStop ?? accommodation;
    const available = ctx.foodPool.filter((f) => !ctx.usedFood.has(f.id));
    const legTo = (f: Candidate) =>
      anchor ? estimateLeg(anchor, f, transport) : { km: 0, minutes: 0 };

    const preferred = available
      .filter(
        (f) => f.mandatory && legTo(f).minutes <= PREFERRED_FOOD_MAX_MINUTES,
      )
      .sort((a, b) => legTo(a).minutes - legTo(b).minutes)[0];
    const nearest = [...available].sort(
      (a, b) => legTo(a).minutes - legTo(b).minutes || b.score - a.score,
    )[0];
    const place = preferred ?? nearest;

    if (!place) {
      warnings.push({
        type: 'missing_meal',
        message: `Ngày ${day.index + 1}: chưa có quán ăn trong danh mục cho bữa ${mealLabel(meal.type)}.`,
        dayId,
      });
      return;
    }

    // Chưa biết đang ở đâu (đầu ngày, không có nơi ở): không cộng thời gian đi.
    const leg = anchor === here ? legTo(place) : { km: 0, minutes: 0 };
    const start = Math.max(cursor + leg.minutes, meal.start);
    const end = start + meal.minutes;
    if (start > meal.end + MEAL_GRACE_MINUTES || end > day.end) {
      warnings.push({
        type: 'missing_meal',
        message: `Ngày ${day.index + 1}: không còn thời gian cho bữa ${mealLabel(meal.type)}.`,
        dayId,
      });
      return;
    }

    ctx.usedFood.add(place.id);
    push(
      {
        kind: 'meal',
        mealType: meal.type,
        placeId: place.id,
        place: snapshot(place),
        startsAt: vietnamIso(day.date, start),
        endsAt: vietnamIso(day.date, end),
        travelMinutesFromPrevious: anchor === here ? leg.minutes : null,
        distanceKmFromPrevious: anchor === here ? leg.km : null,
        reason: place.mandatory ? 'Quán bạn đã chọn' : 'Quán gần lộ trình',
        isAiSuggested: !place.mandatory,
      },
      start,
    );
    cursor = end;
    here = place;
  };

  const addRest = (): void => {
    restDone = true;
    let start = cursor;
    let leg = { km: 0, minutes: 0 };
    if (accommodation && here)
      leg = estimateLeg(here, accommodation, transport);
    start += leg.minutes;
    const end = start + rules.middayRestMinutes;
    if (end > day.end) return;
    push(
      {
        kind: 'rest',
        placeId: accommodation?.id ?? null,
        place: accommodation ? snapshot(accommodation) : null,
        startsAt: vietnamIso(day.date, start),
        endsAt: vietnamIso(day.date, end),
        travelMinutesFromPrevious: accommodation && here ? leg.minutes : null,
        distanceKmFromPrevious: accommodation && here ? leg.km : null,
        reason: accommodation ? 'Nghỉ trưa tại nơi ở' : 'Nghỉ trưa',
        isAiSuggested: false,
      },
      start,
    );
    cursor = end;
    if (accommodation) here = accommodation;
  };

  /** Chèn bữa đã tới giờ, hoặc bữa sẽ bị lỡ nếu đi tiếp điểm sau (kết thúc ở `wouldEnd`). */
  const serveDueMeals = (next: LatLng | null, wouldEnd: number): void => {
    while (pendingMeals.length > 0) {
      const meal = pendingMeals[0];
      const due =
        cursor >= meal.start ||
        wouldEnd > meal.end - meal.minutes + MEAL_GRACE_MINUTES;
      if (!due) return;
      pendingMeals.shift();
      addMeal(meal, next);
      if (meal.type === 'lunch' && !restDone) addRest();
    }
  };

  for (const stop of stops) {
    const c = stop.candidate;
    const leg0 = here ? estimateLeg(here, c, transport) : { km: 0, minutes: 0 };
    serveDueMeals(c, cursor + leg0.minutes + stop.visitMinutes);

    const leg = here ? estimateLeg(here, c, transport) : { km: 0, minutes: 0 };
    const arrive = cursor + leg.minutes;
    const { ranges, assumed } = rangesFor(stop, day.weekday);

    let start = arrive;
    if (ranges !== null) {
      if (ranges.length === 0) {
        unscheduled.push({
          placeId: c.id,
          reason: `Đóng cửa vào ngày ${day.index + 1} (${day.date})`,
        });
        continue;
      }
      const slot = ranges
        .map(([open, close]) => ({ start: Math.max(arrive, open), close }))
        .find(
          (s) =>
            s.start + stop.visitMinutes <= s.close &&
            s.start - arrive <= MAX_WAIT_MINUTES,
        );
      if (!slot) {
        unscheduled.push({
          placeId: c.id,
          reason: assumed
            ? 'Không kịp trong giờ mở cửa thông thường'
            : 'Không kịp trong giờ mở cửa',
        });
        continue;
      }
      start = slot.start;
    }

    const end = start + stop.visitMinutes;
    if (end > day.end) {
      unscheduled.push({
        placeId: c.id,
        reason: `Không đủ thời gian trong ngày ${day.index + 1}`,
      });
      continue;
    }

    if (leg.minutes > rules.maxLegMinutes) {
      warnings.push({
        type: 'long_travel_leg',
        message: `Chặng tới ${c.name} mất khoảng ${leg.minutes} phút.`,
        dayId,
      });
    }

    push(
      {
        kind: 'visit',
        placeId: c.id,
        place: snapshot(c),
        startsAt: vietnamIso(day.date, start),
        endsAt: vietnamIso(day.date, end),
        travelMinutesFromPrevious: here ? leg.minutes : null,
        distanceKmFromPrevious: here ? leg.km : null,
        reason: stop.reason,
        isAiSuggested: stop.isAiSuggested,
      },
      start,
    );
    cursor = end;
    here = c;
  }

  // Các bữa còn lại trong ngày (thường là bữa tối sau điểm cuối).
  while (pendingMeals.length > 0) {
    const meal = pendingMeals.shift()!;
    addMeal(meal, null);
    if (meal.type === 'lunch' && !restDone) addRest();
  }

  const visits = items.filter((i) => i.kind === 'visit').length;
  if (visits > rules.stopsPerDay[1]) {
    warnings.push({
      type: 'overloaded_day',
      message: `Ngày ${day.index + 1} có ${visits} điểm, nhiều hơn mức khuyến nghị ${rules.stopsPerDay[1]}.`,
      dayId,
    });
  }

  return { items, unscheduled, warnings };
}

function snapshot(c: Candidate): ItineraryItem['place'] {
  return {
    name: c.name,
    category: c.category,
    coordinates: { lat: c.lat, lng: c.lng },
  };
}

function mealLabel(type: MealType): string {
  return type === 'breakfast' ? 'sáng' : type === 'lunch' ? 'trưa' : 'tối';
}
