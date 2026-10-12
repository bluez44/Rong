import type { MigrationInterface, QueryRunner } from 'typeorm';

/** "Muốn đi" lưu từ ô tìm địa điểm trong màn vùng: nguồn `'search'`. */
export class AllowSearchSavedSource1759500000000 implements MigrationInterface {
  name = 'AllowSearchSavedSource1759500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "saved_places"
        DROP CONSTRAINT "chk_saved_place_source",
        ADD CONSTRAINT "chk_saved_place_source" CHECK ("source" IN ('manual', 'share', 'search'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "saved_places" SET "source" = 'manual' WHERE "source" = 'search'`);
    await queryRunner.query(`
      ALTER TABLE "saved_places"
        DROP CONSTRAINT "chk_saved_place_source",
        ADD CONSTRAINT "chk_saved_place_source" CHECK ("source" IN ('manual', 'share'))
    `);
  }
}
