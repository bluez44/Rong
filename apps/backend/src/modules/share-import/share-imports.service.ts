import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type {
  SaveShareImportResponse,
  ShareImport,
  ShareImportCandidate,
  ShareImportErrorCode,
  ShareImportOption,
  ShareImportSummary,
  SharePlatform,
} from '@rong/shared-types';
import { DataSource } from 'typeorm';

import type { ShareImportConfig } from '../../config/configuration.js';
import { GooglePlacesService } from '../google/google-places.service.js';
import {
  CATALOG_MIN_SIMILARITY,
  matchCatalog,
} from '../places/catalog-match.js';
import { GOOGLE_LOCATION_TTL_DAYS } from '../places/place-location.service.js';
import { SavedPlacesService } from '../saved-places/saved-places.service.js';
import type { CreateShareImportDto } from './dto/create-share-import.dto.js';
import type { SaveShareImportDto } from './dto/save-share-import.dto.js';
import {
  LinkMetadataService,
  UnsafeUrlError,
  type LinkMetadata,
} from './link-metadata.service.js';
import {
  buildExtractionInput,
  extractPlaces,
  PLACE_EXTRACTOR,
  type ExtractFn,
} from './place-extraction.js';
import {
  resolvePlaces,
  type StoredCandidate,
  type StoredOption,
} from './place-resolver.js';
import { RegionLookupService } from './region-lookup.service.js';
import {
  CANDIDATES_TTL_DAYS,
  INTERRUPTED_AFTER_MS,
  JOB_TIMEOUT_MS,
  LIST_DAYS,
  LIST_LIMIT,
  SHARE_IMPORT_CONFIG,
} from './share-import.constants.js';
import { detectPlatform, normalizeShareInput } from './share-url.js';

/** Không có vùng gợi ý thì khớp toàn quốc, nên đòi tên giống hơn. */
const NATIONWIDE_MIN_SIMILARITY = CATALOG_MIN_SIMILARITY + 0.15;
const SUMMARY_TIMEOUT_MS = 3000;
const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;
/** Dọn lần đầu ngay sau khi khởi động: deploy thường xuyên thì chu kỳ 6 giờ có thể không bao giờ tới. */
const SWEEP_FIRST_RUN_MS = 60 * 1000;
/** Bắt cả job bị bỏ dở do tiến trình chết đột ngột (không qua onModuleDestroy). */
const RECOVER_EVERY_MS = 60 * 1000;

interface JobRow {
  id: string;
  user_id: string;
  url: string | null;
  shared_text: string | null;
  status: ShareImport['status'];
  platform: SharePlatform | null;
  metadata: Pick<LinkMetadata, 'title' | 'authorName' | 'thumbnailUrl'> | null;
  candidates: StoredCandidate[];
  error_code: ShareImportErrorCode | null;
  created_at: Date;
  saved_count: number;
}

class JobError extends Error {
  constructor(readonly code: ShareImportErrorCode) {
    super(code);
  }
}

/** Server đang tắt: dừng job; onModuleDestroy tự đánh nó `INTERRUPTED`. */
class ShutdownError extends Error {}

/**
 * Chia sẻ vào app (F4): nhận link/văn bản, nhận diện địa điểm ở nền, cho
 * người dùng chọn rồi lưu vào "Muốn đi". Job nằm trong bảng `share_imports`
 * nên thoát app vẫn xem lại được.
 */
