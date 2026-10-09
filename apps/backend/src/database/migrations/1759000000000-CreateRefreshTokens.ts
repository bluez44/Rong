import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Refresh token (F11): giữ đăng nhập tới 60 ngày mà access token vẫn chỉ sống
 * 15 phút. Mỗi lần dùng, token cũ bị đánh dấu `used_at` và một token mới cùng
 * `family_id` được cấp. Token đã dùng mà bị đưa ra lần nữa là dấu hiệu bị lộ:
 * cả họ token đó bị thu hồi.
 *
 * Chỉ lưu SHA-256 của token: token là 256 bit ngẫu nhiên nên không dò ngược được.
 */
export class CreateRefreshTokens1759000000000 implements MigrationInterface {
  name = 'CreateRefreshTokens1759000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Database từng chạy bản đầu của plan S1 có thể còn bảng refresh_tokens cũ
    // (khác cột, không có dữ liệu cần giữ): bỏ đi để tạo đúng cấu trúc mới.
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens"`);
    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "family_id" uuid NOT NULL,
        "token_hash" text NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "used_at" timestamptz,
        "revoked_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_refresh_token_hash" UNIQUE ("token_hash"),
        CONSTRAINT "fk_refresh_token_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_token_family" ON "refresh_tokens" ("family_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_token_user" ON "refresh_tokens" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens"`);
  }
}
