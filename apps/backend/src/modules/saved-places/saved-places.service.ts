import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { PlaceCategory, SavedPlace, SharePlatform } from '@rong/shared-types';
import { DataSource } from 'typeorm';

/** Đủ cho mọi chuyến đi; chặn danh sách phình vô hạn. */
export const MAX_SAVED_PLACES = 500;

/** Lượt lưu đến từ đâu: người dùng tự thả tim, hay chọn từ một lượt chia sẻ (F4). */
export type SaveOrigin = { source: 'manual' | 'share'; shareImportId: string | null };
const MANUAL: SaveOrigin = { source: 'manual', shareImportId: null };

interface SavedRow {
  place_id: string;
  name: string;
  category: PlaceCategory;
  region_id: string;
  region_name: string;
  parent_name: string | null;
  created_at: Date;
  source: 'manual' | 'share';
  platform: SharePlatform | null;
  share_title: string | null;
  share_url: string | null;
}

@Injectable()
export class SavedPlacesService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** Mới lưu trước. Client tự nhóm theo `regionId`. */
  async list(userId: string): Promise<SavedPlace[]> {
    const rows = (await this.db.query(
      `SELECT s.place_id, p.name, p.category, s.region_id, r.name AS region_name,
              pr.name AS parent_name, s.created_at, s.source, si.platform,
              si.metadata->>'title' AS share_title, si.url AS share_url
         FROM saved_places s
         JOIN places p ON p.id = s.place_id
         JOIN regions r ON r.id = s.region_id
         LEFT JOIN regions pr ON pr.id = r.parent_id
         LEFT JOIN share_imports si ON si.id = s.share_import_id
        WHERE s.user_id = $1
        ORDER BY s.created_at DESC
        LIMIT $2`,
      [userId, MAX_SAVED_PLACES],
    )) as SavedRow[];
    return rows.map((r) => ({
      placeId: r.place_id,
      name: r.name,
      category: r.category,
      regionId: r.region_id,
      regionName: r.parent_name
        ? `${r.region_name}, ${r.parent_name}`
        : r.region_name,
      savedAt: r.created_at.toISOString(),
      source: r.source,
      shareSource:
        r.source === 'share' && r.platform
          ? { platform: r.platform, title: r.share_title, url: r.share_url }
          : null,
    }));
  }

  /**
   * Lưu lại địa điểm đã lưu thì chuyển nó sang vùng mới, giữ thời điểm lưu.
   * `runner` cho phép chạy trong transaction của người gọi (lưu từ lượt chia sẻ).
   */
  async save(
    userId: string,
    placeId: string,
    regionId: string,
    origin: SaveOrigin = MANUAL,
    runner: Pick<DataSource, 'query'> = this.db,
  ): Promise<void> {
    const [check] = (await runner.query(
      `SELECT EXISTS (SELECT 1 FROM places WHERE id = $1) AS place,
              EXISTS (SELECT 1 FROM regions WHERE id = $2) AS region,
              (SELECT count(*)::int FROM saved_places WHERE user_id = $3) AS saved,
              EXISTS (SELECT 1 FROM saved_places WHERE user_id = $3 AND place_id = $1) AS already`,
      [placeId, regionId, userId],
    )) as Array<{
      place: boolean;
      region: boolean;
      saved: number;
      already: boolean;
    }>;
    if (!check.place) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'PLACE_NOT_FOUND',
        message: 'Không tìm thấy địa điểm này.',
      });
    }
    if (!check.region) {
      throw bad('UNKNOWN_REGION', 'Không tìm thấy vùng này.');
    }
    if (!check.already && check.saved >= MAX_SAVED_PLACES) {
      throw bad(
        'SAVED_LIMIT',
        `Danh sách "Muốn đi" tối đa ${MAX_SAVED_PLACES} địa điểm. Bỏ bớt rồi thử lại.`,
      );
    }
    // Thả tim thủ công lại một địa điểm đã lưu từ share không xóa nguồn share.
    await runner.query(
      `INSERT INTO saved_places (user_id, place_id, region_id, source, share_import_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, place_id) DO UPDATE
         SET region_id = EXCLUDED.region_id,
             source = CASE WHEN EXCLUDED.source = 'share' THEN 'share' ELSE saved_places.source END,
             share_import_id = COALESCE(EXCLUDED.share_import_id, saved_places.share_import_id)`,
      [userId, placeId, regionId, origin.source, origin.shareImportId],
    );
  }

  async remove(userId: string, placeId: string): Promise<void> {
    await this.db.query(
      `DELETE FROM saved_places WHERE user_id = $1 AND place_id = $2`,
      [userId, placeId],
    );
  }
}

function bad(code: string, message: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, code, message });
}
