import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type {
  Itinerary as ItineraryResponse,
  ItineraryDay,
  ItineraryInput,
  ItineraryRole,
  ItinerarySummary,
  ItineraryWarning,
  PlaceAlternative,
  PlaceCategory,
  PlannerKind,
  UnscheduledPlace,
} from '@rong/shared-types';
import { DataSource, Repository, type EntityManager } from 'typeorm';

import { LangchainService } from '../../langchain/langchain.service.js';
import {
  decide,
  type ItineraryAccess,
  type ItineraryAction,
} from '../groups/access.js';
import { AccessService } from '../groups/access.service.js';
import { ActivityService } from '../groups/activity.service.js';
import { forbiddenRole, itineraryNotFound } from '../groups/errors.js';
import type { Bbox } from '../regions/bbox.js';
import { RegionAreaService } from '../regions/region-area.service.js';
import {
  buildPlannerRequest,
  defaultStop,
  PLANNER_SYSTEM_PROMPT,
  validatePlan,
} from './ai-planner.js';
import type { CreateItineraryDto } from './dto/create-itinerary.dto.js';
import type { UpdateItineraryDto } from './dto/update-itinerary.dto.js';
import { Itinerary } from './entities/itinerary.entity.js';
import { itinerarySummaries } from './itinerary-summaries.js';
import {
  assignToDays,
  dayCapacity,
  orderNearestFirst,
  pickExtras,
} from './planning/clustering.js';
import {
  buildDays,
  toVietnamLocal,
  vietnamIso,
  type DayWindow,
} from './planning/days.js';
import type { Candidate, PlannedStop } from './planning/planning.types.js';
import {
  MAX_TRIP_DAYS,
  PARTY_RULES,
  targetStopsPerDay,
} from './planning/rules.js';
import { retimeDay } from './planning/retime.js';
import { scheduleDay } from './planning/scheduler.js';

