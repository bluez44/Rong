import type { PlaceCategory, Transport } from '@rong/shared-types';

import type { DayWindow } from './days.js';
import type { Candidate } from './planning.types.js';
import { MAX_MINUTES_FROM_ACCOMMODATION, type PartyRules } from './rules.js';
import { estimateLeg, haversineKm, type LatLng } from './travel.js';

/** Một danh mục không chiếm quá tỷ lệ này trong các điểm được thêm, để lịch không toàn quán cà phê. */
const MAX_CATEGORY_SHARE = 0.4;

/** Số điểm một ngày chứa được, co lại theo phần ngày còn dùng được (ngày đầu/cuối thường ngắn). */
export function dayCapacity(
  day: DayWindow,
  rules: PartyRules,
  target: number,
): number {
  const fullDay = rules.dayEnd - rules.dayStart;
  return Math.max(1, Math.round((target * (day.end - day.start)) / fullDay));
}

/**
 * Chọn điểm bổ sung từ danh mục cho đủ số điểm mục tiêu: điểm cao trước, hợp
 * đối tượng và sở thích, không quá xa nơi ở, không để một danh mục áp đảo.
 */
export function pickExtras(options: {
  pool: Candidate[];
  slots: number;
  rules: PartyRules;
  preferred: PlaceCategory[];
  accommodation: LatLng | null;
  transport: Transport;
}): Candidate[] {
  const { pool, slots, rules, preferred, accommodation, transport } = options;
  if (slots <= 0) return [];

  const boost = (c: Candidate) =>
    c.score +
    (preferred.includes(c.category) ? 15 : 0) +
    (rules.preferCategories.includes(c.category) ? 8 : 0);

  const eligible = pool
    .filter((c) => !rules.avoidCategories.includes(c.category))
    .filter((c) => c.category !== 'stay' && c.category !== 'food')
    .filter(
      (c) =>
        preferred.length === 0 ||
        preferred.includes(c.category) ||
        c.score >= 50,
    )
    .filter(
      (c) =>
        accommodation === null ||
        estimateLeg(accommodation, c, transport).minutes <=
          MAX_MINUTES_FROM_ACCOMMODATION,
    )
    .sort((a, b) => boost(b) - boost(a) || a.id.localeCompare(b.id));

  const picked: Candidate[] = [];
  const perCategory = new Map<PlaceCategory, number>();
  const cap = Math.max(1, Math.ceil(slots * MAX_CATEGORY_SHARE));
  for (const candidate of eligible) {
    if (picked.length >= slots) break;
    const used = perCategory.get(candidate.category) ?? 0;
    if (used >= cap) continue;
    picked.push(candidate);
    perCategory.set(candidate.category, used + 1);
  }
  return picked;
}

/**
 * Gom địa điểm thành `k` cụm theo vị trí (k-means, khởi tạo tất định: điểm
 * cao nhất rồi lần lượt điểm xa các tâm nhất), để mỗi ngày ở 1–2 khu vực và
 * không phải chạy qua chạy lại (PRD F6 bước 2).
 */
export function kMeans(
  points: Candidate[],
  k: number,
  iterations = 15,
): Candidate[][] {
  if (points.length === 0) return [];
  const clusters = Math.min(k, points.length);

  const sorted = [...points].sort(
    (a, b) => b.score - a.score || a.id.localeCompare(b.id),
  );
  const centers: LatLng[] = [{ lat: sorted[0].lat, lng: sorted[0].lng }];
  while (centers.length < clusters) {
    let farthest = sorted[0];
    let best = -1;
    for (const p of sorted) {
      const d = Math.min(...centers.map((c) => haversineKm(c, p)));
      if (d > best) {
        best = d;
        farthest = p;
      }
    }
    centers.push({ lat: farthest.lat, lng: farthest.lng });
  }

  let groups: Candidate[][] = [];
  for (let i = 0; i < iterations; i++) {
    groups = centers.map(() => []);
    for (const p of sorted) {
      let nearest = 0;
      for (let c = 1; c < centers.length; c++) {
        if (haversineKm(centers[c], p) < haversineKm(centers[nearest], p))
          nearest = c;
      }
      groups[nearest].push(p);
    }
    groups.forEach((group, c) => {
      if (group.length > 0) {
        centers[c] = {
          lat: group.reduce((s, p) => s + p.lat, 0) / group.length,
          lng: group.reduce((s, p) => s + p.lng, 0) / group.length,
        };
      }
    });
  }
  return groups;
}

const centroid = (group: Candidate[]): LatLng => ({
  lat: group.reduce((s, p) => s + p.lat, 0) / group.length,
  lng: group.reduce((s, p) => s + p.lng, 0) / group.length,
});

/**
 * Phân các cụm vào ngày theo sức chứa. Ngày quá tải thì bỏ bớt điểm bổ sung có
 * điểm thấp nhất; nếu vẫn quá tải vì điểm bắt buộc thì chuyển sang ngày còn chỗ
 * gần nhất. Điểm bắt buộc không bao giờ bị bỏ ở bước này.
 */
export function assignToDays(
  candidates: Candidate[],
  days: DayWindow[],
  capacities: number[],
): Candidate[][] {
  const result: Candidate[][] = days.map(() => []);
  if (days.length === 0) return result;

  const groups = kMeans(candidates, days.length).filter((g) => g.length > 0);
  // Cụm lớn vào ngày rộng.
  const dayOrder = days
    .map((_, i) => i)
    .sort((a, b) => capacities[b] - capacities[a]);
  groups
    .sort((a, b) => b.length - a.length)
    .forEach((group, i) => {
      result[dayOrder[i % dayOrder.length]].push(...group);
    });

  for (let d = 0; d < result.length; d++) {
    while (result[d].length > capacities[d]) {
      const extras = result[d]
        .filter((c) => !c.mandatory)
        .sort((a, b) => a.score - b.score);
      if (extras.length > 0) {
        result[d].splice(result[d].indexOf(extras[0]), 1);
        continue;
      }
      const here = centroid(result[d]);
      const target = result
        .map((list, i) => ({ i, free: capacities[i] - list.length }))
        .filter(({ i, free }) => i !== d && free > 0)
        .sort(
          (a, b) =>
            haversineKm(
              here,
              result[a.i].length ? centroid(result[a.i]) : here,
            ) -
            haversineKm(
              here,
              result[b.i].length ? centroid(result[b.i]) : here,
            ),
        )[0];
      if (!target) break; // Không còn chỗ: để bộ xếp giờ đưa vào "Chưa xếp được".
      const moved = result[d].sort((a, b) => a.score - b.score).shift()!;
      result[target.i].push(moved);
    }
  }
  return result;
}

/** Thứ tự đi trong ngày: điểm gần nhất trước, bắt đầu từ nơi ở (nếu có) hoặc điểm nổi bật nhất. */
export function orderNearestFirst(
  stops: Candidate[],
  start: LatLng | null,
): Candidate[] {
  const remaining = [...stops];
  const ordered: Candidate[] = [];
  let here: LatLng | null = start;
  while (remaining.length > 0) {
    let index = 0;
    if (here === null) {
      remaining.forEach((c, i) => {
        if (c.score > remaining[index].score) index = i;
      });
    } else {
      const from = here;
      remaining.forEach((c, i) => {
        if (haversineKm(from, c) < haversineKm(from, remaining[index]))
          index = i;
      });
    }
    const [next] = remaining.splice(index, 1);
    ordered.push(next);
    here = next;
  }
  return ordered;
}
