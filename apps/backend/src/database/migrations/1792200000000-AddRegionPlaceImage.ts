import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ảnh địa điểm lấy từ bài viết (spec 2026-10-16-article-images): `{ url, sourceUrl }`,
 * lưu theo danh sách của vùng, cạnh `articles` mà ảnh được lấy từ đó.
 */
export class AddRegionPlaceImage1792200000000 implements MigrationInterface {
  name = 'AddRegionPlaceImage1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "region_places" ADD COLUMN "image" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "region_places" DROP COLUMN "image"`);
  }
}