/** "Đổi điểm tương tự" (FR-8.3): số gợi ý và bán kính tìm quanh điểm đang thay. */
const ALTERNATIVES = 3;
const ALTERNATIVES_RADIUS_M = 5000;

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
    private readonly access: AccessService,
    private readonly activity: ActivityService,
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

    // FR-6.8: lịch trình tạo trong nhóm thuộc nhóm đó; viewer không tạo được.
    const groupId = dto.groupId ?? null;
    if (groupId) await this.access.requireGroupRole(ownerId, groupId, 'editor');

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
        name: c.name,
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
          name: c.name,
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

    const saved = await this.db.transaction(async (m) => {
      const it = await m.save(
        this.itineraries.create({
          ownerId,
          regionId: input.regionId,
          groupId,
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
      await this.logToGroup(m, it, ownerId, 'itinerary_added', region);
      return it;
    });
    return this.respond(saved, { isCreator: true, groupRole: null });
  }

  /** Lịch trình tôi tạo và lịch trình thuộc nhóm tôi tham gia. */
  async list(userId: string): Promise<ItinerarySummary[]> {
    return itinerarySummaries(this.db, userId, null);
  }

  async get(userId: string, id: string): Promise<ItineraryResponse> {
    const { itinerary, access } = await this.authorize(userId, id, 'view');
    return this.respond(itinerary, access);
  }

  /**
   * Sửa lịch trình (F8): thay các ngày và "Chưa xếp" theo đúng thứ tự người
   * dùng đặt, rồi tính lại giờ, di chuyển và cảnh báo (FR-8.5, FR-8.6).
   */
  async update(
    ownerId: string,
    id: string,
    dto: UpdateItineraryDto,
  ): Promise<ItineraryResponse> {
    const { itinerary, access } = await this.authorize(ownerId, id, 'edit');
    const dayIds = itinerary.days.map((d) => d.id);
    if (
      dto.days.length !== dayIds.length ||
      dto.days.some((d, i) => d.id !== dayIds[i])
    ) {
      throw bad(
        'DAYS_MISMATCH',
        'Lịch trình đã thay đổi ở nơi khác. Tải lại rồi thử lại.',
      );
    }
    for (const item of dto.days.flatMap((d) => d.items)) {
      if (item.kind !== 'rest' && !item.placeId) {
        throw bad(
          'PLACE_REQUIRED',
          'Điểm tham quan và bữa ăn cần có địa điểm.',
        );
      }
    }

    const { input } = itinerary;
    const placeIds = [
      ...new Set([
        ...dto.days.flatMap((d) =>
          d.items.flatMap((i) => (i.placeId ? [i.placeId] : [])),
        ),
        ...dto.unscheduledPlaceIds,
      ]),
    ];
    const found = await this.loadPlaces(placeIds, true);
    const missing = placeIds.filter((pid) => !found.some((c) => c.id === pid));
    if (missing.length > 0) {
      throw bad('UNKNOWN_PLACES', 'Có địa điểm không tồn tại trong danh mục.', {
        placeIds: missing,
      });
    }
    const places = new Map(found.map((c) => [c.id, c]));
    const [accommodation] = input.accommodationPlaceId
      ? await this.loadPlaces([input.accommodationPlaceId], false)
      : [];
    const transport =
      input.transport ?? PARTY_RULES[input.travelParty].defaultTransport;

    const warnings: ItineraryWarning[] = [];
    const days: ItineraryDay[] = itinerary.days.map((stored, index) => {
      const result = retimeDay(dto.days[index].items, {
        day: windowOf(stored, index),
        transport,
        accommodation: accommodation ?? null,
        places,
      });
      warnings.push(...result.warnings);
      return { ...stored, items: result.items };
    });

    const reasons = new Map(
      itinerary.unscheduled.map((u) => [u.placeId, u.reason]),
    );
    itinerary.days = days;
    itinerary.warnings = warnings;
    itinerary.unscheduled = [...new Set(dto.unscheduledPlaceIds)].map(
      (placeId) => ({
        placeId,
        name: places.get(placeId)!.name,
        reason: reasons.get(placeId) ?? 'Chờ bạn xếp vào lịch',
      }),
    );
    const region = await this.regionName(itinerary.regionId);
    const saved = await this.db.transaction(async (m) => {
      const it = await m.save(itinerary);
      await this.logToGroup(m, it, ownerId, 'itinerary_updated', region);
      return it;
    });
    return this.respond(saved, access);
  }

  /**
   * "Đổi điểm tương tự" (FR-8.3): điểm cùng loại quanh điểm đang thay, chưa có
   * trong lịch trình, điểm tổng hợp cao trước.
   */
  async alternatives(
    ownerId: string,
    id: string,
    placeId: string,
  ): Promise<PlaceAlternative[]> {
    const { itinerary } = await this.authorize(ownerId, id, 'view');
    const used = [
      ...itinerary.days.flatMap((d) =>
        d.items.flatMap((i) => (i.placeId ? [i.placeId] : [])),
      ),
      ...itinerary.unscheduled.map((u) => u.placeId),
      placeId,
    ];
    const avoid = PARTY_RULES[itinerary.input.travelParty].avoidCategories;
    const rows = (await this.db.query(
      `SELECT p.id, p.name, p.category, p.description,
              ST_Distance(p.location::geography, t.location::geography) / 1000 AS km
         FROM places t
         JOIN places p ON p.category = t.category
          AND ST_DWithin(p.location::geography, t.location::geography, $3)
        WHERE t.id = $1
          AND p.id <> ALL($2::uuid[])
          AND NOT (p.category = ANY($4::place_category[]))
        ORDER BY p.composite_score DESC, km
        LIMIT $5`,
      [placeId, used, ALTERNATIVES_RADIUS_M, avoid, ALTERNATIVES],
    )) as Array<{
      id: string;
      name: string;
      category: PlaceCategory;
      description: string | null;
      km: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      description: r.description,
      distanceKm: Math.round(Number(r.km) * 10) / 10,
    }));
  }

  async remove(userId: string, id: string): Promise<void> {
    const { itinerary } = await this.authorize(userId, id, 'delete');
    const region = await this.regionName(itinerary.regionId);
    await this.db.transaction(async (m) => {
      await this.logToGroup(m, itinerary, userId, 'itinerary_removed', region);
      await m.delete(Itinerary, { id: itinerary.id });
    });
  }

  /** Chỉ người tạo; nhóm đích phải là nơi mình là owner hoặc editor. */
  async move(
    userId: string,
    id: string,
    groupId: string | null,
  ): Promise<ItineraryResponse> {
    const { itinerary, access } = await this.authorize(userId, id, 'move');
    if (itinerary.groupId === groupId) return this.respond(itinerary, access);
    if (groupId) await this.access.requireGroupRole(userId, groupId, 'editor');
    const region = await this.regionName(itinerary.regionId);
    const before = { ...itinerary };
    itinerary.groupId = groupId;
    const saved = await this.db.transaction(async (m) => {
      await this.logToGroup(m, before, userId, 'itinerary_removed', region);
      const it = await m.save(itinerary);
      await this.logToGroup(m, it, userId, 'itinerary_added', region);
      return it;
    });
    return this.respond(saved, access);
  }

  /**
   * Kiểm tra quyền theo bảng ở spec S8 mục 4.6. Không xem được thì 404 như
   * không tồn tại, để không lộ id hợp lệ; xem được mà thiếu quyền thì 403.
   */
  async authorize(
    userId: string,
    id: string,
    action: ItineraryAction,
  ): Promise<{ itinerary: Itinerary; access: ItineraryAccess }> {
    const access = await this.access.itineraryAccess(userId, id);
    const decision = access ? decide(access, action) : 'not_found';
    if (decision === 'not_found') throw itineraryNotFound();
    if (decision === 'forbidden') throw forbiddenRole();
    const itinerary = await this.itineraries.findOneBy({ id });
    if (!itinerary) throw itineraryNotFound();
    return { itinerary, access: access! };
  }

  private async respond(
    it: Itinerary,
    access: ItineraryAccess,
  ): Promise<ItineraryResponse> {
    let groupName: string | null = null;
    if (it.groupId) {
      const [row] = (await this.db.query(
        `SELECT name FROM groups WHERE id = $1`,
        [it.groupId],
      )) as Array<{ name: string }>;
      groupName = row?.name ?? null;
    }
    return toResponse(
      it,
      groupName,
      access.isCreator ? 'creator' : access.groupRole!,
    );
  }

  private async logToGroup(
    m: EntityManager,
    it: Pick<Itinerary, 'id' | 'groupId'>,
    actorId: string,
    type: 'itinerary_added' | 'itinerary_updated' | 'itinerary_removed',
    regionName: string,
  ): Promise<void> {
    if (!it.groupId) return;
    await this.activity.record(m, it.groupId, actorId, type, {
      itineraryId: it.id,
      regionName,
    });
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

/** Khung giờ của một ngày đã lưu, để tính lại giờ khi sửa. */
function windowOf(day: ItineraryDay, index: number): DayWindow {
  const [y, m, d] = day.date.split('-').map(Number);
  return {
    index,
    date: day.date,
    weekday: (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7,
    start: toVietnamLocal(day.startsAt).minute,
    end: toVietnamLocal(day.endsAt).minute,
    isFirst: index === 0,
    isLast: false,
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

function toResponse(
  it: Itinerary,
  groupName: string | null,
  myRole: ItineraryRole,
): ItineraryResponse {
  return {
    id: it.id,
    ownerId: it.ownerId,
    groupId: it.groupId,
    groupName,
    myRole,
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