@Injectable()
export class ShareImportsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ShareImportsService.name);
  private readonly timers: NodeJS.Timeout[] = [];
  /** Job đang chạy trong tiến trình này → hàm hủy, dùng khi server tắt. */
  private readonly running = new Map<string, (error: Error) => void>();

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly metadata: LinkMetadataService,
    @Inject(PLACE_EXTRACTOR) private readonly extract: ExtractFn,
    private readonly google: GooglePlacesService,
    private readonly regions: RegionLookupService,
    private readonly saved: SavedPlacesService,
    @Inject(SHARE_IMPORT_CONFIG) private readonly config: ShareImportConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.recoverInterrupted();
    const sweep = () =>
      void this.sweepOldCandidates().catch((e: Error) =>
        this.logger.warn(`Dọn ứng viên share lỗi: ${e.message}`),
      );
    const recover = () =>
      void this.recoverInterrupted().catch((e: Error) =>
        this.logger.warn(`Thu hồi job share lỗi: ${e.message}`),
      );
    this.timers.push(
      setTimeout(sweep, SWEEP_FIRST_RUN_MS).unref(),
      setInterval(sweep, SWEEP_EVERY_MS).unref(),
      setInterval(recover, RECOVER_EVERY_MS).unref(),
    );
  }

  /** Chạy trước khi TypeORM đóng kết nối: job đang dở được đánh `INTERRUPTED` để client thôi chờ. */
  async onModuleDestroy(): Promise<void> {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.length = 0;
    const ids = [...this.running.keys()];
    for (const cancel of this.running.values()) cancel(new ShutdownError());
    this.running.clear();
    if (ids.length === 0) return;
    await this.db
      .query(
        `UPDATE share_imports SET status = 'failed', error_code = 'INTERRUPTED', finished_at = now()
          WHERE id = ANY($1::uuid[]) AND status = 'pending'`,
        [ids],
      )
      .catch((e: Error) =>
        this.logger.error(
          `Không đánh dấu được job share bị dừng: ${e.message}`,
        ),
      );
  }

  /** Job `pending` từ lần chạy trước (server khởi động lại giữa chừng) không bao giờ xong nữa. */
  async recoverInterrupted(): Promise<void> {
    await this.db.query(
      `UPDATE share_imports SET status = 'failed', error_code = 'INTERRUPTED', finished_at = now()
        WHERE status = 'pending' AND created_at < now() - make_interval(secs => $1::float8)`,
      [INTERRUPTED_AFTER_MS / 1000],
    );
  }

  /** Ứng viên chứa tọa độ Google: xóa sau 30 ngày; thẻ nguồn giữ lại. */
  async sweepOldCandidates(): Promise<void> {
    await this.db.query(
      `UPDATE share_imports SET candidates = '[]'
        WHERE candidates <> '[]' AND created_at < now() - make_interval(days => $1::int)`,
      [CANDIDATES_TTL_DAYS],
    );
  }

  async create(
    userId: string,
    dto: CreateShareImportDto,
  ): Promise<{ id: string }> {
    const input = normalizeShareInput(dto);
    if (!input || (dto.url?.trim() && !input.url)) {
      throw bad(
        'INVALID_SHARE_URL',
        'Link không hợp lệ. Hãy chia sẻ một link http(s) hoặc dán mô tả.',
      );
    }
    if (input.url) {
      try {
        await this.metadata.assertSafe(input.url);
      } catch (error) {
        if (error instanceof UnsafeUrlError) {
          throw bad('INVALID_SHARE_URL', 'Không đọc được link này.');
        }
        throw error;
      }
    }
    const [{ n }] = (await this.db.query(
      `SELECT count(*)::int AS n FROM share_imports
        WHERE user_id = $1 AND created_at > now() - interval '24 hours'`,
      [userId],
    )) as Array<{ n: number }>;
    if (n >= this.config.dailyLimit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'SHARE_IMPORT_LIMIT',
          message: `Mỗi ngày nhận diện tối đa ${this.config.dailyLimit} lượt chia sẻ. Thử lại sau nhé.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const [{ id }] = (await this.db.query(
      `INSERT INTO share_imports (user_id, url, shared_text, platform)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        userId,
        input.url?.toString() ?? null,
        input.text,
        input.url ? detectPlatform(input.url) : 'web',
      ],
    )) as Array<{ id: string }>;
    void this.run(id, input.url, input.text);
    return { id };
  }

  async list(userId: string): Promise<ShareImportSummary[]> {
    const rows = await this.rows(
      `WHERE si.user_id = $1 AND si.created_at > now() - make_interval(days => $2::int)
       ORDER BY si.created_at DESC LIMIT $3`,
      [userId, LIST_DAYS, LIST_LIMIT],
    );
    return rows.map(toSummary);
  }

  async get(userId: string, id: string): Promise<ShareImport> {
    const row = await this.findOwned(userId, id);
    return {
      ...toSummary(row),
      errorCode: row.error_code,
      candidates: await this.present(row.candidates),
    };
  }

  async save(
    userId: string,
    id: string,
    dto: SaveShareImportDto,
  ): Promise<SaveShareImportResponse> {
    const row = await this.findOwned(userId, id);
    // Trước khi tra ứng viên: job cũ đã bị dọn ứng viên vẫn báo đúng là hết hạn.
    if (
      dto.selections.some((selection) => selection.kind === 'google') &&
      Date.now() - row.created_at.getTime() >
        CANDIDATES_TTL_DAYS * 24 * 60 * 60 * 1000
    ) {
      throw bad(
        'SHARE_IMPORT_EXPIRED',
        'Kết quả nhận diện đã quá cũ. Hãy chia sẻ lại link.',
      );
    }
    if (row.status !== 'done') {
      throw new ConflictException({
        statusCode: 409,
        code: 'SHARE_IMPORT_NOT_READY',
        message: 'Chưa nhận diện xong. Chờ một chút rồi lưu.',
      });
    }
    const chosen = dto.selections.map((selection) => {
      const candidate = row.candidates.find(
        (c) => c.key === selection.candidateKey,
      );
      const option = candidate?.options.find((o) =>
        o.kind === 'catalog'
          ? selection.kind === 'catalog' && o.placeId === selection.placeId
          : selection.kind === 'google' &&
            o.googlePlaceId === selection.googlePlaceId,
      );
      if (!candidate || !option) {
        throw bad(
          'INVALID_SELECTION',
          'Lựa chọn không nằm trong kết quả nhận diện.',
        );
      }
      return { candidate, option };
    });

    await this.db.transaction(async (m) => {
      for (const { candidate, option } of chosen) {
        const placeId =
          option.kind === 'catalog'
            ? option.placeId
            : await upsertGooglePlace(m, candidate, option, row.created_at);
        await this.saved.save(
          userId,
          placeId,
          option.regionId,
          {
            source: 'share',
            shareImportId: id,
            // Dòng Google dùng chung theo place_id: tên trong places là của người chia sẻ đầu tiên.
            displayName: option.kind === 'google' ? candidate.name : null,
          },
          m,
        );
      }
    });
    return { saved: chosen.length };
  }

  private async run(
    id: string,
    url: URL | null,
    text: string | null,
  ): Promise<void> {
    const started = Date.now();
    const timing: string[] = [];
    let timer: NodeJS.Timeout | undefined;
    let cancel: ((error: Error) => void) | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new JobError('TIMEOUT')),
          JOB_TIMEOUT_MS,
        );
        cancel = reject;
        this.running.set(id, reject);
      });
      const work = (async () => {
        let meta: LinkMetadata | null = null;
        if (url) {
          meta = await this.metadata.fetch(url).catch(() => null);
          timing.push(`metadata ${Date.now() - started} ms`);
          await this.db.query(
            `UPDATE share_imports SET platform = COALESCE($2, platform), url = COALESCE($3, url), metadata = $4::jsonb
              WHERE id = $1`,
            [
              id,
              meta?.platform ?? null,
              meta?.finalUrl ?? null,
              meta
                ? JSON.stringify({
                    title: meta.title,
                    authorName: meta.authorName,
                    thumbnailUrl: meta.thumbnailUrl,
                  })
                : null,
            ],
          );
        }
        const input = buildExtractionInput(meta, text);
        if (!input) throw new JobError('METADATA_UNAVAILABLE');

        let places;
        try {
          places = await extractPlaces(input, this.extract);
        } catch (error) {
          this.logger.warn(
            `Gemini lỗi cho share ${id}: ${(error as Error).message}`,
          );
          throw new JobError('AI_UNAVAILABLE');
        }
        timing.push(`gemini ${places.length} tên ${Date.now() - started} ms`);

        return resolvePlaces(places, {
          findRegion: (hint) => this.regions.findByHint(hint),
          matchCatalog: async (name, bbox) => {
            const [match] = await matchCatalog(
              this.db,
              [name],
              bbox,
              bbox ? CATALOG_MIN_SIMILARITY : NATIONWIDE_MIN_SIMILARITY,
            );
            return match
              ? {
                  placeId: match.id,
                  lat: Number(match.lat),
                  lng: Number(match.lng),
                }
              : null;
          },
          searchGoogle: (query, bbox) =>
            this.google.enabled
              ? this.google.searchText(query, bbox)
              : Promise.resolve([]),
          assignRegions: (points) => this.regions.assign(points),
          warn: (message) => this.logger.warn(`Share ${id}: ${message}`),
        });
      })();
      // Công việc bị bỏ dở (hết giờ, server tắt) vẫn có thể lỗi về sau: nuốt để không thành unhandled rejection.
      work.catch(() => undefined);
      const candidates = await Promise.race([work, timeout]);
      timing.push(`khớp ${Date.now() - started} ms`);
      await this.db.query(
        `UPDATE share_imports SET status = 'done', candidates = $2::jsonb, finished_at = now()
          WHERE id = $1 AND status = 'pending'`,
        [id, JSON.stringify(candidates)],
      );
    } catch (error) {
      if (error instanceof ShutdownError) return;
      const code = error instanceof JobError ? error.code : 'AI_UNAVAILABLE';
      if (!(error instanceof JobError)) {
        this.logger.error(`Share ${id} lỗi không mong muốn`, error as Error);
      }
      await this.db
        .query(
          `UPDATE share_imports SET status = 'failed', error_code = $2, finished_at = now()
            WHERE id = $1 AND status = 'pending'`,
          [id, code],
        )
        .catch((e: Error) =>
          this.logger.error(`Không ghi được lỗi share ${id}: ${e.message}`),
        );
    } finally {
      clearTimeout(timer);
      if (cancel && this.running.get(id) === cancel) this.running.delete(id);
      this.logger.log(
        `Share ${id}: ${timing.join(', ')} (tổng ${Date.now() - started} ms)`,
      );
    }
  }

  /** Ứng viên trả cho client: tên danh mục từ DB, tên/địa chỉ Google lấy trực tiếp cho lựa chọn tin cậy thấp. */
  private async present(
    candidates: StoredCandidate[],
  ): Promise<ShareImportCandidate[]> {
    const options = candidates.flatMap((c) => c.options);
    const catalogIds = options.flatMap((o) =>
      o.kind === 'catalog' ? [o.placeId] : [],
    );
    const catalogNames = new Map<string, string>(
      catalogIds.length
        ? (
            (await this.db.query(
              `SELECT id, name FROM places WHERE id = ANY($1::uuid[])`,
              [catalogIds],
            )) as Array<{
              id: string;
              name: string;
            }>
          ).map((r) => [r.id, r.name])
        : [],
    );
    const regionNames = await this.regions.names([
      ...new Set(options.map((o) => o.regionId)),
    ]);
    const lowGoogle = candidates
      .filter((c) => c.confidence === 'low' || c.options.length > 1)
      .flatMap((c) =>
        c.options.flatMap((o) =>
          o.kind === 'google' ? [o.googlePlaceId] : [],
        ),
      );
    const summaries = new Map<
      string,
      { name: string | null; address: string | null }
    >();
    if (this.google.enabled && lowGoogle.length > 0) {
      const results = await Promise.allSettled(
        lowGoogle.map((placeId) =>
          withTimeout(this.google.summary(placeId), SUMMARY_TIMEOUT_MS),
        ),
      );
      results.forEach((result, i) => {
        if (result.status === 'fulfilled' && result.value)
          summaries.set(lowGoogle[i], result.value);
      });
    }
    const present = (o: StoredOption): ShareImportOption => {
      const regionName = regionNames.get(o.regionId) ?? '';
      if (o.kind === 'catalog') {
        return {
          ref: { kind: 'catalog', placeId: o.placeId },
          name: catalogNames.get(o.placeId) ?? null,
          address: null,
          regionId: o.regionId,
          regionName,
        };
      }
      const summary = summaries.get(o.googlePlaceId);
      return {
        ref: { kind: 'google', googlePlaceId: o.googlePlaceId },
        name: summary?.name ?? null,
        address: summary?.address ?? null,
        regionId: o.regionId,
        regionName,
      };
    };
    return candidates.map((c) => ({
      key: c.key,
      name: c.name,
      category: c.category,
      quote: c.quote,
      confidence: c.confidence,
      options: c.options.map(present),
    }));
  }

  private async findOwned(userId: string, id: string): Promise<JobRow> {
    const [row] = await this.rows(`WHERE si.id = $1 AND si.user_id = $2`, [
      id,
      userId,
    ]);
    if (!row) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'SHARE_IMPORT_NOT_FOUND',
        message: 'Không tìm thấy lượt chia sẻ này.',
      });
    }
    return row;
  }

  private rows(where: string, params: unknown[]): Promise<JobRow[]> {
    return this.db.query(
      `SELECT si.*, (SELECT count(*)::int FROM saved_places s WHERE s.share_import_id = si.id) AS saved_count
         FROM share_imports si ${where}`,
      params,
    ) as Promise<JobRow[]>;
  }
}

