import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  ItineraryDay,
  ItineraryInput,
  ItineraryWarning,
  PlaceCategory,
  PlannerKind,
  UnscheduledPlace,
} from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { LangchainService } from '../../langchain/langchain.service.js';
import { PlaceLocationService } from '../places/place-location.service.js';
import {
  buildPlannerRequest,
  defaultStop,
  PLANNER_SYSTEM_PROMPT,
  validatePlan,
} from './ai-planner.js';
import { bad } from './errors.js';
import {
  assignToDays,
  dayCapacity,
  orderNearestFirst,
  pickExtras,
} from './planning/clustering.js';
import { buildDays, vietnamIso, type DayWindow } from './planning/days.js';
import type { Candidate, PlannedStop } from './planning/planning.types.js';
import {
  MAX_TRIP_DAYS,
  PARTY_RULES,
  targetStopsPerDay,
} from './planning/rules.js';
import { scheduleDay } from './planning/scheduler.js';

/** Số điểm dự bị gửi thêm cho AI để nó có thể đổi điểm bổ sung. */
const AI_SPARE_CANDIDATES = 10;

export interface PlanTripOptions {
  /** Địa điểm không được xuất hiện trong kết quả (nơi người dùng đã đi). Không áp cho điểm người dùng tự chọn. */
  excludePlaceIds?: string[];
  /** Không gọi Gemini: bản nháp gợi ý cần nhanh và không tốn lượt (spec 2026-10-19-home-recommendations). */
  forceHeuristic?: boolean;
  /** Người tạo lịch trình: giờ mở cửa trong ghi chú của họ ưu tiên hơn giờ của địa điểm (spec 2026-10-21-user-pinned-places §4). */
  notesOwnerId?: string | null;
}

export interface PlanTripResult {
  regionName: string;
  planner: PlannerKind;
  days: ItineraryDay[];
  unscheduled: UnscheduledPlace[];
  warnings: ItineraryWarning[];
  tips: string[];
}

interface PlaceRow {
  id: string;
  name: string;
  category: PlaceCategory;
  source: 'google' | 'web';
  location_source: 'google' | 'ai';
  lat: number;
  lng: number;
  address: string | null;
  description: string | null;
  opening_hours: string | null;
}

/**
 * Lập lịch F6 mà không lưu: chọn ứng viên, gom cụm, AI (hoặc thuật toán) sắp
 * thứ tự, rồi code xếp giờ. `ItinerariesService.create()` lưu kết quả; bản
 * nháp gợi ý ở trang chủ lưu vào kho `itinerary_drafts`.
 */
@Injectable()
export class ItineraryPlanner {
  private readonly logger = new Logger(ItineraryPlanner.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly langchain: LangchainService,
    private readonly locations: PlaceLocationService,
  ) {}

