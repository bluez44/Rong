import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bật các extension mà schema dựa vào.
 *
 * - `postgis`  : kiểu geometry và toán tử không gian. Dùng cho FR-1.10 (lọc địa
 *                điểm nằm trong polygon của vùng).
 * - `unaccent` : bỏ dấu tiếng Việt, để "da lat" tìm ra "Đà Lạt" (FR-1.1).
 * - `pg_trgm`  : so khớp gần đúng, để chịu được lỗi chính tả nhẹ (FR-1.1).
 */
export class EnablePostgis1758000000000 implements MigrationInterface {
  name = 'EnablePostgis1758000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS postgis');
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS unaccent');
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Không gỡ postgis: các bảng khác có thể còn cột geometry phụ thuộc vào nó.
    await queryRunner.query('DROP EXTENSION IF EXISTS pg_trgm');
    await queryRunner.query('DROP EXTENSION IF EXISTS unaccent');
  }
}
