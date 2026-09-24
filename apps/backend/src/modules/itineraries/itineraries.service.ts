import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type {
  Itinerary as ItineraryResponse,
  ItineraryDay,
  ItineraryInput,
  ItinerarySummary,
  ItineraryWarning,
  PlaceCategory,
  PlannerKind,
  UnscheduledPlace,
} from '@rong/shared-types';
import { DataSource, Repository } from 'typeorm';

import { LangchainService } from '../../langchain/langchain.service.js';
import type { Bbox } from '../regions/bbox.js';
import { RegionAreaService } from '../regions/region-area.service.js';
import {
  buildPlannerRequest,
  defaultStop,
  PLANNER_SYSTEM_PROMPT,
  validatePlan,
} from './ai-planner.js';
import type { CreateItineraryDto } from './dto/create-itinerary.dto.js';
import { Itinerary } from './entities/itinerary.entity.js';
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

interface PlaceRow {
  id: string;
  name: string;
  category: PlaceCategory;
  lat: number;
  lng: number;
  composite_score: number;
  description: string | null;
  opening_hours: string | null;
}

@Injectable()
export class ItinerariesService {
  private readonly logger = new Logger(ItinerariesService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @InjectRepository(Itinerary)
    private readonly itineraries: Repository<Itinerary>,
    private readonly areas: RegionAreaService,
    private readonly langchain: LangchainService,
  ) {}

  async create(
    ownerId: string,
    dto: CreateItineraryDto,
  ): Promise<ItineraryResponse> {
    const input = normalize(dto);
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

    const region = await this.regionName(input.regionId);

    // FR-6.3: mọi địa điểm phải có trong cơ sở dữ liệu.
    const selected = await this.loadPlaces(input.selectedPlaceIds, true);
    const missing = input.selectedPlaceIds.filter(
      (id) => !selected.some((c) => c.id === id),
    );
    if (missing.length > 0) {
      throw bad('UNKNOWN_PLACES', 'Có địa điểm không tồn tại trong danh mục.', {
        placeIds: missing,
      });
    }
    let accommodation: Candidate | null = null;
    if (input.accommodationPlaceId) {
      [accommodation] = await this.loadPlaces(
        [input.accommodationPlaceId],
        false,
      );
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
        reason: 'Điểm lưu trú — chọn làm nơi ở thay vì xếp như điểm tham quan',
      }));

    const bbox = await this.searchArea(input.regionId, selected, accommodation);
    const exclude = new Set(
      [...selected.map((c) => c.id), accommodation?.id].filter(
        Boolean,
      ) as string[],
    );
    const foodPool = [
      ...selectedFood,
      ...(await this.poolInArea(bbox, ['food'], 200)).filter(
        (c) => !exclude.has(c.id),
      ),
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
          reason: 'Chờ bạn xếp vào lịch',
        })),
      );
    } else {
      const target = targetStopsPerDay(rules, input.pace);
      const capacities = days.map((d) => dayCapacity(d, rules, target));
      const pool = input.allowAiSuggestions
        ? (await this.poolInArea(bbox, null, 300)).filter(
            (c) => !exclude.has(c.id),
          )
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
            regionName: region,
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
        plannedDays = assignment.map((list, i) =>
          orderNearestFirst(
            list,
            accommodation && !days[i].isFirst ? accommodation : null,
          ).map(defaultStop),
        );
        planner = 'heuristic';
      }
    }

    const usedFood = new Set<string>();
    const warnings: ItineraryWarning[] = [];
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

    const saved = await this.itineraries.save(
      this.itineraries.create({
        ownerId,
        regionId: input.regionId,
        planner,
        startsAt: new Date(start),
        endsAt: new Date(end),
        input,
        days: outDays,
        unscheduled: dedupeUnscheduled(unscheduled),
        warnings,
        tips,
      }),
    );
    return toResponse(saved);
  }

  async list(ownerId: string): Promise<ItinerarySummary[]> {
    const rows = (await this.db.query(
      `SELECT i.id, i.region_id, r.name AS region_name, i.starts_at, i.ends_at, i.planner,
              jsonb_array_length(i.days) AS day_count, i.created_at
         FROM itineraries i JOIN regions r ON r.id = i.region_id
        WHERE i.owner_id = $1
        ORDER BY i.created_at DESC
        LIMIT 100`,
      [ownerId],
    )) as Array<{
      id: string;
      region_id: string;
      region_name: string;
      starts_at: Date;
      ends_at: Date;
      planner: PlannerKind;
      day_count: number;
      created_at: Date;
    }>;
    return rows.map((r) => ({
      id: r.id,
      regionId: r.region_id,
      regionName: r.region_name,
      startsAt: r.starts_at.toISOString(),
      endsAt: r.ends_at.toISOString(),
      planner: r.planner,
      dayCount: Number(r.day_count),
      createdAt: r.created_at.toISOString(),
    }));
  }

  async get(ownerId: string, id: string): Promise<ItineraryResponse> {
    return toResponse(await this.findOwned(ownerId, id));
  }

  async remove(ownerId: string, id: string): Promise<void> {
    await this.itineraries.delete({
      id: (await this.findOwned(ownerId, id)).id,
    });
  }

  /** Lịch trình của người khác trả 404 như không tồn tại, để không lộ id hợp lệ. */
  private async findOwned(ownerId: string, id: string): Promise<Itinerary> {
    const itinerary = await this.itineraries.findOneBy({ id, ownerId });
    if (!itinerary) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'ITINERARY_NOT_FOUND',
        message: 'Không tìm thấy lịch trình này.',
      });
    }
    return itinerary;
  }

  private async regionName(regionId: string): Promise<string> {
    const [row] = (await this.db.query(
      `SELECT r.name, p.name AS parent FROM regions r LEFT JOIN regions p ON p.id = r.parent_id WHERE r.id = $1`,
      [regionId],
    )) as Array<{ name: string; parent: string | null }>;
    if (!row) throw bad('UNKNOWN_REGION', 'Không tìm thấy vùng này.');
    return row.parent ? `${row.name}, ${row.parent}` : row.name;
  }

  /**
   * Khung tìm địa điểm bổ sung và quán ăn: khung bao của vùng; không có (nguồn
   * dữ liệu mở lỗi) thì khung quanh các địa điểm đã chọn, nới thêm ~5 km.
   */
  private async searchArea(
    regionId: string,
    selected: Candidate[],
    accommodation: Candidate | null,
  ): Promise<Bbox | null> {
    try {
      return await this.areas.ensure(regionId);
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      const points = [...selected, ...(accommodation ? [accommodation] : [])];
      if (points.length === 0) return null;
      const pad = 0.05;
      return [
        Math.min(...points.map((p) => p.lat)) - pad,
        Math.min(...points.map((p) => p.lng)) - pad,
        Math.max(...points.map((p) => p.lat)) + pad,
        Math.max(...points.map((p) => p.lng)) + pad,
      ];
    }
  }

  private async loadPlaces(
    ids: string[],
    mandatory: boolean,
  ): Promise<Candidate[]> {
    if (ids.length === 0) return [];
    const rows = (await this.db.query(
      `${PLACE_SELECT} WHERE p.id = ANY($1::uuid[])`,
      [ids],
    )) as PlaceRow[];
    return rows.map((r) => toCandidate(r, mandatory));
  }

  private async poolInArea(
    bbox: Bbox | null,
    categories: PlaceCategory[] | null,
    limit: number,
  ): Promise<Candidate[]> {
    if (bbox === null) return [];
    const rows = (await this.db.query(
      `${PLACE_SELECT}
        WHERE p.location && ST_MakeEnvelope($1, $2, $3, $4, 4326)
          AND ($5::place_category[] IS NULL OR p.category = ANY($5::place_category[]))
        ORDER BY p.composite_score DESC, p.id
        LIMIT $6`,
      [bbox[1], bbox[0], bbox[3], bbox[2], categories, limit],
    )) as PlaceRow[];
    return rows.map((r) => toCandidate(r, false));
  }
}

