import type { PlaceNotes } from '@rong/shared-types';

/** Thứ Hai → Chủ nhật, theo cú pháp opening_hours. */
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Giờ mở cửa dạng form: một khung giờ cho các ngày được chọn. `days[0]` là thứ Hai. */
export type WeeklyForm = { open: string; close: string; days: boolean[] };

/** Chuỗi opening_hours từ form; ngày liền nhau gộp lại ("Mo,We-Fr 08:00-17:00"). Không chọn ngày nào → null. */
export function buildOpeningHours({ open, close, days }: WeeklyForm): string | null {
  const runs: string[] = [];
  for (let i = 0; i < 7; i++) {
    if (!days[i]) continue;
    let j = i;
    while (j + 1 < 7 && days[j + 1]) j++;
    runs.push(j === i ? DAYS[i] : j === i + 1 ? `${DAYS[i]},${DAYS[j]}` : `${DAYS[i]}-${DAYS[j]}`);
    i = j;
  }
  return runs.length ? `${runs.join(',')} ${open}-${close}` : null;
}

/** Ngược lại của `buildOpeningHours`; chuỗi form không biểu diễn được (nhiều khung giờ, luật phức tạp) → null. */
export function parseSimpleHours(raw: string): WeeklyForm | null {
  const m = /^(?:([A-Za-z,-]+)\s+)?(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(raw.trim());
  if (!m || !HHMM.test(m[2]) || !HHMM.test(m[3])) return null;
  const days: boolean[] = Array(7).fill(!m[1]);
  for (const part of m[1]?.split(',') ?? []) {
    const [a, b = a] = part.split('-');
    const from = DAYS.indexOf(a as (typeof DAYS)[number]);
    const to = DAYS.indexOf(b as (typeof DAYS)[number]);
    if (from < 0 || to < 0 || to < from) return null;
    for (let d = from; d <= to; d++) days[d] = true;
  }
  return { open: m[2], close: m[3], days };
}

/** Chip giá nhanh: điền sẵn hai ô "từ" / "đến" (VND mỗi người). */
export const PRICE_CHIPS: readonly { label: string; min: number | null; max: number | null }[] = [
  { label: 'Miễn phí', min: 0, max: 0 },
  { label: '< 50k', min: null, max: 50_000 },
  { label: '50–150k', min: 50_000, max: 150_000 },
  { label: '150–300k', min: 150_000, max: 300_000 },
  { label: '> 300k', min: 300_000, max: null },
];

const thousands = (v: number) => v % 1000 === 0;
const money = (v: number) => (thousands(v) ? `${v / 1000}k` : `${v.toLocaleString('vi-VN')}đ`);

/** "Miễn phí", "< 50k", "50–150k", "> 300k"; không có giá → null. */
export function formatPrice(min: number | null, max: number | null): string | null {
  if (min === 0 && max === 0) return 'Miễn phí';
  if (min === null && max === null) return null;
  if (min === null) return `< ${money(max!)}`;
  if (max === null) return `> ${money(min)}`;
  if (min === max) return money(min);
  return thousands(min) && thousands(max) ? `${min / 1000}–${max / 1000}k` : `${money(min)}–${money(max)}`;
}

/** Một dòng tóm tắt giờ và giá ("07:00–22:00 · 50–150k"); không có cả hai → null. */
export function notesSummary(notes: PlaceNotes | null): string | null {
  if (!notes) return null;
  let hours: string | null = null;
  if (notes.openingHours) {
    const form = parseSimpleHours(notes.openingHours);
    hours = form && form.days.every(Boolean) ? `${form.open}–${form.close}` : 'Có giờ mở cửa';
  }
  const parts = [hours, formatPrice(notes.priceMin, notes.priceMax)].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
