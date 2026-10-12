import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Từ khóa tìm vùng không ra kết quả (F1), để biết cần seed thêm điểm đến nào.
 * Chỉ đếm theo từ khóa đã chuẩn hóa: không lưu người tìm.
 *
 * `catalog_misses`: tìm trong danh mục (lúc gõ) không ra gì.
 * `online_misses`: đã hỏi thêm Nominatim mà vẫn không ra gì — đáng seed nhất.
 */
export class CreateRegionSearchMisses1759300000000 implements MigrationInterface {
  name = 'CreateRegionSearchMisses1759300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "region_search_misses" (
        "search_key" text PRIMARY KEY,
        "sample_query" text NOT NULL,
        "catalog_misses" integer NOT NULL DEFAULT 0,
        "online_misses" integer NOT NULL DEFAULT 0,
        "first_seen_at" timestamptz NOT NULL DEFAULT now(),
        "last_seen_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "region_search_misses"`);
  }
}
