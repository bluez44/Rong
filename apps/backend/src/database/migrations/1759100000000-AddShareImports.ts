import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F4 — Chia sẻ vào app.
 *
 * `places` nhận thêm dòng nguồn Google: chỉ `google_place_id` (trường Google
 * duy nhất được lưu vô thời hạn), tên lấy từ nội dung người dùng chia sẻ, loại
 * do AI phân từ chính nội dung đó, và tọa độ Google có hạn 30 ngày
 * (`location_expires_at`, PRD 7.4). Dòng Google không bao giờ được xếp hạng.
 *
 * `share_imports` là job nhận diện; `saved_places` ghi nguồn của lượt lưu.
 */
export class AddShareImports1759100000000 implements MigrationInterface {
  name = 'AddShareImports1759100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "places"
        ADD COLUMN "source" text NOT NULL DEFAULT 'osm',
        ADD COLUMN "location_expires_at" timestamptz,
        ALTER COLUMN "osm_type" DROP NOT NULL,
        ALTER COLUMN "osm_id" DROP NOT NULL,
        ALTER COLUMN "location" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "places" ADD CONSTRAINT "chk_place_source" CHECK (
        ("source" = 'osm' AND "osm_type" IS NOT NULL AND "osm_id" IS NOT NULL AND "location" IS NOT NULL)
        OR ("source" = 'google' AND "google_place_id" IS NOT NULL)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_place_google" ON "places" ("google_place_id") WHERE "source" = 'google'`,
    );

    await queryRunner.query(`
      CREATE TABLE "share_imports" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "url" text,
        "shared_text" text,
        "status" text NOT NULL DEFAULT 'pending',
        "platform" text,
        "metadata" jsonb,
        "candidates" jsonb NOT NULL DEFAULT '[]',
        "error_code" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "finished_at" timestamptz,
        CONSTRAINT "chk_share_import_status" CHECK ("status" IN ('pending', 'done', 'failed')),
        CONSTRAINT "fk_share_import_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_share_import_user_created" ON "share_imports" ("user_id", "created_at" DESC)`,
    );

    await queryRunner.query(`
      ALTER TABLE "saved_places"
        ADD COLUMN "source" text NOT NULL DEFAULT 'manual',
        ADD COLUMN "share_import_id" uuid,
        ADD CONSTRAINT "chk_saved_place_source" CHECK ("source" IN ('manual', 'share')),
        ADD CONSTRAINT "fk_saved_place_share_import" FOREIGN KEY ("share_import_id")
          REFERENCES "share_imports" ("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "saved_places"
        DROP CONSTRAINT IF EXISTS "fk_saved_place_share_import",
        DROP CONSTRAINT IF EXISTS "chk_saved_place_source",
        DROP COLUMN IF EXISTS "share_import_id",
        DROP COLUMN IF EXISTS "source"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "share_imports"`);
    // Dòng Google không có osm/tọa độ: phải xóa trước khi trả NOT NULL.
    await queryRunner.query(`DELETE FROM "places" WHERE "source" = 'google'`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_place_google"`);
    await queryRunner.query(
      `ALTER TABLE "places" DROP CONSTRAINT IF EXISTS "chk_place_source"`,
    );
    await queryRunner.query(`
      ALTER TABLE "places"
        ALTER COLUMN "location" SET NOT NULL,
        ALTER COLUMN "osm_id" SET NOT NULL,
        ALTER COLUMN "osm_type" SET NOT NULL,
        DROP COLUMN "location_expires_at",
        DROP COLUMN "source"
    `);
  }
}
