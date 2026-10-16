import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bỏ những gì của danh mục OSM/Wikidata cũ còn sót trên `places`: dòng `source = 'osm'`
 * (`osm_type`, `osm_id`), `wikidata_id`, `sitelinks`, điểm tổng hợp `composite_score`
 * (dòng web/google luôn là 0) và `google_matched_at` (không còn ai ghi).
 *
 * Không tự xóa dòng OSM: `saved_places`, `group_places`, `region_places` xóa theo
 * (ON DELETE CASCADE), tức mất "Muốn đi" của người dùng. Còn dòng OSM thì dừng lại.
 */
export class DropUnusedPlaceColumns1792131722044 implements MigrationInterface {
  name = 'DropUnusedPlaceColumns1792131722044';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = (await queryRunner.query(
      `SELECT count(*)::int AS count FROM "places" WHERE "source" = 'osm' OR "location_source" = 'osm'`,
    )) as Array<{ count: number }>;
    if (count > 0) {
      throw new Error(
        `Còn ${count} địa điểm nguồn OSM cũ trong bảng places. Chuyển hoặc xóa chúng (kèm "Muốn đi"/địa điểm nhóm trỏ tới) trước khi chạy migration này.`,
      );
    }

    await queryRunner.query(`
      ALTER TABLE "places"
        DROP CONSTRAINT "chk_place_source",
        DROP CONSTRAINT "chk_place_location_source",
        DROP CONSTRAINT "uq_place_osm",
        DROP COLUMN "osm_type",
        DROP COLUMN "osm_id",
        DROP COLUMN "wikidata_id",
        DROP COLUMN "sitelinks",
        DROP COLUMN "composite_score",
        DROP COLUMN "google_matched_at",
        ALTER COLUMN "source" DROP DEFAULT,
        ALTER COLUMN "location_source" DROP DEFAULT,
        ADD CONSTRAINT "chk_place_location_source" CHECK ("location_source" IN ('google', 'ai')),
        ADD CONSTRAINT "chk_place_source" CHECK (
          ("source" = 'google' AND "google_place_id" IS NOT NULL AND "location_source" = 'google')
          OR ("source" = 'web' AND (
                ("location_source" = 'google' AND "google_place_id" IS NOT NULL)
             OR ("location_source" = 'ai' AND "google_place_id" IS NULL AND "location" IS NOT NULL)))
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Chỉ dựng lại cột và ràng buộc; dữ liệu đã bỏ không khôi phục được.
    await queryRunner.query(`
      ALTER TABLE "places"
        DROP CONSTRAINT "chk_place_source",
        DROP CONSTRAINT "chk_place_location_source",
        ADD COLUMN "osm_type" text,
        ADD COLUMN "osm_id" bigint,
        ADD COLUMN "wikidata_id" text,
        ADD COLUMN "sitelinks" integer,
        ADD COLUMN "composite_score" smallint NOT NULL DEFAULT 0,
        ADD COLUMN "google_matched_at" timestamptz,
        ALTER COLUMN "source" SET DEFAULT 'osm',
        ALTER COLUMN "location_source" SET DEFAULT 'osm',
        ADD CONSTRAINT "uq_place_osm" UNIQUE ("osm_type", "osm_id"),
        ADD CONSTRAINT "chk_place_location_source" CHECK ("location_source" IN ('osm', 'google', 'ai')),
        ADD CONSTRAINT "chk_place_source" CHECK (
          ("source" = 'osm' AND "osm_type" IS NOT NULL AND "osm_id" IS NOT NULL AND "location" IS NOT NULL)
          OR ("source" = 'google' AND "google_place_id" IS NOT NULL AND "location_source" = 'google')
          OR ("source" = 'web' AND (
                ("location_source" = 'google' AND "google_place_id" IS NOT NULL)
             OR ("location_source" = 'ai' AND "google_place_id" IS NULL AND "location" IS NOT NULL)))
        )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_place_score" ON "places" ("composite_score", "id")`,
    );
  }
}
