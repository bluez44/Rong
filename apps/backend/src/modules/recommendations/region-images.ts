import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { PlaceImage } from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { UnsplashClient } from './unsplash.client.js';

/** Vùng đã tìm mà không có ảnh: tìm lại sau chừng này ngày. */
const RETRY_NONE_DAYS = 30;

/** Ảnh cho thẻ gợi ý: Unsplash → ảnh địa điểm hạng cao nhất (bài viết, có nguồn) → không có. */
@Injectable()
export class RegionImages {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly unsplash: UnsplashClient,
  ) {}

  async fetch(regionId: string): Promise<'found' | 'none' | 'skipped'> {
    const [existing] = (await this.db.query(
      `SELECT status, blocked, fetched_at > now() - $2::int * interval '1 day' AS fresh
         FROM region_images WHERE region_id = $1`,
      [regionId, RETRY_NONE_DAYS],
    )) as Array<{ status: 'found' | 'none'; blocked: boolean; fresh: boolean }>;
    // Ảnh bị chặn (gỡ thủ công) không tìm lại.
    if (existing && (existing.blocked || existing.status === 'found' || existing.fresh)) return 'skipped';

    const [region] = (await this.db.query(`SELECT name FROM regions WHERE id = $1`, [regionId])) as Array<{ name: string }>;
    if (!region) return 'skipped';

    const photo = await this.unsplash.searchLandscape(`${region.name} Vietnam`);
    if (photo) {
      await this.upsert(regionId, {
        status: 'found',
        url: photo.url,
        width: photo.width,
        height: photo.height,
        source: 'unsplash',
        author: photo.author,
        author_url: photo.authorUrl,
        source_url: photo.pageUrl,
        license: 'Unsplash License',
      });
      return 'found';
    }

    const [article] = (await this.db.query(
      `SELECT image FROM region_places WHERE region_id = $1 AND image IS NOT NULL ORDER BY rank LIMIT 1`,
      [regionId],
    )) as Array<{ image: PlaceImage }>;
    if (article?.image?.url) {
      await this.upsert(regionId, {
        status: 'found',
        url: article.image.url,
        source: 'web',
        source_url: article.image.sourceUrl,
      });
      return 'found';
    }

    await this.upsert(regionId, { status: 'none' });
    return 'none';
  }

  private async upsert(
    regionId: string,
    v: {
      status: 'found' | 'none';
      url?: string;
      width?: number;
      height?: number;
      source?: 'unsplash' | 'web';
      author?: string;
      author_url?: string;
      source_url?: string;
      license?: string;
    },
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO region_images (region_id, status, url, width, height, source, author, author_url, source_url, license, fetched_at)
       VALUES ($1, $2, $3, $4::int, $5::int, $6, $7, $8, $9, $10, now())
       ON CONFLICT (region_id) DO UPDATE SET
         status = EXCLUDED.status, url = EXCLUDED.url, width = EXCLUDED.width, height = EXCLUDED.height,
         source = EXCLUDED.source, author = EXCLUDED.author, author_url = EXCLUDED.author_url,
         source_url = EXCLUDED.source_url, license = EXCLUDED.license, fetched_at = now()
       WHERE region_images.blocked = false`,
      [
        regionId,
        v.status,
        v.url ?? null,
        v.width ?? null,
        v.height ?? null,
        v.source ?? null,
        v.author ?? null,
        v.author_url ?? null,
        v.source_url ?? null,
        v.license ?? null,
      ],
    );
  }
}
