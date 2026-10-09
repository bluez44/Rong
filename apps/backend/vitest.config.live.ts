import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/** Đo tốc độ với dịch vụ ngoài thật (`pnpm bench:places`), xem test/places.live-spec.ts. */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.live-spec.ts'],
  },
});
