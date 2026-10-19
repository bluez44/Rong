import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gợi ý lịch trình ở trang chủ (spec 2026-10-19-home-recommendations): sở thích
 * trên server, nơi đã đi, chủ đề riêng, kho bản nháp dùng chung, gợi ý của từng
 * người và ảnh vùng.
 */
export class AddHomeRecommendations1792300000000 implements MigrationInterface {
  name = 'AddHomeRecommendations1792300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "interests" place_category[] NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "itineraries" ADD COLUMN "visit_reviewed_at" timestamptz`,
    );

    await queryRunner.query(`
      CREATE TABLE "visited_places" (
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "place_id" uuid NOT NULL REFERENCES "places"("id") ON DELETE CASCADE,
        "region_id" uuid NOT NULL REFERENCES "regions"("id") ON DELETE CASCADE,
        "status" text NOT NULL CHECK ("status" IN ('inferred', 'confirmed', 'rejected')),
        "itinerary_id" uuid REFERENCES "itineraries"("id") ON DELETE SET NULL,
        "visited_at" timestamptz NOT NULL,
        PRIMARY KEY ("user_id", "place_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_visited_places_user_status" ON "visited_places" ("user_id", "status")`,
    );

    await queryRunner.query(`
      CREATE TABLE "user_themes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "label" text NOT NULL,
        "icon" text NOT NULL,
        "categories" place_category[] NOT NULL,
        "region_ids" uuid[] NOT NULL CHECK (cardinality("region_ids") >= 1),
        "generated_at" timestamptz NOT NULL DEFAULT now(),
        "expires_at" timestamptz NOT NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_user_themes_user" ON "user_themes" ("user_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "itinerary_drafts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "region_id" uuid NOT NULL REFERENCES "regions"("id") ON DELETE CASCADE,
        "pool_key" text NOT NULL,
        "list_version" timestamptz NOT NULL,
        "categories" place_category[] NOT NULL,
        "days_count" smallint NOT NULL,
        "travel_party" text NOT NULL,
        "pace" text NOT NULL,
        "budget_tier" text NOT NULL,
        "input" jsonb NOT NULL,
        "days" jsonb NOT NULL,
        "unscheduled" jsonb NOT NULL DEFAULT '[]',
        "warnings" jsonb NOT NULL DEFAULT '[]',
        "tips" jsonb NOT NULL DEFAULT '[]',
        "cost" jsonb NOT NULL DEFAULT '{}',
        "place_ids" uuid[] NOT NULL,
        "exclude_place_ids" uuid[] NOT NULL DEFAULT '{}',
        "planner" text NOT NULL CHECK ("planner" IN ('heuristic', 'ai')),
        "view_count" integer NOT NULL DEFAULT 0,
        "save_count" integer NOT NULL DEFAULT 0,
        "upgraded_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_itinerary_drafts_pool_key" ON "itinerary_drafts" ("pool_key")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_itinerary_drafts_place_ids" ON "itinerary_drafts" USING GIN ("place_ids")`,
    );

    await queryRunner.query(`
      CREATE TABLE "user_recommendations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "window_start" timestamptz NOT NULL,
        "theme_key" text NOT NULL,
        "slot" smallint NOT NULL CHECK ("slot" BETWEEN 0 AND 2),
        "draft_id" uuid NOT NULL REFERENCES "itinerary_drafts"("id") ON DELETE CASCADE,
        "region_id" uuid NOT NULL REFERENCES "regions"("id") ON DELETE CASCADE,
        "starts_at" timestamptz NOT NULL,
        "params" jsonb NOT NULL,
        "reason" jsonb NOT NULL,
        "score" real NOT NULL,
        "viewed_at" timestamptz,
        "saved_itinerary_id" uuid REFERENCES "itineraries"("id") ON DELETE SET NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_user_recommendation_slot" UNIQUE ("user_id", "window_start", "theme_key", "slot")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_user_recommendations_user_created" ON "user_recommendations" ("user_id", "created_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "region_images" (
        "region_id" uuid PRIMARY KEY REFERENCES "regions"("id") ON DELETE CASCADE,
        "status" text NOT NULL CHECK ("status" IN ('found', 'none')),
        "url" text,
        "width" integer,
        "height" integer,
        "source" text CHECK ("source" IN ('unsplash', 'web')),
        "author" text,
        "author_url" text,
        "source_url" text,
        "license" text,
        "blocked" boolean NOT NULL DEFAULT false,
        "fetched_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "region_images"`);
    await queryRunner.query(`DROP TABLE "user_recommendations"`);
    await queryRunner.query(`DROP TABLE "itinerary_drafts"`);
    await queryRunner.query(`DROP TABLE "user_themes"`);
    await queryRunner.query(`DROP TABLE "visited_places"`);
    await queryRunner.query(
      `ALTER TABLE "itineraries" DROP COLUMN "visit_reviewed_at"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "interests"`);
  }
}
