import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Xác minh email chuyển từ link (token 256 bit) sang mã 6 chữ số. Mã ngắn thì
 * dò được, nên mỗi mã cần đếm số lần nhập sai để khóa lại sau vài lần.
 *
 * Token dạng link cũ (nếu có) không còn khớp cách băm mới, nên xóa luôn: người
 * dùng chưa xác minh chỉ cần bấm "gửi lại mã".
 *
 * Database từng chạy bản `CreateUsersAndAuth1758100000000` trong plan S1 (cùng
 * tên nhưng tạo `refresh_tokens` thay vì `one_time_tokens`) sẽ bị TypeORM coi
 * là đã chạy bản hiện tại. Vì vậy migration này tự tạo những gì còn thiếu và
 * đổi tên khóa ngoại cho khớp entity, thay vì bắt phải xóa database.
 */
export class AddOneTimeTokenAttempts1758200000000 implements MigrationInterface {
  name = 'AddOneTimeTokenAttempts1758200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF to_regtype('one_time_token_purpose') IS NULL THEN
          CREATE TYPE "one_time_token_purpose" AS ENUM ('email_verification', 'password_reset');
        END IF;
      END $$
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "one_time_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "identity_id" uuid NOT NULL,
        "purpose" "one_time_token_purpose" NOT NULL,
        "token_hash" text NOT NULL UNIQUE,
        "expires_at" timestamptz NOT NULL,
        "used_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_one_time_token_identity"
          FOREIGN KEY ("identity_id") REFERENCES "auth_identities" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_one_time_token_identity" ON "one_time_tokens" ("identity_id", "purpose")`,
    );

    // Bản plan để Postgres tự đặt tên khóa ngoại; entity dùng tên cố định.
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auth_identities_user_id_fkey') THEN
          ALTER TABLE "auth_identities"
            RENAME CONSTRAINT "auth_identities_user_id_fkey" TO "fk_identity_user";
        END IF;
      END $$
    `);

    await queryRunner.query(
      `DELETE FROM "one_time_tokens" WHERE "used_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "one_time_tokens" ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "one_time_tokens" DROP COLUMN "attempts"`,
    );
  }
}
