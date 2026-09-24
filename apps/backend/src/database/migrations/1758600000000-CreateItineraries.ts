import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lịch trình — F6, F7. Ngày, mục, cảnh báo và chi phí lưu dạng JSONB: lịch
 * trình luôn được đọc/ghi nguyên khối, và cấu trúc còn thay đổi theo F8
 * (chỉnh sửa). Khi cần truy vấn theo từng mục (ví dụ thống kê địa điểm hay
 * được xếp) thì tách bảng sau.
 */
export class CreateItineraries1758600000000 implements MigrationInterface {
  name = 'CreateItineraries1758600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "itinerary_planner" AS ENUM ('ai', 'heuristic', 'manual')`,
    );
    await queryRunner.query(`
      CREATE TABLE "itineraries" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "owner_id" uuid NOT NULL,
        "region_id" uuid NOT NULL,
        "planner" "itinerary_planner" NOT NULL,
        "starts_at" timestamptz NOT NULL,
        "ends_at" timestamptz NOT NULL,
        "input" jsonb NOT NULL,
        "days" jsonb NOT NULL,
        "unscheduled" jsonb NOT NULL DEFAULT '[]',
        "warnings" jsonb NOT NULL DEFAULT '[]',
        "tips" jsonb NOT NULL DEFAULT '[]',
        "cost" jsonb NOT NULL,
        "ai_edits_remaining" smallint NOT NULL DEFAULT 3,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_itinerary_owner" FOREIGN KEY ("owner_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_itinerary_region" FOREIGN KEY ("region_id")
          REFERENCES "regions" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_itinerary_owner_created" ON "itineraries" ("owner_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "itineraries"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "itinerary_planner"`);
  }
}
