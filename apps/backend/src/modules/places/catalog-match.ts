import type { DataSource } from 'typeorm';

import type { Bbox } from '../regions/bbox.js';

export interface CatalogMatch {
  idx: string;
  id: string;
  lat: number;
  lng: number;
  osm_type: string;
  osm_id: string;
  wikidata_id: string | null;
  opening_hours: string | null;
  website: string | null;
}

/** Ngưỡng độ giống tên (pg_trgm) để coi là cùng một địa điểm. */
export const CATALOG_MIN_SIMILARITY = 0.6;
/** Tên ngắn nằm gọn trong tên dài vẫn đủ giống, nên bắt độ dài (đã bỏ dấu) phải gần nhau. */
export const CATALOG_MIN_LENGTH_RATIO = 0.75;

/**
 * Mỗi tên lấy địa điểm OSM giống nhất (trong khung bao nếu có), một truy vấn
 * cho cả danh sách. Chỉ dòng `source = 'osm'`: dòng Google không phải danh mục.
 */
export function matchCatalog(
  db: Pick<DataSource, 'query'>,
  names: string[],
  bbox: Bbox | null,
  minSimilarity = CATALOG_MIN_SIMILARITY,
): Promise<CatalogMatch[]> {
  return db.query(
    `WITH candidates AS (
       SELECT p.*, unaccent(lower(p.name)) AS norm
         FROM places p
        WHERE p.source = 'osm'
          AND ($2::float8 IS NULL OR p.location && ST_MakeEnvelope($2, $3, $4, $5, 4326))
     )
     SELECT n.idx, m.*
       FROM unnest($1::text[]) WITH ORDINALITY AS n(name, idx)
       CROSS JOIN LATERAL (SELECT unaccent(lower(n.name)) AS q) nq
       CROSS JOIN LATERAL (
         SELECT c.id, ST_Y(c.location) AS lat, ST_X(c.location) AS lng,
                c.osm_type, c.osm_id, c.wikidata_id,
                c.tags->>'opening_hours' AS opening_hours,
                COALESCE(c.tags->>'website', c.tags->>'contact:website') AS website
           FROM candidates c
          WHERE similarity(c.norm, nq.q) >= $6
            AND least(length(c.norm), length(nq.q))::float8
                / greatest(length(c.norm), length(nq.q)) >= $7
          ORDER BY similarity(c.norm, nq.q) DESC
          LIMIT 1
       ) m`,
    [
      names,
      bbox ? bbox[1] : null,
      bbox ? bbox[0] : null,
      bbox ? bbox[3] : null,
      bbox ? bbox[2] : null,
      minSimilarity,
      CATALOG_MIN_LENGTH_RATIO,
    ],
  ) as Promise<CatalogMatch[]>;
}
