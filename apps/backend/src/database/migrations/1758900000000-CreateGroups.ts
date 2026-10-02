import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Nhóm & chia sẻ — F10, spec S8. Token link mời và link xem chỉ lưu SHA-256.
 * Xóa tài khoản dựa hoàn toàn vào khóa ngoại (spec S8 mục 6): nhóm của owner
 * bị xóa theo, lịch trình trong nhóm trở thành lịch trình cá nhân.
 */
export class CreateGroups1758900000000 implements MigrationInterface {
  name = 'CreateGroups1758900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "groups" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" text NOT NULL,
        "owner_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_group_owner" FOREIGN KEY ("owner_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "group_members" (
        "group_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "role" text NOT NULL,
        "joined_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_group_member" PRIMARY KEY ("group_id", "user_id"),
        CONSTRAINT "chk_group_member_role" CHECK ("role" IN ('owner', 'editor', 'viewer')),
        CONSTRAINT "fk_group_member_group" FOREIGN KEY ("group_id")
          REFERENCES "groups" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_group_member_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_group_member_user" ON "group_members" ("user_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "group_invites" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "group_id" uuid NOT NULL,
        "token_hash" text NOT NULL,
        "role" text NOT NULL,
        "created_by" uuid,
        "expires_at" timestamptz NOT NULL,
        "revoked_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_group_invite_token" UNIQUE ("token_hash"),
        CONSTRAINT "chk_group_invite_role" CHECK ("role" IN ('editor', 'viewer')),
        CONSTRAINT "fk_group_invite_group" FOREIGN KEY ("group_id")
          REFERENCES "groups" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_group_invite_creator" FOREIGN KEY ("created_by")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_group_invite_group" ON "group_invites" ("group_id")`,
    );
    await queryRunner.query(`
      ALTER TABLE "itineraries" ADD COLUMN "group_id" uuid
        CONSTRAINT "fk_itinerary_group" REFERENCES "groups" ("id") ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_itinerary_group" ON "itineraries" ("group_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "itinerary_share_links" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "itinerary_id" uuid NOT NULL,
        "token_hash" text NOT NULL,
        "created_by" uuid,
        "revoked_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_share_link_token" UNIQUE ("token_hash"),
        CONSTRAINT "fk_share_link_itinerary" FOREIGN KEY ("itinerary_id")
          REFERENCES "itineraries" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_share_link_creator" FOREIGN KEY ("created_by")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_share_link_active" ON "itinerary_share_links" ("itinerary_id") WHERE "revoked_at" IS NULL`,
    );
    await queryRunner.query(`
      CREATE TABLE "group_places" (
        "group_id" uuid NOT NULL,
        "place_id" uuid NOT NULL,
        "region_id" uuid NOT NULL,
        "added_by" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_group_place" PRIMARY KEY ("group_id", "place_id"),
        CONSTRAINT "fk_group_place_group" FOREIGN KEY ("group_id")
          REFERENCES "groups" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_group_place_place" FOREIGN KEY ("place_id")
          REFERENCES "places" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_group_place_region" FOREIGN KEY ("region_id")
          REFERENCES "regions" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_group_place_adder" FOREIGN KEY ("added_by")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "group_activities" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "group_id" uuid NOT NULL,
        "actor_id" uuid,
        "type" text NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_group_activity_group" FOREIGN KEY ("group_id")
          REFERENCES "groups" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_group_activity_actor" FOREIGN KEY ("actor_id")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_group_activity_group_created" ON "group_activities" ("group_id", "created_at" DESC, "id" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "group_activities"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "group_places"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "itinerary_share_links"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_itinerary_group"`);
    await queryRunner.query(
      `ALTER TABLE "itineraries" DROP COLUMN IF EXISTS "group_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "group_invites"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "group_members"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "groups"`);
  }
}
