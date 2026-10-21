const REGION_COOLDOWN_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RefreshLimitResult = 'ok' | 'region' | 'daily';

/**
 * Giới hạn reset địa điểm (mỗi lần tốn phí Tavily + Gemini): mỗi vùng một lần trong 10 phút, cả hệ thống
 * `dailyLimit` lần trong 24 giờ (cửa sổ trượt). Đếm trong bộ nhớ process, đủ khi chạy một instance;
 * khởi động lại thì đếm lại từ đầu.
 */
export class AdminRefreshLimiter {
  private readonly lastByRegion = new Map<string, number>();
  private recent: number[] = [];

  constructor(
    private readonly dailyLimit: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Lần bị chặn không tính lượt. */
  tryConsume(regionId: string): RefreshLimitResult {
    const now = this.now();
    const last = this.lastByRegion.get(regionId);
    if (last !== undefined && now - last < REGION_COOLDOWN_MS) return 'region';
    this.recent = this.recent.filter((t) => now - t < DAY_MS);
    if (this.recent.length >= this.dailyLimit) return 'daily';
    this.recent.push(now);
    this.lastByRegion.set(regionId, now);
    return 'ok';
  }
}
