import type { BudgetTier, DayPart, MealType, Pace, PlannerKind, Transport, TravelParty } from '@rong/shared-types';

/**
 * Hiển thị ngày giờ theo giờ Việt Nam (UTC+7, không có giờ mùa hè), bất kể
 * múi giờ của máy: lịch trình luôn diễn ra ở Việt Nam. Không dùng Intl để
 * khỏi phụ thuộc dữ liệu múi giờ của Hermes.
 */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

function vn(value: string | Date): Date {
  const ms = typeof value === 'string' ? Date.parse(value) : value.getTime();
  return new Date(ms + VN_OFFSET_MS);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "08:30" */
export function formatTime(value: string | Date): string {
  const d = vn(value);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "04/10" */
export function formatShortDate(value: string | Date): string {
  const d = vn(value);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`;
}

/** "Thứ Bảy, 04/10" */
export function formatDayTitle(value: string | Date): string {
  return `${WEEKDAYS[vn(value).getUTCDay()]}, ${formatShortDate(value)}`;
}

/** "Thứ Bảy, 04/10 · 08:00" */
export function formatDateTime(value: string | Date): string {
  return `${formatDayTitle(value)} · ${formatTime(value)}`;
}

/** "04/10 – 05/10/2026", hoặc "04/10/2026" nếu cùng ngày. */
export function formatDateRange(startsAt: string, endsAt: string): string {
  const start = formatShortDate(startsAt);
  const end = formatShortDate(endsAt);
  const year = vn(endsAt).getUTCFullYear();
  return start === end ? `${start}/${year}` : `${start} – ${end}/${year}`;
}

/** Ngày `YYYY-MM-DD` của lịch trình (đã là ngày theo giờ Việt Nam) → "Thứ Bảy, 04/10". */
export function formatPlanDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[weekday]}, ${pad(d)}/${pad(m)}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} phút`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
}

export function formatKm(km: number): string {
  return `${km.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km`;
}

export const TRAVEL_PARTY_LABELS: Record<TravelParty, string> = {
  friends: 'Nhóm bạn',
  family_with_kids: 'Gia đình có trẻ nhỏ',
  couple: 'Cặp đôi',
  solo: 'Một mình',
  with_elderly: 'Có người lớn tuổi',
};

export const BUDGET_LABELS: Record<BudgetTier, string> = {
  budget: 'Tiết kiệm',
  moderate: 'Vừa phải',
  comfortable: 'Thoải mái',
};

export const PACE_LABELS: Record<Pace, string> = {
  relaxed: 'Thong thả',
  moderate: 'Vừa',
  packed: 'Dày',
};

export const TRANSPORT_LABELS: Record<Transport, string> = {
  motorbike: 'Xe máy',
  car: 'Ô tô',
  taxi: 'Taxi/xe công nghệ',
};

export const DAY_PART_LABELS: Record<DayPart, string> = {
  morning: 'Sáng',
  noon: 'Trưa',
  afternoon: 'Chiều',
  evening: 'Tối',
};

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'Bữa sáng',
  lunch: 'Bữa trưa',
  dinner: 'Bữa tối',
};

export const PLANNER_LABELS: Record<PlannerKind, string> = {
  ai: 'AI sắp xếp',
  heuristic: 'Tự động sắp xếp',
  manual: 'Tự sắp xếp',
};