  async planTrip(
    input: ItineraryInput,
    options: PlanTripOptions = {},
  ): Promise<PlanTripResult> {
    const rules = PARTY_RULES[input.travelParty];
    const transport = input.transport ?? rules.defaultTransport;

    const start = Date.parse(input.startsAt);
    const end = Date.parse(input.endsAt);
    if (!(end > start)) {
      throw bad(
        'INVALID_DATES',
        'Thời gian kết thúc phải sau thời gian bắt đầu.',
      );
    }
    if (end - start > MAX_TRIP_DAYS * 24 * 60 * 60 * 1000) {
      throw bad('TRIP_TOO_LONG', `Chuyến đi tối đa ${MAX_TRIP_DAYS} ngày.`);
    }
    const days = buildDays(input.startsAt, input.endsAt, rules);
    if (days.length === 0) {
      throw bad('TRIP_TOO_SHORT', 'Khoảng thời gian quá ngắn để xếp lịch.');
    }

    const regionName = await this.regionName(input.regionId);

    // FR-6.3: mọi địa điểm phải có trong cơ sở dữ liệu.
    // Địa điểm Google người dùng tự chọn: lấy lại tọa độ nếu đã quá 30 ngày; không được thì bỏ và cảnh báo.
    const unlocated = new Set(
      await this.locations.ensure([
        ...input.selectedPlaceIds,
        ...(input.accommodationPlaceId ? [input.accommodationPlaceId] : []),
      ]),
    );
    const selectedIds = input.selectedPlaceIds.filter(
      (pid) => !unlocated.has(pid),
    );
    const owner = options.notesOwnerId ?? null;
    const selected = await this.loadPlaces(selectedIds, true, owner);
    const missing = selectedIds.filter(
      (id) => !selected.some((c) => c.id === id),
    );
    if (missing.length > 0) {
      throw bad('UNKNOWN_PLACES', 'Có địa điểm không tồn tại trong danh mục.', {
        placeIds: missing,
      });
    }
    let accommodation: Candidate | null = null;
    if (input.accommodationPlaceId) {
      [accommodation] = unlocated.has(input.accommodationPlaceId)
        ? []
        : await this.loadPlaces([input.accommodationPlaceId], false, owner);
      if (!accommodation || accommodation.category !== 'stay') {
        throw bad(
          'INVALID_ACCOMMODATION',
          'Nơi ở phải là một địa điểm lưu trú trong danh mục.',
        );
      }
    }

    const selectedVisits = selected.filter(
      (c) => c.category !== 'food' && c.category !== 'stay',
    );
    const selectedFood = selected.filter((c) => c.category === 'food');
    const unscheduled: UnscheduledPlace[] = selected
      .filter((c) => c.category === 'stay')
      .map((c) => ({
        placeId: c.id,
        name: c.name,
        reason: 'Điểm lưu trú — chọn làm nơi ở thay vì xếp như điểm tham quan',
      }));

    const exclude = new Set(
      [
        ...selected.map((c) => c.id),
        accommodation?.id,
        ...(options.excludePlaceIds ?? []),
      ].filter(Boolean) as string[],
    );
    const foodPool = [
      ...selectedFood,
      ...(await this.poolInArea(input.regionId, ['food'], 200, exclude, owner)),
    ];

    let planner: PlannerKind;
    let plannedDays: PlannedStop[][];
    let tips: string[] = [];

    if (input.planningMode === 'manual') {
      planner = 'manual';
      plannedDays = days.map(() => []);
      unscheduled.push(
        ...selectedVisits.map((c) => ({
          placeId: c.id,
          name: c.name,
          reason: 'Chờ bạn xếp vào lịch',
        })),
      );
    } else {
      const target = targetStopsPerDay(rules, input.pace);
      const capacities = days.map((d) => dayCapacity(d, rules, target));
      const pool = input.allowAiSuggestions
        ? await this.poolInArea(input.regionId, null, 300, exclude, owner)
        : [];
      const extras = pickExtras({
        pool,
        slots: capacities.reduce((a, b) => a + b, 0) - selectedVisits.length,
        rules,
        preferred: input.preferredCategories ?? [],
        accommodation,
        transport,
      });
      if (selectedVisits.length + extras.length === 0) {
        // FR-6.4
        throw new UnprocessableEntityException({
          statusCode: 422,
          code: 'NOT_ENOUGH_PLACES',
          message:
            'Không tìm được địa điểm phù hợp. Hãy chọn thêm địa điểm, bật "AI gợi ý thêm" hoặc bỏ bớt sở thích.',
        });
      }

      const assignment = assignToDays(
        [...selectedVisits, ...extras],
        days,
        capacities,
      );
      const heuristic = () =>
        assignment.map((list, i) =>
          orderNearestFirst(
            list,
            accommodation && !days[i].isFirst ? accommodation : null,
          ).map(defaultStop),
        );

      if (options.forceHeuristic) {
        plannedDays = heuristic();
        planner = 'heuristic';
      } else {
        const spare = input.allowAiSuggestions
          ? pickExtras({
              pool: pool.filter((c) => !extras.includes(c)),
              slots: AI_SPARE_CANDIDATES,
              rules,
              preferred: input.preferredCategories ?? [],
              accommodation,
              transport,
            })
          : [];
        try {
          const plan = await this.langchain.planItinerary(
            PLANNER_SYSTEM_PROMPT,
            buildPlannerRequest({
              input,
              regionName,
              rules,
              days,
              assignment,
              extraPool: spare,
              targetPerDay: target,
            }),
          );
          ({ stops: plannedDays, tips } = validatePlan(
            plan,
            days,
            assignment,
            spare,
          ));
          planner = 'ai';
        } catch (error) {
          // AI lỗi thì vẫn có lịch: gom cụm + đi điểm gần nhất trước.
          this.logger.warn(
            `Gemini không xếp được lịch, dùng thuật toán: ${(error as Error).message}`,
          );
          plannedDays = heuristic();
          planner = 'heuristic';
        }
      }
    }

    const usedFood = new Set<string>();
    const warnings: ItineraryWarning[] = [];
    if (unlocated.size > 0) {
      warnings.push({
        type: 'place_location_unavailable',
        message: `${unlocated.size} địa điểm tạm thời không lấy được vị trí nên chưa được xếp vào lịch.`,
      });
    }
    const outDays: ItineraryDay[] = days.map((day, i) => {
      // Tự sắp xếp: ngày để trống cho người dùng kéo điểm vào, không chèn bữa hay giờ nghỉ.
      const result =
        planner === 'manual'
          ? { items: [], unscheduled: [], warnings: [] }
          : scheduleDay(plannedDays[i], {
              day,
              rules,
              transport,
              accommodation,
              foodPool,
              usedFood,
            });
      warnings.push(
        ...(planner === 'manual' ? manualMealWarnings(day) : result.warnings),
      );
      // "Chưa xếp được" chỉ dành cho điểm người dùng chọn (FR-6.7); điểm AI thêm thì bỏ qua.
      unscheduled.push(
        ...result.unscheduled.filter((u) =>
          selected.some((c) => c.id === u.placeId),
        ),
      );
      return {
        id: `day-${i + 1}`,
        date: day.date,
        startsAt: vietnamIso(day.date, day.start),
        endsAt: vietnamIso(day.date, day.end),
        items: result.items,
      };
    });

    return {
      regionName,
      planner,
      days: outDays,
      unscheduled: dedupeUnscheduled(unscheduled),
      warnings,
      tips,
    };
  }

