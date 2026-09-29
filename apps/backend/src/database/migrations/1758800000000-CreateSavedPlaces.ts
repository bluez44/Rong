import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Danh sách "Muốn đi" — F9. Mỗi địa điểm lưu kèm vùng người dùng đang xem lúc
 * thả tim, để nhóm theo điểm đến và mở luồng tạo lịch trình (F6) đúng vùng.
 */
export class CreateSavedPlaces1758800000000 implements MigrationInterface {
  name = 'CreateSavedPlaces1758800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "saved_places" (
        "user_id" uuid NOT NULL,
        "place_id" uuid NOT NULL,
        "region_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_saved_place" PRIMARY KEY ("user_id", "place_id"),
        CONSTRAINT "fk_saved_place_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_saved_place_place" FOREIGN KEY ("place_id")
          REFERENCES "places" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_saved_place_region" FOREIGN KEY ("region_id")
          REFERENCES "regions" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_saved_place_user_created" ON "saved_places" ("user_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "saved_places"`);
  }
}
