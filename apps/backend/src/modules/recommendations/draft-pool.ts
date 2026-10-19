import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  BudgetTier,
  ItineraryDay,
  ItineraryInput,
  ItineraryWarning,
  Pace,
  PlaceCategory,
  TravelParty,
  TripParams,
  UnscheduledPlace,
} from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { ItineraryPlanner } from '../itineraries/itinerary-planner.js';
import { poolKey } from './pool-key.js';
import { draftInput } from './trip-params.js';

export interface DraftRow {
  id: string;
  regionId: string;
  poolKey: string;
  listVersion: Date;
  categories: PlaceCategory[];
  daysCount: number;
  travelParty: TravelParty;
  pace: Pace;
  budgetTier: BudgetTier;
  input: ItineraryInput;
  days: ItineraryDay[];
  unscheduled: UnscheduledPlace[];
  warnings: ItineraryWarning[];
  tips: string[];
  placeIds: string[];
  excludePlaceIds: string[];
  planner: 'heuristic' | 'ai';
  viewCount: number;
  saveCount: number;
  upgradedAt: Date | null;
}

export const DRAFT_SELECT = `
  SELECT d.id, d.region_id, d.pool_key, d.list_version, d.categories::text[] AS categories,
         d.days_count, d.travel_party, d.pace, d.budget_tier, d.input, d.days, d.unscheduled,
         d.warnings, d.tips, d.place_ids, d.exclude_place_ids, d.planner, d.view_count,
         d.save_count, d.upgraded_at
    FROM itinerary_drafts d`;

export function toDraft(r: Record<string, unknown>): DraftRow {
  return {
    id: r.id as string,
    regionId: r.region_id as string,
    poolKey: r.pool_key as string,
    listVersion: r.list_version as Date,
    categories: r.categories as PlaceCategory[],
    daysCount: Number(r.days_count),
    travelParty: r.travel_party as TravelParty,
    pace: r.pace as Pace,
    budgetTier: r.budget_tier as BudgetTier,
    input: r.input as ItineraryInput,
    days: r.days as ItineraryDay[],
    unscheduled: r.unscheduled as UnscheduledPlace[],
    warnings: r.warnings as ItineraryWarning[],
    tips: r.tips as string[],
    placeIds: r.place_ids as string[],
    excludePlaceIds: r.exclude_place_ids as string[],
    planner: r.planner as 'heuristic' | 'ai',
    viewCount: Number(r.view_count),
    saveCount: Number(r.save_count),
    upgradedAt: (r.upgraded_at as Date | null) ?? null,
  };
}

/** Mọi placeId trong các ngày của lịch. */
export function placeIdsOf(days: ItineraryDay[]): string[] {
  return [
    ...new Set(
      days.flatMap((d) => d.items.flatMap((i) => (i.placeId ? [i.placeId] : []))),
    ),
  ];
}

/**
 * Kho bản nháp dùng chung (`itinerary_drafts`). Một `pool_key` có thể có nhiều
 * biến thể; chọn bản không chứa nơi người dùng đã đi, ưu tiên bản họ chưa thấy.
 */
@Injectable()
export class DraftPool {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly planner: ItineraryPlanner,
  ) {}

  async findOrCreate(p: {
    regionId: string;
    categories: PlaceCategory[];
    trip: TripParams;
    listVersion: Date;
    excludePlaceIds: string[];
    userId: string;
  }): Promise<DraftRow> {
    const key = poolKey(p);
    const [found] = (await this.db.query(
      `${DRAFT_SELECT}
        WHERE d.pool_key = $1
          AND NOT (d.place_ids && $2::uuid[])
        ORDER BY EXISTS (
                   SELECT 1 FROM user_recommendations ur
                    WHERE ur.user_id = $3 AND ur.draft_id = d.id
                 ) ASC,
                 (d.planner = 'ai') DESC,
                 d.created_at DESC
        LIMIT 1`,
      [key, p.excludePlaceIds, p.userId],
    )) as Array<Record<string, unknown>>;
    if (found) return toDraft(found);

    const input = draftInput(p.regionId, p.categories, p.trip);
    const plan = await this.planner.planTrip(input, {
      excludePlaceIds: p.excludePlaceIds,
      forceHeuristic: true,
    });
    const [row] = (await this.db.query(
      `INSERT INTO itinerary_drafts
         (region_id, pool_key, list_version, categories, days_count, travel_party, pace,
          budget_tier, input, days, unscheduled, warnings, tips, place_ids,
          exclude_place_ids, planner)
       VALUES ($1, $2, $3, $4::place_category[], $5::int, $6, $7, $8, $9::jsonb, $10::jsonb,
               $11::jsonb, $12::jsonb, $13::jsonb, $14::uuid[], $15::uuid[], $16)
       RETURNING id`,
      [
        p.regionId,
        key,
        p.listVersion,
        [...new Set(p.categories)],
        p.trip.daysCount,
        p.trip.travelParty,
        p.trip.pace,
        p.trip.budgetTier,
        JSON.stringify(input),
        JSON.stringify(plan.days),
        JSON.stringify(plan.unscheduled),
        JSON.stringify(plan.warnings),
        JSON.stringify(plan.tips),
        placeIdsOf(plan.days),
        p.excludePlaceIds,
        plan.planner === 'ai' ? 'ai' : 'heuristic',
      ],
    )) as Array<{ id: string }>;
    return (await this.get(row.id))!;
  }

  async get(id: string): Promise<DraftRow | null> {
    const [row] = (await this.db.query(`${DRAFT_SELECT} WHERE d.id = $1`, [
      id,
    ])) as Array<Record<string, unknown>>;
    return row ? toDraft(row) : null;
  }

  /** `fetched_at` của danh sách `ready`; null khi vùng chưa có danh sách dùng được. */
  async listVersion(regionId: string): Promise<Date | null> {
    const [row] = (await this.db.query(
      `SELECT fetched_at FROM region_place_lists WHERE region_id = $1 AND status = 'ready'`,
      [regionId],
    )) as Array<{ fetched_at: Date | null }>;
    return row?.fetched_at ?? null;
  }
}
