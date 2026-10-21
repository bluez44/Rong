import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Địa điểm tự ghim và ghi chú riêng (spec 2026-10-21-user-pinned-places).
 * - `places.source = 'user'`: người dùng tự ghim, `created_by` là người tạo, tọa độ do người dùng đặt.
 * - `place_notes`: mỗi (người dùng, địa điểm) một ghi chú — mô tả, giờ mở cửa, giá mỗi người.
 */
export class AddUserPlacesAndNotes1792500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "places"
        ADD COLUMN "created_by" uuid,
        ADD CONSTRAINT "fk_place_created_by" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE CASCADE,
        DROP CONSTRAINT "chk_place_location_source",
        DROP CONSTRAINT "chk_place_source",
        ADD CONSTRAINT "chk_place_location_source" CHECK ("location_source" IN ('google', 'ai', 'user')),
        ADD CONSTRAINT "chk_place_source" CHECK (
          ("source" = 'google' AND "google_place_id" IS NOT NULL AND "location_source" = 'google' AND "created_by" IS NULL)
          OR ("source" = 'web' AND "created_by" IS NULL AND (
                ("location_source" = 'google' AND "google_place_id" IS NOT NULL)
             OR ("location_source" = 'ai' AND "google_place_id" IS NULL AND "location" IS NOT NULL)))
          OR ("source" = 'user' AND "created_by" IS NOT NULL AND "location" IS NOT NULL
              AND "location_source" = 'user' AND "google_place_id" IS NULL)
        )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_places_created_by" ON "places" ("created_by", "created_at") WHERE "source" = 'user'`,
    );
    await queryRunner.query(`
      CREATE TABLE "place_notes" (
        "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
        "place_id" uuid NOT NULL REFERENCES "places" ("id") ON DELETE CASCADE,
        "note" text,
        "opening_hours" text,
        "price_min" integer,
        "price_max" integer,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_place_notes" PRIMARY KEY ("user_id", "place_id"),
        CONSTRAINT "chk_place_notes_note" CHECK (char_length("note") <= 1000),
        CONSTRAINT "chk_place_notes_hours" CHECK (char_length("opening_hours") <= 200),
        CONSTRAINT "chk_place_notes_price" CHECK (
          ("price_min" IS NULL OR "price_min" BETWEEN 0 AND 100000000)
          AND ("price_max" IS NULL OR "price_max" BETWEEN 0 AND 100000000)
          AND ("price_min" IS NULL OR "price_max" IS NULL OR "price_max" >= "price_min"))
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "place_notes"`);
    await queryRunner.query(`DELETE FROM "places" WHERE "source" = 'user'`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_places_created_by"`);
    await queryRunner.query(`
      ALTER TABLE "places"
        DROP CONSTRAINT "chk_place_source",
        DROP CONSTRAINT "chk_place_location_source",
        DROP CONSTRAINT "fk_place_created_by",
        DROP COLUMN "created_by",
        ADD CONSTRAINT "chk_place_location_source" CHECK ("location_source" IN ('google', 'ai')),
        ADD CONSTRAINT "chk_place_source" CHECK (
          ("source" = 'google' AND "google_place_id" IS NOT NULL AND "location_source" = 'google')
          OR ("source" = 'web' AND (
                ("location_source" = 'google' AND "google_place_id" IS NOT NULL)
             OR ("location_source" = 'ai' AND "google_place_id" IS NULL AND "location" IS NOT NULL)))
        )
    `);
  }
}
