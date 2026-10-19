import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { PlaceCategory, RecommendationThemeKind } from '@rong/shared-types';
import { DataSource } from 'typeorm';

import { FIXED_THEMES } from './themes.js';

export interface ResolvedTheme {
  key: string;
  label: string;
  icon: string;
  kind: RecommendationThemeKind;
  /** Danh mục của chủ đề (chưa gộp sở thích). `default`: chính là sở thích. */
  categories: PlaceCategory[];
  /** null = mọi vùng. */
  regionIds: string[] | null;
  regionHint: string | null;
}

export const DEFAULT_THEME_KEY = 'default';

export function unknownTheme(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: 'UNKNOWN_THEME',
    message: 'Chủ đề này không còn nữa. Hãy chọn chủ đề khác.',
  });
}

/** Chủ đề của một người: "Dành cho bạn", chủ đề riêng còn hạn, chủ đề cố định. */
@Injectable()
export class ThemeCatalog {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** Thứ tự chip: mặc định, chủ đề riêng, chủ đề cố định khớp sở thích, phần còn lại. */
  async list(userId: string, interests: PlaceCategory[]): Promise<ResolvedTheme[]> {
    const personal = (await this.db.query(
      `SELECT t.id, t.label, t.icon, t.categories::text[] AS categories, t.region_ids,
              (SELECT string_agg(r.name, ', ' ORDER BY r.name) FROM regions r WHERE r.id = ANY(t.region_ids)) AS hint
         FROM user_themes t
        WHERE t.user_id = $1 AND t.expires_at > now()
        ORDER BY t.generated_at, t.label`,
      [userId],
    )) as Array<{ id: string; label: string; icon: string; categories: PlaceCategory[]; region_ids: string[]; hint: string | null }>;

    const fixedRegionIds = await this.fixedRegionIds();
    const fixed = FIXED_THEMES.map<ResolvedTheme>((t) => ({
      key: `fixed:${t.key}`,
      label: t.label,
      icon: t.icon,
      kind: 'fixed',
      categories: t.categories,
      regionIds: t.regionSourceKeys ? (fixedRegionIds.get(t.key) ?? []) : null,
      regionHint: null,
    }));
    const matches = (t: ResolvedTheme) => t.categories.some((c) => interests.includes(c));

    return [
      {
        key: DEFAULT_THEME_KEY,
        label: 'Dành cho bạn',
        icon: 'sparkles',
        kind: 'default',
        categories: interests,
        regionIds: null,
        regionHint: null,
      },
      ...personal.map<ResolvedTheme>((t) => ({
        key: `user:${t.id}`,
        label: t.label,
        icon: t.icon,
        kind: 'personal',
        categories: t.categories,
        regionIds: t.region_ids,
        regionHint: t.hint,
      })),
      ...fixed.filter(matches),
      ...fixed.filter((t) => !matches(t)),
    ];
  }

  async resolve(
    userId: string,
    key: string,
    interests: PlaceCategory[],
  ): Promise<ResolvedTheme> {
    const theme = (await this.list(userId, interests)).find((t) => t.key === key);
    if (!theme) throw unknownTheme();
    return theme;
  }

  private async fixedRegionIds(): Promise<Map<string, string[]>> {
    const keys = FIXED_THEMES.flatMap((t) => t.regionSourceKeys ?? []);
    const rows = (await this.db.query(
      `SELECT id, source_key FROM regions WHERE source_key = ANY($1::text[])`,
      [keys],
    )) as Array<{ id: string; source_key: string }>;
    const byKey = new Map(rows.map((r) => [r.source_key, r.id]));
    return new Map(
      FIXED_THEMES.map((t) => [
        t.key,
        (t.regionSourceKeys ?? []).flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : [])),
      ]),
    );
  }
}
