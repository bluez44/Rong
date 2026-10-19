import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  Itinerary,
  ItineraryDay,
  ItineraryDraft,
  PreviewDraftRequest,
  RecommendationCard,
  RecommendationFeed,
  RegionImage,
  SaveDraftRequest,
  TripParams,
} from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { ItinerariesService } from '../itineraries/itineraries.service.js';
import { withItineraryPlaceData } from '../itineraries/itinerary-place-data.js';
import { VisitsService } from '../visits/visits.service.js';
import { cardTitle, reasonText, type RecommendationReason } from './copy.js';
import { shiftPlan, tripBounds, vietnamDate } from './draft-dates.js';
import { DraftPool } from './draft-pool.js';
import { jobIdOf } from './queue/jobs.js';
import { RecommendationsQueue } from './queue/recommendations-queue.js';
import { draftCategories, RecommendationBuilder } from './recommendation-builder.js';
import { DEFAULT_THEME_KEY, ThemeCatalog, unknownTheme, type ResolvedTheme } from './theme-catalog.js';
import { windowFor } from './window.js';

const VIEW_UPGRADE_THRESHOLD = 5;
const SAVE_UPGRADE_THRESHOLD = 2;

interface RecRow {
  id: string;
  user_id: string;
  region_id: string;
  region_name: string;
  theme_key: string;
  draft_id: string;
  starts_at: Date;
  params: TripParams;
  reason: RecommendationReason;
  saved_itinerary_id: string | null;
}

const REC_SELECT = `
  SELECT ur.id, ur.user_id, ur.region_id, r.name AS region_name, ur.theme_key, ur.draft_id,
         ur.starts_at, ur.params, ur.reason, ur.saved_itinerary_id
    FROM user_recommendations ur
    JOIN regions r ON r.id = ur.region_id`;

const notFound = () =>
  new NotFoundException({
    statusCode: 404,
    code: 'RECOMMENDATION_NOT_FOUND',
    message: 'Gợi ý này không còn nữa.',
  });

