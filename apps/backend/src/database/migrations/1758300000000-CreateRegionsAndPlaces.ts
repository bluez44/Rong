import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Vùng (tỉnh cũ/mới, điểm đến, xã/phường) và danh mục địa điểm riêng — S2, F1.
 *
 * Ranh giới và tọa độ là PostGIS geometry SRID 4326, lấy từ OpenStreetMap
 * (không bao giờ từ Google — PRD 7.4 nguyên tắc 3). Địa điểm không gắn cứng
 * vào vùng: "địa điểm thuộc vùng" được tính bằng ST_Covers lúc truy vấn, nên
 * một địa điểm tự động thuộc cả vùng cũ lẫn vùng mới chứa nó (FR-1.9).
 */
export class CreateRegionsAndPlaces1758300000000 implements MigrationInterface {
  name = 'CreateRegionsAndPlaces1758300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(
      `CREATE TYPE "region_type" AS ENUM ('administrative', 'destination')`,
    );
    await queryRunner.query(
      `CREATE TYPE "boundary_version" AS ENUM ('pre_merger', 'current')`,
    );
    await queryRunner.query(
      `CREATE TYPE "administrative_level" AS ENUM ('province', 'ward')`,
    );

    await queryRunner.query(`
      CREATE TABLE "regions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "source_key" text NOT NULL,
        "name" text NOT NULL,
        "type" "region_type" NOT NULL,
        "boundary_version" "boundary_version" NOT NULL,
        "level" "administrative_level",
        "parent_id" uuid,
        "former_parent_id" uuid,
        "successor_region_id" uuid,
        "merge_note" text,
        "search_name" text NOT NULL,
        "boundary_source" jsonb,
        "center" geometry(Point, 4326),
        "boundary" geometry(MultiPolygon, 4326),
        "boundary_fetched_at" timestamptz,
        "places_fetched_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_region_source_key" UNIQUE ("source_key"),
        CONSTRAINT "fk_region_parent" FOREIGN KEY ("parent_id")
          REFERENCES "regions" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_region_former_parent" FOREIGN KEY ("former_parent_id")
          REFERENCES "regions" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_region_successor" FOREIGN KEY ("successor_region_id")
          REFERENCES "regions" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_region_search_name" ON "regions" USING gin ("search_name" gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_region_boundary" ON "regions" USING gist ("boundary")`,
    );

    await queryRunner.query(`
      CREATE TABLE "region_aliases" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "region_id" uuid NOT NULL,
        "alias" text NOT NULL,
        "search_alias" text NOT NULL,
        CONSTRAINT "uq_region_alias" UNIQUE ("region_id", "search_alias"),
        CONSTRAINT "fk_region_alias_region" FOREIGN KEY ("region_id")
          REFERENCES "regions" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_region_alias_search" ON "region_aliases" USING gin ("search_alias" gin_trgm_ops)`,
    );

    await queryRunner.query(`
      CREATE TYPE "place_category" AS ENUM
        ('check_in', 'food', 'cafe', 'nature', 'kids', 'culture', 'nightlife', 'stay')
    `);
    await queryRunner.query(`
      CREATE TABLE "places" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "osm_type" text NOT NULL,
        "osm_id" bigint NOT NULL,
        "name" text NOT NULL,
        "category" "place_category" NOT NULL,
        "location" geometry(Point, 4326) NOT NULL,
        "tags" jsonb NOT NULL DEFAULT '{}',
        "wikidata_id" text,
        "sitelinks" integer,
        "description" text,
        "composite_score" smallint NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_place_osm" UNIQUE ("osm_type", "osm_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_place_location" ON "places" USING gist ("location")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_place_score" ON "places" ("composite_score", "id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "places"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "place_category"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "region_aliases"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "regions"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "administrative_level"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "boundary_version"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "region_type"`);
  }
}
