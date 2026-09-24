import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Xác minh email chuyển từ link (token 256 bit) sang mã 6 chữ số. Mã ngắn thì
 * dò được, nên mỗi mã cần đếm số lần nhập sai để khóa lại sau vài lần.
 *
 * Token dạng link cũ (nếu có) không còn khớp cách băm mới, nên xóa luôn: người
 * dùng chưa xác minh chỉ cần bấm "gửi lại mã".
 */
export class AddOneTimeTokenAttempts1758200000000 implements MigrationInterface {
  name = 'AddOneTimeTokenAttempts1758200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "one_time_tokens" WHERE "used_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "one_time_tokens" ADD COLUMN "attempts" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "one_time_tokens" DROP COLUMN "attempts"`,
    );
  }
}
