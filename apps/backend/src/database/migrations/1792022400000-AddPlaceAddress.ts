import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Địa chỉ riêng của Rong cho địa điểm; địa chỉ Google vẫn chỉ được tải trực tiếp. */
export class AddPlaceAddress1792022400000 implements MigrationInterface {
  name = 'AddPlaceAddress1792022400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "places" ADD COLUMN "address" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "places" DROP COLUMN "address"`);
  }
}