/**
 * Dòng `places` nguồn Google: tên từ nội dung người dùng. Tọa độ lấy lúc job
 * chạy nên hạn 30 ngày tính từ lúc đó (PRD 7.4), không phải lúc lưu. Dùng
 * chung theo place_id; dòng đã có tọa độ mới hơn thì giữ nguyên.
 */
async function upsertGooglePlace(
  m: Pick<DataSource, 'query'>,
  candidate: StoredCandidate,
  option: Extract<StoredOption, { kind: 'google' }>,
  fetchedAt: Date,
): Promise<string> {
  const [row] = (await m.query(
    `INSERT INTO places (source, google_place_id, name, category, location, location_expires_at, composite_score)
     VALUES ('google', $1, $2, $3::place_category, ST_SetSRID(ST_MakePoint($4::float8, $5::float8), 4326),
             $7::timestamptz + make_interval(days => $6::int), 0)
     ON CONFLICT (google_place_id) WHERE source = 'google'
     DO UPDATE SET
       location = CASE WHEN places.location IS NULL OR EXCLUDED.location_expires_at > places.location_expires_at
                       THEN EXCLUDED.location ELSE places.location END,
       location_expires_at = CASE WHEN places.location IS NULL OR EXCLUDED.location_expires_at > places.location_expires_at
                                  THEN EXCLUDED.location_expires_at ELSE places.location_expires_at END,
       updated_at = now()
     RETURNING id`,
    [
      option.googlePlaceId,
      candidate.name,
      candidate.category,
      option.lng,
      option.lat,
      GOOGLE_LOCATION_TTL_DAYS,
      fetchedAt,
    ],
  )) as Array<{ id: string }>;
  return row.id;
}

function toSummary(row: JobRow): ShareImportSummary {
  return {
    id: row.id,
    status: row.status,
    source: {
      platform: row.platform ?? 'web',
      url: row.url,
      title: row.metadata?.title ?? null,
      authorName: row.metadata?.authorName ?? null,
      thumbnailUrl: row.metadata?.thumbnailUrl ?? null,
    },
    candidateCount: row.candidates.length,
    savedCount: row.saved_count,
    createdAt: row.created_at.toISOString(),
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function bad(code: string, message: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, code, message });
}
