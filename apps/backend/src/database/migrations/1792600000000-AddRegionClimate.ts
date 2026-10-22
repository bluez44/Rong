import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Khí hậu theo tháng của từng vùng (spec 2026-10-22-trip-weather): tính một lần từ 10 năm ERA5 của Open-Meteo,
 * dùng cho ngày của chuyến nằm ngoài tầm dự báo 16 ngày.
 */
export class AddRegionClimate1792600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "region_climate" (
        "region_id" uuid NOT NULL REFERENCES "regions" ("id") ON DELETE CASCADE,
        "month" smallint NOT NULL,
        "temp_max" real NOT NULL,
        "temp_min" real NOT NULL,
        "rain_day_ratio" real NOT NULL,
        "precipitation_mm" real NOT NULL,
        "computed_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_region_climate" PRIMARY KEY ("region_id", "month"),
        CONSTRAINT "chk_region_climate_month" CHECK ("month" BETWEEN 1 AND 12),
        CONSTRAINT "chk_region_climate_ratio" CHECK ("rain_day_ratio" BETWEEN 0 AND 1)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "region_climate"`);
  }
}
