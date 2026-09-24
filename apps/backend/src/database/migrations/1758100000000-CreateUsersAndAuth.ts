import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bảng người dùng và xác thực — spec S1 mục 3.
 *
 * Enum `auth_provider` khai báo sẵn cả ba giá trị ngay từ đầu, để khi thêm
 * Google/Apple không phải ALTER TYPE trên database đang chạy. Tương tự,
 * `one_time_token_purpose` có sẵn `password_reset` cho luồng quên mật khẩu.
 */
export class CreateUsersAndAuth1758100000000 implements MigrationInterface {
  name = 'CreateUsersAndAuth1758100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "display_name" text,
        "is_guest" boolean NOT NULL DEFAULT false,
        "ai_generations_used" integer NOT NULL DEFAULT 0,
        "ai_quota_period_start" date,
        "last_seen_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_users_guest_last_seen" ON "users" ("is_guest", "last_seen_at")`,
    );

    await queryRunner.query(
      `CREATE TYPE "auth_provider" AS ENUM ('password', 'google', 'apple')`,
    );
    await queryRunner.query(`
      CREATE TABLE "auth_identities" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "provider" "auth_provider" NOT NULL,
        "provider_account_id" text NOT NULL,
        "email" text,
        "email_verified_at" timestamptz,
        "password_hash" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_identity_user"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "uq_identity_provider_account" UNIQUE ("provider", "provider_account_id"),
        CONSTRAINT "chk_password_needs_hash"
          CHECK ("provider" <> 'password' OR "password_hash" IS NOT NULL)
      )
    `);
    // Index thường, KHÔNG unique: một người có thể có hai identity cùng email
    // (một password, một google) — đó chính là cơ chế gắn tài khoản.
    await queryRunner.query(
      `CREATE INDEX "idx_identity_email" ON "auth_identities" ("email")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_identity_user" ON "auth_identities" ("user_id")`,
    );

    await queryRunner.query(
      `CREATE TYPE "one_time_token_purpose" AS ENUM ('email_verification', 'password_reset')`,
    );
    await queryRunner.query(`
      CREATE TABLE "one_time_tokens" (
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
      `CREATE INDEX "idx_one_time_token_identity" ON "one_time_tokens" ("identity_id", "purpose")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "one_time_tokens"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "one_time_token_purpose"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "auth_identities"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "auth_provider"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}
