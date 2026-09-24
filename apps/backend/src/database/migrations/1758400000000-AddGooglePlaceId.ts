import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Khóa ghép sang Google Places. place_id là trường Google DUY NHẤT được phép
 * lưu vô thời hạn (PRD 7.4 nguyên tắc 2); mọi thứ khác gọi theo thời gian thực.
 *
 * `google_matched_at` ghi lần thử ghép gần nhất — kể cả khi không tìm thấy —
 * để không gọi Text Search lại mỗi lần mở chi tiết một địa điểm Google không có.
 */
export class AddGooglePlaceId1758400000000 implements MigrationInterface {
  name = 'AddGooglePlaceId1758400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "places" ADD COLUMN "google_place_id" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "places" ADD COLUMN "google_matched_at" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "places" DROP COLUMN "google_matched_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "places" DROP COLUMN "google_place_id"`,
    );
  }
}
