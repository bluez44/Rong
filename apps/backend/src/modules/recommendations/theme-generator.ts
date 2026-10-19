import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { PlaceCategory } from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { LangchainService } from '../../langchain/langchain.service.js';
import { MAX_USER_THEMES, sanitizeThemes, THEME_ICONS } from './themes.js';

const THEME_TTL_DAYS = 7;
const MAX_REGIONS_IN_PROMPT = 80;

const SYSTEM_PROMPT = `Bạn đặt chủ đề khám phá du lịch Việt Nam cho một người dùng.
Mỗi chủ đề gồm tên ngắn gợi cảm hứng (dưới 40 ký tự), một icon, vài danh mục địa điểm và 1–4 vùng phù hợp.
Chỉ dùng id vùng có trong danh sách. Ưu tiên vùng người dùng chưa đến và hợp sở thích. Tối đa ${MAX_USER_THEMES} chủ đề.
Icon hợp lệ: ${THEME_ICONS.join(', ')}.`;

/** Job `generate-user-themes`: Gemini đặt tối đa 3 chủ đề riêng, code kiểm tra rồi thay bộ cũ. */
@Injectable()
export class ThemeGenerator {
  private readonly logger = new Logger(ThemeGenerator.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly langchain: LangchainService,
  ) {}

  async generate(userId: string): Promise<number> {
    const [user] = (await this.db.query(
      `SELECT interests::text[] AS interests FROM users WHERE id = $1`,
      [userId],
    )) as Array<{ interests: PlaceCategory[] }>;
    if (!user) return 0;

    const visitedRegions = (
      (await this.db.query(
        `SELECT DISTINCT r.name FROM visited_places v JOIN regions r ON r.id = v.region_id
          WHERE v.user_id = $1 AND v.status IN ('inferred', 'confirmed') LIMIT 10`,
        [userId],
      )) as Array<{ name: string }>
    ).map((r) => r.name);

    const regions = (await this.db.query(
      `SELECT r.id, r.name,
              (SELECT array_agg(c ORDER BY n DESC) FROM (
                 SELECT p.category::text AS c, count(*) AS n FROM region_places rp
                   JOIN places p ON p.id = rp.place_id
                  WHERE rp.region_id = r.id AND p.category NOT IN ('stay', 'food')
                  GROUP BY p.category ORDER BY n DESC LIMIT 3) t) AS top_categories
         FROM regions r
         JOIN region_place_lists l ON l.region_id = r.id AND l.status = 'ready'
        WHERE r.type = 'destination'
           OR (r.type = 'administrative' AND r.level = 'province' AND r.boundary_version = 'current')
        ORDER BY r.name
        LIMIT $1::int`,
      [MAX_REGIONS_IN_PROMPT],
    )) as Array<{ id: string; name: string; top_categories: string[] | null }>;
    if (regions.length === 0) return 0;

    const request = JSON.stringify({
      interests: user.interests,
      visitedRegions,
      regions: regions.map((r) => ({ id: r.id, name: r.name, categories: r.top_categories ?? [] })),
    });
    // Lỗi Gemini ném ra ngoài: BullMQ thử lại; hết lượt thì chủ đề cũ vẫn còn.
    const result = await this.langchain.suggestThemes(SYSTEM_PROMPT, request);
    const themes = sanitizeThemes(result.themes ?? [], new Set(regions.map((r) => r.id)));

    await this.db.transaction(async (m) => {
      await m.query(`DELETE FROM user_themes WHERE user_id = $1`, [userId]);
      for (const t of themes) {
        await m.query(
          `INSERT INTO user_themes (user_id, label, icon, categories, region_ids, expires_at)
           VALUES ($1, $2, $3, $4::place_category[], $5::uuid[], now() + $6::int * interval '1 day')`,
          [userId, t.label, t.icon, t.categories, t.regionIds, THEME_TTL_DAYS],
        );
      }
    });
    this.logger.log(`Chủ đề riêng cho ${userId}: ${themes.length}.`);
    return themes.length;
  }
}
