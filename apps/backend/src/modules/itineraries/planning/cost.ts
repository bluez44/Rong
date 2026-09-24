import type {
  BudgetTier,
  CostCategory,
  CostRange,
  ItineraryItem,
  PlaceCategory,
  Transport,
} from '@rong/shared-types';

/**
 * Bảng giá mặc định (VNĐ) cho ước tính chi phí — FR-7.3. Chưa có dữ liệu giá
 * thật (curate, người dùng báo giá), nên đây là mức tham khảo phổ biến ở các
 * điểm du lịch Việt Nam; sửa ở đây khi có dữ liệu tốt hơn.
 */
export const PRICES_UPDATED_AT = '2026-09-24';

type Range = [number, number];

/** Vé/chi tiêu mỗi người lớn cho một lượt tham quan. Trẻ em tính 50%. */
const VISIT_PER_ADULT: Record<PlaceCategory, Range> = {
  check_in: [0, 50_000],
  nature: [0, 100_000],
  culture: [20_000, 100_000],
  kids: [100_000, 300_000],
  cafe: [30_000, 80_000],
  nightlife: [100_000, 300_000],
  food: [0, 0],
  stay: [0, 0],
};

/** Một bữa mỗi người lớn theo ngân sách. Trẻ em tính 60%. */
const MEAL_PER_ADULT: Record<BudgetTier, { breakfast: Range; main: Range }> = {
  budget: { breakfast: [25_000, 50_000], main: [40_000, 80_000] },
  moderate: { breakfast: [40_000, 100_000], main: [80_000, 200_000] },
  comfortable: { breakfast: [100_000, 250_000], main: [200_000, 500_000] },
};

/** Một phòng mỗi đêm theo ngân sách; 2 người lớn một phòng. */
const ROOM_PER_NIGHT: Record<BudgetTier, Range> = {
  budget: [250_000, 500_000],
  moderate: [600_000, 1_200_000],
  comfortable: [1_500_000, 3_000_000],
};

/**
 * Di chuyển tại điểm đến: thuê xe theo ngày + nhiên liệu theo km (xe máy: 2
 * người/xe, ô tô: 4 người/xe), hoặc taxi theo km (4 người/xe).
 */
const TRANSPORT: Record<
  Transport,
  { perVehicleDay: Range; perKm: Range; seats: number }
> = {
  motorbike: {
    perVehicleDay: [120_000, 200_000],
    perKm: [1_000, 2_000],
    seats: 2,
  },
  car: { perVehicleDay: [800_000, 1_300_000], perKm: [2_500, 3_500], seats: 4 },
  taxi: { perVehicleDay: [0, 0], perKm: [12_000, 18_000], seats: 4 },
};

const CHILD_TICKET = 0.5;
const CHILD_MEAL = 0.6;

const round = (vnd: number) => Math.round(vnd / 1000) * 1000;
const scale = ([min, max]: Range, factor: number): CostRange => ({
  minVnd: round(min * factor),
  maxVnd: round(max * factor),
});
const add = (a: CostRange, b: CostRange): CostRange => ({
  minVnd: a.minVnd + b.minVnd,
  maxVnd: a.maxVnd + b.maxVnd,
});
const ZERO: CostRange = { minVnd: 0, maxVnd: 0 };

export interface CostInput {
  items: ItineraryItem[];
  adults: number;
  children: number;
  budgetTier: BudgetTier;
  transport: Transport;
  days: number;
  totalKm: number;
  nights: number;
  hasAccommodation: boolean;
}

export interface CostEstimate {
  /** Chi phí từng mục (cả nhóm), theo id mục. */
  perItem: Map<string, CostRange>;
  byCategory: Record<CostCategory, CostRange>;
  total: CostRange;
  perPerson: CostRange;
  note: string;
}

export function estimateCost(input: CostInput): CostEstimate {
  const { adults, children, budgetTier, transport } = input;
  const perItem = new Map<string, CostRange>();
  const byCategory: Record<CostCategory, CostRange> = {
    tickets: ZERO,
    food: ZERO,
    transport: ZERO,
    accommodation: ZERO,
  };

  for (const item of input.items) {
    if (item.kind === 'visit' && item.place) {
      const cost = scale(
        VISIT_PER_ADULT[item.place.category as PlaceCategory] ?? [0, 0],
        adults + children * CHILD_TICKET,
      );
      perItem.set(item.id, cost);
      byCategory.tickets = add(byCategory.tickets, cost);
    } else if (item.kind === 'meal') {
      const meal = MEAL_PER_ADULT[budgetTier];
      const cost = scale(
        item.mealType === 'breakfast' ? meal.breakfast : meal.main,
        adults + children * CHILD_MEAL,
      );
      perItem.set(item.id, cost);
      byCategory.food = add(byCategory.food, cost);
    }
  }

  const t = TRANSPORT[transport];
  const vehicles = Math.max(1, Math.ceil((adults + children) / t.seats));
  byCategory.transport = add(
    scale(t.perVehicleDay, vehicles * input.days),
    scale(t.perKm, vehicles * input.totalKm),
  );

  if (input.hasAccommodation && input.nights > 0) {
    byCategory.accommodation = scale(
      ROOM_PER_NIGHT[budgetTier],
      Math.max(1, Math.ceil(adults / 2)) * input.nights,
    );
  }

  const total = Object.values(byCategory).reduce(add, ZERO);
  const people = Math.max(1, adults + children);
  return {
    perItem,
    byCategory,
    total,
    perPerson: {
      minVnd: round(total.minVnd / people),
      maxVnd: round(total.maxVnd / people),
    },
    note: `Ước tính theo bảng giá tham khảo cập nhật ngày ${PRICES_UPDATED_AT}; giá thực tế có thể khác.`,
  };
}
