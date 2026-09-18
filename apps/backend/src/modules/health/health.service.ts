import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface DependencyStatus {
  status: 'up' | 'down';
  /** Chi tiết hữu ích khi up (ví dụ phiên bản PostGIS) hoặc lý do khi down. */
  detail?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  service: string;
  uptimeSeconds: number;
  dependencies: {
    postgis: DependencyStatus;
  };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async check(): Promise<HealthReport> {
    const postgis = await this.checkPostgis();

    return {
      status: postgis.status === 'up' ? 'ok' : 'degraded',
      service: 'rong-backend',
      uptimeSeconds: Math.round(process.uptime()),
      dependencies: { postgis },
    };
  }

  /**
   * Hỏi thẳng phiên bản PostGIS thay vì chỉ ping Postgres.
   *
   * Kết nối được tới database nhưng thiếu extension postgis thì toàn bộ F1 sẽ
   * hỏng, nên đây mới là thứ đáng kiểm tra.
   */
  private async checkPostgis(): Promise<DependencyStatus> {
    try {
      const rows = await this.dataSource.query<{ version: string }[]>(
        'SELECT PostGIS_Version() AS version',
      );
      return { status: 'up', detail: rows[0]?.version };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Kiểm tra PostGIS thất bại: ${message}`);
      return { status: 'down', detail: message };
    }
  }
}
