import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Đăng nhập bằng Zalo (spec 2026-10-21-google-zalo-login). */
export class AddZaloAuthProvider1792400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "auth_provider" ADD VALUE IF NOT EXISTS 'zalo'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres không xóa được giá trị khỏi enum; để nguyên 'zalo' không ảnh hưởng gì.
  }
}
