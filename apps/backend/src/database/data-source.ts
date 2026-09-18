import 'dotenv/config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataSource } from 'typeorm';

import { loadConfig } from '../config/configuration.js';

const config = loadConfig();

/**
 * Thư mục chứa chính file này: `src/database` khi chạy từ mã nguồn, hoặc
 * `dist/database` sau khi build. Nhờ vậy cùng một file dùng được cho cả hai,
 * không cần hai bản data source lệch nhau.
 */
const here = dirname(fileURLToPath(import.meta.url));

/**
 * DataSource dùng cho TypeORM CLI (tạo và chạy migration).
 *
 * `synchronize` luôn tắt: schema chỉ đổi qua migration. Bảng có cột PostGIS
 * không chịu nổi việc TypeORM tự suy ra schema.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: config.database.host,
  port: config.database.port,
  username: config.database.username,
  password: config.database.password,
  database: config.database.database,
  synchronize: false,
  logging: config.nodeEnv === 'development',
  entities: [join(here, '..', 'modules', '**', '*.entity.js')],
  migrations: [join(here, 'migrations', '*.js')],
});

// Chỉ một export DataSource duy nhất: TypeORM CLI từ chối file có nhiều hơn một.
