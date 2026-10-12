const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Giới hạn số lượt tìm Google theo người dùng (cửa sổ trượt). Đếm trong bộ nhớ
 * process — đủ khi chạy một instance (spec §1.1).
 */
export class PlaceSearchLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = DAY_MS,
    private readonly now: () => number = Date.now,
  ) {}

  tryConsume(userId: string): boolean {
    const now = this.now();
    const recent = (this.hits.get(userId) ?? []).filter(
      (t) => now - t < this.windowMs,
    );
    if (recent.length >= this.limit) {
      this.hits.set(userId, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(userId, recent);
    return true;
  }
}