  async regionName(regionId: string): Promise<string> {
    const [row] = (await this.db.query(
      `SELECT r.name, p.name AS parent FROM regions r LEFT JOIN regions p ON p.id = r.parent_id WHERE r.id = $1`,
      [regionId],
    )) as Array<{ name: string; parent: string | null }>;
    if (!row) throw bad('UNKNOWN_REGION', 'Không tìm thấy vùng này.');
    return row.parent ? `${row.name}, ${row.parent}` : row.name;
  }

  /** `notesOwnerId`: người tạo lịch trình, để lấy giờ mở cửa trong ghi chú của họ. */
  async loadPlaces(
    ids: string[],
    mandatory: boolean,
    notesOwnerId: string | null = null,
  ): Promise<Candidate[]> {
    if (ids.length === 0) return [];
    const rows = (await this.db.query(
      `${placeSelect('$2')} WHERE p.id = ANY($1::uuid[])`,
      [ids, notesOwnerId],
    )) as PlaceRow[];
    // Địa điểm người dùng chọn không có thứ hạng trong danh sách vùng: điểm 0.
    return rows.map((r) => toCandidate(r, mandatory, 0));
  }

  /**
   * Địa điểm bổ sung / quán ăn: danh sách đã tổng hợp của vùng (spec
   * 2026-10-14-web-places), theo thứ hạng. Điểm suy từ thứ hạng để pickExtras
   * và kMeans vẫn so được: hạng 0 → 100, mỗi hạng sau trừ 2, không âm.
   */
  private async poolInArea(
    regionId: string,
    categories: PlaceCategory[] | null,
    limit: number,
    exclude: Set<string>,
    notesOwnerId: string | null,
  ): Promise<Candidate[]> {
    const rows = (await this.db.query(
      `${placeSelect('$5')}
         JOIN region_places rp ON rp.place_id = p.id AND rp.region_id = $1
        WHERE ($2::place_category[] IS NULL OR p.category = ANY($2::place_category[]))
          AND p.location IS NOT NULL
          AND NOT (p.id = ANY($4::uuid[]))
        ORDER BY rp.rank
        LIMIT $3`,
      [regionId, categories, limit, [...exclude], notesOwnerId],
    )) as PlaceRow[];
    return rows.map((r, i) => toCandidate(r, false, Math.max(0, 100 - i * 2)));
  }
}

/** `ownerParam`: tham số chứa id người tạo lịch trình; giờ trong ghi chú của họ ưu tiên hơn giờ của địa điểm. */
function placeSelect(ownerParam: string): string {
  return `
  SELECT p.id, p.name, p.category, p.source, p.location_source, ST_Y(p.location) AS lat, ST_X(p.location) AS lng,
         p.address, p.description, COALESCE(n.opening_hours, p.tags->>'opening_hours') AS opening_hours
    FROM places p
    LEFT JOIN place_notes n ON n.place_id = p.id AND n.user_id = ${ownerParam}::uuid`;
}

function toCandidate(
  row: PlaceRow,
  mandatory: boolean,
  score: number,
): Candidate {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    address: row.source === 'google' ? null : row.address,
    lat: Number(row.lat),
    lng: Number(row.lng),
    score,
    description: row.description,
    openingHours: row.opening_hours,
    mandatory,
    isGoogle: row.location_source === 'google',
    locationSource: row.location_source,
  };
}

function manualMealWarnings(day: DayWindow): ItineraryWarning[] {
  return [
    {
      type: 'missing_meal',
      message: `Ngày ${day.index + 1}: chưa có bữa ăn — thêm quán ăn vào lịch.`,
      dayId: `day-${day.index + 1}`,
    },
  ];
}

function dedupeUnscheduled(list: UnscheduledPlace[]): UnscheduledPlace[] {
  const seen = new Map<string, UnscheduledPlace>();
  for (const item of list)
    if (!seen.has(item.placeId)) seen.set(item.placeId, item);
  return [...seen.values()];
}
