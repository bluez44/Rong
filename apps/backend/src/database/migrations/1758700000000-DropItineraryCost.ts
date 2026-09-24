import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tạm bỏ ước tính chi phí (F7) khỏi lịch trình: chưa có dữ liệu giá thật, bảng
 * giá mặc định chỉ là số tham khảo. Làm lại khi có dữ liệu giá curate/cộng đồng.
 */
export class DropItineraryCost1758700000000 implements MigrationInterface {
  name = 'DropItineraryCost1758700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "itineraries" DROP COLUMN "cost"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "itineraries" ADD COLUMN "cost" jsonb NOT NULL DEFAULT '{}'`,
    );
  }
}