@Injectable()
export class RecommendationsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly themes: ThemeCatalog,
    private readonly builder: RecommendationBuilder,
    private readonly pool: DraftPool,
    private readonly queue: RecommendationsQueue,
    private readonly itineraries: ItinerariesService,
    private readonly visits: VisitsService,
  ) {}

  async feed(userId: string, themeKey = DEFAULT_THEME_KEY, retry = false): Promise<RecommendationFeed> {
    await this.db.query(
      `UPDATE users SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '1 hour'`,
      [userId],
    );
    const { windowStart, nextRefreshAt } = windowFor(new Date());
    const interests = await this.builder.interests(userId);
    const themes = await this.themes.list(userId, interests);
    const theme = themes.find((t) => t.key === themeKey);
    if (!theme) throw unknownTheme();

    const base = {
      windowStart: windowStart.toISOString(),
      nextRefreshAt: nextRefreshAt.toISOString(),
      theme: themeKey,
      themes: themes.map(({ key, label, icon, regionHint, kind }) => ({ key, label, icon, regionHint, kind })),
    };

    const items = await this.cards(userId, windowStart, theme);
    if (items.length > 0) return { ...base, status: 'ready', items };

    const job = {
      name: 'build-user-set' as const,
      data: { userId, windowStart: windowStart.toISOString(), themeKey },
    };
    const jobId = jobIdOf(job)!;
    const state = await this.queue.state(jobId);
    if (state === 'completed' && !retry) return { ...base, status: 'ready', items: [] };
    if (state === 'failed' || (retry && state === 'completed')) await this.queue.remove(jobId);
    if (state !== 'waiting' && state !== 'active') await this.queue.enqueue(job, { priority: 1 });
    return { ...base, status: 'building', items: [] };
  }

  async draft(userId: string, id: string): Promise<ItineraryDraft> {
    const rec = await this.own(userId, id);
    // TypeORM trả DELETE/UPDATE dạng [rows, rowCount], khác INSERT/SELECT.
    const [first] = (await this.db.query(
      `UPDATE user_recommendations SET viewed_at = now() WHERE id = $1 AND viewed_at IS NULL RETURNING id`,
      [id],
    )) as [unknown[], number];
    if (first.length > 0) {
      await this.db.query(`UPDATE itinerary_drafts SET view_count = view_count + 1 WHERE id = $1`, [rec.draft_id]);
      await this.maybeUpgrade(rec.draft_id);
    }
    return this.view(rec);
  }

  async preview(userId: string, id: string, req: PreviewDraftRequest): Promise<ItineraryDraft> {
    const rec = await this.own(userId, id);
    if (req.startDate < vietnamDate(new Date())) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'INVALID_DATES',
        message: 'Ngày đi phải từ hôm nay trở đi.',
      });
    }
    const current = (await this.pool.get(rec.draft_id))!;
    const trip: TripParams = {
      travelParty: req.travelParty,
      adults: req.adults,
      children: req.children,
      pace: req.pace,
      budgetTier: req.budgetTier,
      daysCount: req.daysCount,
    };
    const startsAt = tripBounds(req.startDate, trip.daysCount).startsAt;
    const same =
      current.daysCount === trip.daysCount &&
      current.travelParty === trip.travelParty &&
      current.pace === trip.pace &&
      current.budgetTier === trip.budgetTier;

    let draftId = current.id;
    if (!same) {
      const listVersion = (await this.pool.listVersion(current.regionId)) ?? current.listVersion;
      const next = await this.pool.findOrCreate({
        regionId: current.regionId,
        categories: current.categories,
        trip,
        listVersion,
        excludePlaceIds: await this.visits.visitedPlaceIds(userId),
        userId,
      });
      draftId = next.id;
    }
    await this.db.query(
      `UPDATE user_recommendations SET draft_id = $2, starts_at = $3, params = $4::jsonb WHERE id = $1`,
      [id, draftId, startsAt, JSON.stringify(trip)],
    );
    return this.view(await this.own(userId, id));
  }

  async save(userId: string, id: string, req: SaveDraftRequest): Promise<{ itinerary: Itinerary; created: boolean }> {
    const rec = await this.own(userId, id);
    if (rec.draft_id !== req.draftId) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'DRAFT_NOT_FOUND',
        message: 'Bản nháp đã thay đổi. Tải lại rồi thử lại.',
      });
    }
    if (rec.saved_itinerary_id) {
      return { itinerary: await this.itineraries.get(userId, rec.saved_itinerary_id), created: false };
    }
    const view = await this.view(rec);
    const itinerary = await this.itineraries.createFromPlan(userId, {
      input: view.input,
      days: view.days,
      unscheduled: view.unscheduled,
      warnings: view.warnings,
      tips: view.tips,
      planner: view.planner,
      groupId: req.groupId ?? null,
    });
    await this.db.query(`UPDATE user_recommendations SET saved_itinerary_id = $2 WHERE id = $1`, [id, itinerary.id]);
    await this.db.query(`UPDATE itinerary_drafts SET save_count = save_count + 1 WHERE id = $1`, [rec.draft_id]);
    await this.maybeUpgrade(rec.draft_id);
    return { itinerary, created: true };
  }

  async maybeUpgrade(draftId: string): Promise<void> {
    const [row] = (await this.db.query(
      `SELECT 1 FROM itinerary_drafts
        WHERE id = $1 AND planner = 'heuristic' AND upgraded_at IS NULL
          AND (view_count >= $2::int OR save_count >= $3::int)`,
      [draftId, VIEW_UPGRADE_THRESHOLD, SAVE_UPGRADE_THRESHOLD],
    )) as unknown[];
    if (row) await this.queue.enqueue({ name: 'upgrade-draft', data: { draftId } });
  }

  private async own(userId: string, id: string): Promise<RecRow> {
    const [row] = (await this.db.query(`${REC_SELECT} WHERE ur.id = $1 AND ur.user_id = $2`, [id, userId])) as RecRow[];
    if (!row) throw notFound();
    return row;
  }

  private async view(rec: RecRow): Promise<ItineraryDraft> {
    const draft = (await this.pool.get(rec.draft_id))!;
    const startDate = vietnamDate(rec.starts_at);
    const shifted = shiftPlan(
      { input: { ...draft.input, adults: rec.params.adults, children: rec.params.children }, days: draft.days },
      startDate,
    );
    return {
      recommendationId: rec.id,
      draftId: draft.id,
      regionId: rec.region_id,
      regionName: rec.region_name,
      params: rec.params,
      input: shifted.input,
      days: await withItineraryPlaceData(this.db, shifted.days),
      unscheduled: draft.unscheduled,
      warnings: draft.warnings,
      tips: draft.tips,
      planner: draft.planner,
      savedItineraryId: rec.saved_itinerary_id,
    };
  }

  private async cards(userId: string, windowStart: Date, theme: ResolvedTheme): Promise<RecommendationCard[]> {
    const rows = (await this.db.query(
      `SELECT ur.id, ur.region_id, r.name AS region_name, ur.starts_at, ur.reason, ur.saved_itinerary_id,
              d.days_count, d.days,
              ri.status AS image_status, ri.blocked, ri.url, ri.source, ri.author, ri.author_url, ri.source_url
         FROM user_recommendations ur
         JOIN itinerary_drafts d ON d.id = ur.draft_id
         JOIN regions r ON r.id = ur.region_id
         LEFT JOIN region_images ri ON ri.region_id = ur.region_id
        WHERE ur.user_id = $1 AND ur.window_start = $2 AND ur.theme_key = $3
        ORDER BY ur.slot`,
      [userId, windowStart, theme.key],
    )) as Array<{
      id: string;
      region_id: string;
      region_name: string;
      starts_at: Date;
      reason: RecommendationReason;
      saved_itinerary_id: string | null;
      days_count: number;
      days: ItineraryDay[];
      image_status: 'found' | 'none' | null;
      blocked: boolean | null;
      url: string | null;
      source: 'unsplash' | 'web' | null;
      author: string | null;
      author_url: string | null;
      source_url: string | null;
    }>;
    return rows.map((r) => {
      const visits = r.days.flatMap((d) => d.items).filter((i) => i.kind === 'visit' && i.place);
      const { endsAt } = tripBounds(vietnamDate(r.starts_at), Number(r.days_count));
      const image: RegionImage | null =
        r.image_status === 'found' && !r.blocked && r.url && r.source
          ? { url: r.url, source: r.source, author: r.author, authorUrl: r.author_url, sourceUrl: r.source_url }
          : null;
      return {
        id: r.id,
        regionId: r.region_id,
        regionName: r.region_name,
        title: cardTitle(r.region_name, theme.kind === 'default' ? null : theme.label, draftCategories({ days: r.days })),
        dayCount: Number(r.days_count),
        nightCount: Number(r.days_count) - 1,
        startsAt: r.starts_at.toISOString(),
        endsAt: new Date(Date.parse(endsAt)).toISOString(),
        placeCount: new Set(visits.map((i) => i.placeId)).size,
        highlights: [...new Set(visits.map((i) => i.place!.name))].slice(0, 3),
        reason: reasonText(r.reason),
        revisit: r.reason.revisit,
        image,
        estimatedCost: null,
        weather: null,
        savedItineraryId: r.saved_itinerary_id,
      };
    });
  }
}
