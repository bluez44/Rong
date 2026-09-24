import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Thay polygon ranh giới bằng khung bao (bbox) 4 số. Địa điểm của một vùng là
 * các địa điểm nằm trong khung này — đơn giản hơn, không phải tải và ghép
 * hình học ranh giới từ OSM.
 *
 * `boundary_source` đổi tên thành `area_source` (cách lấy khung bao); các vùng
 * đã có polygon thì giữ lại khung bao của polygon đó.
 */
export class ReplaceBoundaryWithBbox1758500000000 implements MigrationInterface {
  name = 'ReplaceBoundaryWithBbox1758500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "regions"
        ADD COLUMN "bbox_south" double precision,
        ADD COLUMN "bbox_west" double precision,
        ADD COLUMN "bbox_north" double precision,
        ADD COLUMN "bbox_east" double precision,
        ADD COLUMN "area_fetched_at" timestamptz
    `);
    await queryRunner.query(`
      UPDATE "regions"
         SET bbox_south = ST_YMin(boundary), bbox_west = ST_XMin(boundary),
             bbox_north = ST_YMax(boundary), bbox_east = ST_XMax(boundary),
             area_fetched_at = boundary_fetched_at
       WHERE boundary IS NOT NULL
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_region_boundary"`);
    await queryRunner.query(
      `ALTER TABLE "regions" DROP COLUMN "boundary", DROP COLUMN "boundary_fetched_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "regions" RENAME COLUMN "boundary_source" TO "area_source"`,
    );
    // Nguồn cũ "relationId" chỉ dùng để tải polygon; vùng từ Nominatim giờ lưu thẳng bbox lúc nhập.
    await queryRunner.query(
      `UPDATE "regions" SET area_source = area_source - 'relationId' WHERE area_source ? 'relationId'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "regions" RENAME COLUMN "area_source" TO "boundary_source"`,
    );
    await queryRunner.query(`
      ALTER TABLE "regions"
        ADD COLUMN "boundary" geometry(MultiPolygon, 4326),
        ADD COLUMN "boundary_fetched_at" timestamptz
    `);
    await queryRunner.query(`
      UPDATE "regions"
         SET boundary = ST_Multi(ST_MakeEnvelope(bbox_west, bbox_south, bbox_east, bbox_north, 4326)),
             boundary_fetched_at = area_fetched_at
       WHERE bbox_south IS NOT NULL
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_region_boundary" ON "regions" USING gist ("boundary")`,
    );
    await queryRunner.query(`
      ALTER TABLE "regions"
        DROP COLUMN "bbox_south", DROP COLUMN "bbox_west", DROP COLUMN "bbox_north",
        DROP COLUMN "bbox_east", DROP COLUMN "area_fetched_at"
    `);
  }
}
