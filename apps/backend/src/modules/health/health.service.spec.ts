import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { describe, expect, it, vi } from 'vitest';

import { HealthService } from './health.service.js';

/**
 * Chạy được mà không cần database thật: DataSource được thay bằng bản giả, nên
 * test này an toàn trong CI và trên máy chưa bật docker.
 */
async function buildService(queryImpl: () => Promise<unknown>) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      HealthService,
      { provide: getDataSourceToken(), useValue: { query: vi.fn(queryImpl) } },
    ],
  }).compile();

  return moduleRef.get(HealthService);
}

describe('HealthService', () => {
  it('báo ok và kèm phiên bản khi PostGIS trả lời', async () => {
    const service = await buildService(async () => [{ version: '3.4 USE_GEOS=1' }]);

    const report = await service.check();

    expect(report.status).toBe('ok');
    expect(report.dependencies.postgis).toEqual({
      status: 'up',
      detail: '3.4 USE_GEOS=1',
    });
  });

  it('báo degraded thay vì ném lỗi khi không hỏi được PostGIS', async () => {
    const service = await buildService(async () => {
      throw new Error('extension "postgis" chưa được cài');
    });

    const report = await service.check();

    expect(report.status).toBe('degraded');
    expect(report.dependencies.postgis.status).toBe('down');
    expect(report.dependencies.postgis.detail).toContain('postgis');
  });
});
