import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lượt tìm vùng có kết quả nhưng chỉ khớp gần đúng (điểm cao nhất dưới ngưỡng
 * "khớp tốt"), ví dụ "can gio" ra "Cần Thơ". Danh sách không rỗng nên trước
 * đây không được đếm, dù người dùng có thể không tìm thấy nơi cần.
 * `best_match_name`/`best_score` là kết quả đứng đầu ở lượt gần nhất.
 */
export class AddRegionSearchWeakMatches1759400000000 implements MigrationInterface {
  name = 'AddRegionSearchWeakMatches1759400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "region_search_misses"
        ADD COLUMN "weak_matches" integer NOT NULL DEFAULT 0,
        ADD COLUMN "best_match_name" text,
        ADD COLUMN "best_score" real
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "region_search_misses"
        DROP COLUMN IF EXISTS "best_score",
        DROP COLUMN IF EXISTS "best_match_name",
        DROP COLUMN IF EXISTS "weak_matches"
    `);
  }
}
