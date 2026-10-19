/** Việt Nam cố định UTC+7, không có giờ mùa hè. */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Khung giờ của bộ gợi ý: làm mới lúc 6:00 và 15:00 giờ Việt Nam
 * (spec 2026-10-19-home-recommendations).
 */
export function windowFor(now: Date): {
  windowStart: Date;
  nextRefreshAt: Date;
} {
  // Các trường UTC của `local` là giờ Việt Nam.
  const local = new Date(now.getTime() + VN_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  const hour = local.getUTCHours();
  const at = (dayOffset: number, h: number) =>
    new Date(Date.UTC(y, m, d + dayOffset, h) - VN_OFFSET_MS);

  if (hour < 6) return { windowStart: at(-1, 15), nextRefreshAt: at(0, 6) };
  if (hour < 15) return { windowStart: at(0, 6), nextRefreshAt: at(0, 15) };
  return { windowStart: at(0, 15), nextRefreshAt: at(1, 6) };
}
