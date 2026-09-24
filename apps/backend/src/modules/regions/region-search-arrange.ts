import type {
  AdministrativeLevel,
  BoundaryVersion,
  RegionSearchGroup,
  RegionSearchResult,
  RegionType,
} from '@rong/shared-types';

/** Những gì thuật toán sắp xếp cần biết về một vùng. */
export interface RegionLite {
  id: string;
  name: string;
  type: RegionType;
  boundaryVersion: BoundaryVersion;
  level: AdministrativeLevel | null;
  parentId: string | null;
  formerParentId: string | null;
  successorRegionId: string | null;
  mergeNote: string | null;
  center: { lat: number; lng: number } | null;
  bbox: [number, number, number, number] | null;
}

export interface RegionMatch {
  regionId: string;
  /** 1 = khớp đúng, 0.9 = khớp đầu chuỗi, 0.8 = khớp đầu một từ, còn lại là độ tương đồng trigram. */
  score: number;
}

/** Kết quả từ mức này trở lên coi là "khớp rõ" và được xếp theo nhóm FR-1.4. */
export const STRONG_MATCH = 0.6;
/** Khớp đúng tên hoặc đúng bí danh (bí danh bị trừ 0.02). */
const EXACT_MATCH = 0.95;
const MAX_RESULTS = 10;

export function displayName(region: RegionLite): string {
  if (region.level !== 'province') return region.name;
  if (region.boundaryVersion === 'pre_merger') return `${region.name} (cũ)`;
  // Tỉnh mới chỉ gắn nhãn "(mới)" khi có thay đổi địa giới; tỉnh giữ nguyên thì chỉ một kết quả.
  return region.mergeNote !== null ? `${region.name} (mới)` : region.name;
}

function groupOf(region: RegionLite): RegionSearchGroup {
  if (region.level === 'province') return 'province';
  if (region.level === 'ward') return 'ward';
  return 'destination';
}

const GROUP_RANK: Record<RegionSearchGroup, number> = {
  province: 0,
  destination: 1,
  ward: 2,
};

interface Entry {
  region: RegionLite;
  score: number;
  note: string | null;
  /** Vùng liên quan hiện ngay sau vùng này: tỉnh kế nhiệm, tỉnh chứa nó. */
  related: Array<{ region: RegionLite; note: string | null }>;
}

/**
 * Dựng danh sách kết quả cuối từ các vùng khớp trực tiếp với từ khóa.
 *
 * - Có kết quả khớp rõ thì bỏ các kết quả khớp yếu.
 * - Các vùng khớp trực tiếp xếp theo FR-1.4: điểm đến khớp đúng tên lên đầu;
 *   rồi tỉnh/thành, điểm đến, xã/phường; kết quả khớp yếu xếp sau cùng.
 * - Ngay sau mỗi vùng là các vùng liên quan (FR-1.9): tỉnh cũ → tỉnh mới kế
 *   nhiệm ("bao gồm X cũ"); điểm đến/xã phường → tỉnh mới rồi tỉnh cũ chứa nó.
 */
export function arrangeRegionResults(
  matches: RegionMatch[],
  regions: Map<string, RegionLite>,
): RegionSearchResult[] {
  const get = (id: string | null): RegionLite | undefined =>
    id === null ? undefined : regions.get(id);

  // Đã có kết quả khớp rõ thì các kết quả na ná (trigram) chỉ là nhiễu:
  // "lam dong" không cần kéo theo "Đồng Nai".
  const hasStrong = matches.some((m) => m.score >= STRONG_MATCH);
  const relevant = hasStrong
    ? matches.filter((m) => m.score >= STRONG_MATCH)
    : matches;

  const entries: Entry[] = [];
  for (const match of relevant) {
    const region = regions.get(match.regionId);
    if (!region) continue;

    const related: Entry['related'] = [];
    if (
      region.level === 'province' &&
      region.boundaryVersion === 'pre_merger'
    ) {
      const successor = get(region.successorRegionId);
      if (successor)
        related.push({ region: successor, note: `bao gồm ${region.name} cũ` });
    } else if (region.level !== 'province') {
      for (const ancestor of [
        get(region.parentId),
        get(region.formerParentId),
      ]) {
        if (ancestor)
          related.push({ region: ancestor, note: standardNote(ancestor, get) });
      }
    }
    entries.push({
      region,
      score: match.score,
      note: standardNote(region, get),
      related,
    });
  }

  entries.sort((a, b) => {
    const strongA = a.score >= STRONG_MATCH;
    const strongB = b.score >= STRONG_MATCH;
    if (strongA !== strongB) return strongA ? -1 : 1;
    if (strongA) {
      const exactA =
        a.score >= EXACT_MATCH && groupOf(a.region) === 'destination';
      const exactB =
        b.score >= EXACT_MATCH && groupOf(b.region) === 'destination';
      if (exactA !== exactB) return exactA ? -1 : 1;
      const group =
        GROUP_RANK[groupOf(a.region)] - GROUP_RANK[groupOf(b.region)];
      if (group !== 0) return group;
    }
    if (b.score !== a.score) return b.score - a.score;
    if (a.region.boundaryVersion !== b.region.boundaryVersion) {
      return a.region.boundaryVersion === 'current' ? -1 : 1;
    }
    return a.region.name.localeCompare(b.region.name, 'vi');
  });

  // Vùng đã xuất hiện (tự thân hoặc kéo theo) thì không lặp lại. Vùng vừa khớp
  // trực tiếp vừa được kéo theo giữ vị trí nào đến trước.
  const directIds = new Set(entries.map((e) => e.region.id));
  const seen = new Set<string>();
  const ordered: Array<{ region: RegionLite; note: string | null }> = [];
  for (const entry of entries) {
    if (!seen.has(entry.region.id)) {
      seen.add(entry.region.id);
      ordered.push(entry);
    }
    for (const rel of entry.related) {
      // Vùng liên quan cũng khớp trực tiếp và đứng sau → để nó ở vị trí tự thân của nó.
      if (
        seen.has(rel.region.id) ||
        (directIds.has(rel.region.id) && rel.region.level !== 'province')
      ) {
        continue;
      }
      seen.add(rel.region.id);
      ordered.push(rel);
    }
  }

  return ordered.slice(0, MAX_RESULTS).map(({ region, note }) => {
    const parent =
      region.boundaryVersion === 'pre_merger'
        ? get(region.successorRegionId)
        : get(region.parentId);
    return {
      id: region.id,
      name: region.name,
      displayName: displayName(region),
      type: region.type,
      group: groupOf(region),
      boundaryVersion: region.boundaryVersion,
      note,
      parent: parent
        ? { id: parent.id, displayName: displayName(parent) }
        : null,
      center: region.center,
      bbox: region.bbox,
    };
  });
}

/** Ghi chú khi vùng xuất hiện "tự thân", không phải vì một vùng khác kéo theo. */
function standardNote(
  region: RegionLite,
  get: (id: string | null) => RegionLite | undefined,
): string | null {
  if (region.level === 'province') {
    if (region.boundaryVersion === 'pre_merger') {
      const successor = get(region.successorRegionId);
      return successor ? `nay thuộc ${displayName(successor)}` : null;
    }
    return region.mergeNote;
  }

  const parent = get(region.parentId);
  if (!parent) return null;
  const former = get(region.formerParentId);
  // "Vũng Tàu (nay thuộc TP. Hồ Chí Minh)" — FR-1.3; không đổi tỉnh thì chỉ "thuộc".
  return former && former.name !== parent.name
    ? `nay thuộc ${displayName(parent)}`
    : `thuộc ${displayName(parent)}`;
}
