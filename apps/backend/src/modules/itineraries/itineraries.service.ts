import { Injectable, ServiceUnavailableException } from '@nestjs/common';
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
} from '@rong/shared-types';
import { DataSource, Repository, type EntityManager } from 'typeorm';

import {
  decide,
  type ItineraryAccess,
  type ItineraryAction,
} from '../groups/access.js';
import { AccessService } from '../groups/access.service.js';
import { ActivityService } from '../groups/activity.service.js';
import { forbiddenRole, itineraryNotFound } from '../groups/errors.js';
import { PlaceLocationService } from '../places/place-location.service.js';
import type { CreateItineraryDto } from './dto/create-itinerary.dto.js';
import type { UpdateItineraryDto } from './dto/update-itinerary.dto.js';
import { Itinerary } from './entities/itinerary.entity.js';
import { bad } from './errors.js';
import { ItineraryPlanner } from './itinerary-planner.js';
import { withItineraryPlaceData } from './itinerary-place-data.js';
import { itinerarySummaries } from './itinerary-summaries.js';
import { toVietnamLocal, type DayWindow } from './planning/days.js';
import { PARTY_RULES } from './planning/rules.js';
import { retimeDay } from './planning/retime.js';

/** "Đổi điểm tương tự" (FR-8.3): số gợi ý và bán kính tìm quanh điểm đang thay. */
const ALTERNATIVES = 3;
const ALTERNATIVES_RADIUS_M = 5000;

@Injectable()
export class ItinerariesService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @InjectRepository(Itinerary)
    private readonly itineraries: Repository<Itinerary>,
    private readonly planner: ItineraryPlanner,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
    private readonly locations: PlaceLocationService,
  ) {}

  async create(
    ownerId: string,
    dto: CreateItineraryDto,
  ): Promise<ItineraryResponse> {
    const input = normalize(dto);

    // FR-6.8: lịch trình tạo trong nhóm thuộc nhóm đó; viewer không tạo được.
    const groupId = dto.groupId ?? null;
    if (groupId) await this.access.requireGroupRole(ownerId, groupId, 'editor');

    const plan = await this.planner.planTrip(input);

    const saved = await this.db.transaction(async (m) => {
      const it = await m.save(
        this.itineraries.create({
          ownerId,
          regionId: input.regionId,
          groupId,
          planner: plan.planner,
          startsAt: new Date(Date.parse(input.startsAt)),
          endsAt: new Date(Date.parse(input.endsAt)),
          input,
          days: plan.days,
          unscheduled: plan.unscheduled,
          warnings: plan.warnings,
          tips: plan.tips,
        }),
      );
      await this.logToGroup(m, it, ownerId, 'itinerary_added', plan.regionName);
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
    const toLocate = input.accommodationPlaceId
      ? [...new Set([...placeIds, input.accommodationPlaceId])]
      : placeIds;
    if ((await this.locations.ensure(toLocate)).length > 0) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'PLACE_LOCATION_UNAVAILABLE',
        message:
          'Tạm thời không lấy được vị trí của một địa điểm. Hãy thử lưu lại sau.',
      });
    }
    const found = await this.planner.loadPlaces(placeIds, true);
    const missing = placeIds.filter((pid) => !found.some((c) => c.id === pid));
    if (missing.length > 0) {
      throw bad('UNKNOWN_PLACES', 'Có địa điểm không tồn tại trong danh mục.', {
        placeIds: missing,
      });
    }
    const places = new Map(found.map((c) => [c.id, c]));
    const [accommodation] = input.accommodationPlaceId
      ? await this.planner.loadPlaces([input.accommodationPlaceId], false)
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
    const region = await this.planner.regionName(itinerary.regionId);
    const saved = await this.db.transaction(async (m) => {
      const it = await m.save(itinerary);
      await this.logToGroup(m, it, ownerId, 'itinerary_updated', region);
      return it;
    });
    return this.respond(saved, access);
  }

  /**
   * "Đổi điểm tương tự" (FR-8.3): điểm cùng loại quanh điểm đang thay, trong
   * danh sách của vùng, chưa có trong lịch trình, thứ hạng cao trước.
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
         JOIN itineraries it ON it.id = $6
         JOIN region_places rp ON rp.region_id = it.region_id
         JOIN places p ON p.id = rp.place_id AND p.category = t.category
          AND p.location IS NOT NULL
          AND ST_DWithin(p.location::geography, t.location::geography, $3)
        WHERE t.id = $1
          AND p.id <> ALL($2::uuid[])
          AND NOT (p.category = ANY($4::place_category[]))
        ORDER BY rp.rank, km
        LIMIT $5`,
      [placeId, used, ALTERNATIVES_RADIUS_M, avoid, ALTERNATIVES, id],
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
    const region = await this.planner.regionName(itinerary.regionId);
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
    const region = await this.planner.regionName(itinerary.regionId);
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
      await withItineraryPlaceData(this.db, it.days),
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

function toResponse(
  it: Itinerary,
  days: ItineraryDay[],
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
    days,
    unscheduled: it.unscheduled,
    warnings: it.warnings,
    planner: it.planner,
    tips: it.tips,
    aiEditsRemaining: it.aiEditsRemaining,
    createdAt: it.createdAt.toISOString(),
    updatedAt: it.updatedAt.toISOString(),
  };
}
