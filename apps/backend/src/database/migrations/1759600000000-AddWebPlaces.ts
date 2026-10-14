import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Danh sách địa điểm từ bài viết (spec 2026-10-14-web-places):
 * - `places.source = 'web'`: tên từ bài viết, `google_place_id` khi ghép được.
 * - `location_source`: tọa độ từ OSM, Google (hạn 30 ngày) hay AI ước đoán.
 *   Thay cho việc suy ra "tọa độ Google" từ `source = 'google'`.
 * - Một `google_place_id` chỉ một dòng, dù nguồn `google` hay `web`.
 * - `region_place_lists` / `region_places`: danh sách đã tổng hợp của mỗi vùng.
 */
export class AddWebPlaces1759600000000 implements MigrationInterface {
  name = 'AddWebPlaces1759600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "places" ADD COLUMN "location_source" text NOT NULL DEFAULT 'osm'`,
    );
    await queryRunner.query(
      `UPDATE "places" SET "location_source" = 'google' WHERE "source" = 'google'`,
    );
    await queryRunner.query(`
      ALTER TABLE "places"
        ADD CONSTRAINT "chk_place_location_source" CHECK ("location_source" IN ('osm', 'google', 'ai')),
        DROP CONSTRAINT "chk_place_source",
        ADD CONSTRAINT "chk_place_source" CHECK (
          ("source" = 'osm' AND "osm_type" IS NOT NULL AND "osm_id" IS NOT NULL AND "location" IS NOT NULL)
          OR ("source" = 'google' AND "google_place_id" IS NOT NULL AND "location_source" = 'google')
          OR ("source" = 'web' AND (
                ("location_source" = 'google' AND "google_place_id" IS NOT NULL)
             OR ("location_source" = 'ai' AND "google_place_id" IS NULL AND "location" IS NOT NULL)))
        )
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_place_google"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_place_google" ON "places" ("google_place_id") WHERE "source" IN ('google', 'web')`,
    );
    await queryRunner.query(`
      CREATE TABLE "region_place_lists" (
        "region_id" uuid PRIMARY KEY REFERENCES "regions"("id") ON DELETE CASCADE,
        "status" text NOT NULL CHECK ("status" IN ('ready', 'building', 'failed')),
        "fetched_at" timestamptz,
        "expires_at" timestamptz,
        "error_code" text,
        "sources" jsonb NOT NULL DEFAULT '[]'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "region_places" (
        "region_id" uuid NOT NULL REFERENCES "regions"("id") ON DELETE CASCADE,
        "place_id" uuid NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
        "rank" smallint NOT NULL,
        "articles" jsonb NOT NULL DEFAULT '[]',
        PRIMARY KEY ("region_id", "place_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_region_places_rank" ON "region_places" ("region_id", "rank")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "region_places"`);
    await queryRunner.query(`DROP TABLE "region_place_lists"`);
    await queryRunner.query(`DELETE FROM "places" WHERE "source" = 'web'`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_place_google"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_place_google" ON "places" ("google_place_id") WHERE "source" = 'google'`,
    );
    await queryRunner.query(`
      ALTER TABLE "places"
        DROP CONSTRAINT "chk_place_source",
        ADD CONSTRAINT "chk_place_source" CHECK (
          ("source" = 'osm' AND "osm_type" IS NOT NULL AND "osm_id" IS NOT NULL AND "location" IS NOT NULL)
          OR ("source" = 'google' AND "google_place_id" IS NOT NULL)
        ),
        DROP CONSTRAINT "chk_place_location_source",
        DROP COLUMN "location_source"
    `);
  }
}