const PLACE_SELECT = `
  SELECT p.id, p.name, p.category, ST_Y(p.location) AS lat, ST_X(p.location) AS lng,
         p.composite_score, p.description, p.tags->>'opening_hours' AS opening_hours
    FROM places p`;

function toCandidate(row: PlaceRow, mandatory: boolean): Candidate {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    lat: Number(row.lat),
    lng: Number(row.lng),
    score: Number(row.composite_score),
    description: row.description,
    openingHours: row.opening_hours,
    mandatory,
  };
}

/** Điền giá trị mặc định theo PRD F6: ngân sách "Vừa phải", nhịp độ theo đối tượng, AI gợi ý thêm "Bật". */
function normalize(dto: CreateItineraryDto): ItineraryInput {
  const slow =
    dto.travelParty === 'family_with_kids' ||
    dto.travelParty === 'with_elderly';
  return {
    regionId: dto.regionId,
    planningMode: dto.planningMode,
    startsAt: dto.startsAt,
    endsAt: dto.endsAt,
    travelParty: dto.travelParty,
    adults: dto.adults,
    children: dto.children,
    selectedPlaceIds: [...new Set(dto.selectedPlaceIds ?? [])],
    accommodationPlaceId: dto.accommodationPlaceId ?? null,
    allowAiSuggestions: dto.allowAiSuggestions ?? true,
    budgetTier: dto.budgetTier ?? 'moderate',
    pace: dto.pace ?? (slow ? 'relaxed' : 'moderate'),
    transport: dto.transport ?? null,
    preferredCategories: dto.preferredCategories ?? [],
    notes: dto.notes?.trim() || null,
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

function bad(
  code: string,
  message: string,
  extra: object = {},
): BadRequestException {
  return new BadRequestException({ statusCode: 400, code, message, ...extra });
}

function toResponse(it: Itinerary): ItineraryResponse {
  return {
    id: it.id,
    ownerId: it.ownerId,
    groupId: null,
    regionId: it.regionId,
    input: it.input,
    days: it.days,
    unscheduled: it.unscheduled,
    warnings: it.warnings,
    planner: it.planner,
    tips: it.tips,
    aiEditsRemaining: it.aiEditsRemaining,
    createdAt: it.createdAt.toISOString(),
    updatedAt: it.updatedAt.toISOString(),
  };
}
