import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F4 — bổ sung sau review.
 *
 * - `saved_places.display_name`: tên địa điểm theo nội dung chính người dùng đã
 *   chia sẻ. Dòng Google dùng chung theo place_id nên `places.name` là tên của
 *   người chia sẻ đầu tiên; mỗi người thấy tên của mình trong "Muốn đi".
 * - Chỉ mục `share_import_id`: đếm số đã lưu của từng job (client hỏi lại mỗi
 *   1,5 giây) và ON DELETE SET NULL khi xóa job.
 */
export class ShareImportFollowups1759200000000 implements MigrationInterface {
  name = 'ShareImportFollowups1759200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "saved_places" ADD COLUMN "display_name" text`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_saved_place_share_import" ON "saved_places" ("share_import_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_saved_place_share_import"`,
    );
    await queryRunner.query(
      `ALTER TABLE "saved_places" DROP COLUMN IF EXISTS "display_name"`,
    );
  }
}
