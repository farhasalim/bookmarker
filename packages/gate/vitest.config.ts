import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://bookmarker:bookmarker@localhost:5432/bookmarker_test',
    },
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: { lines: 80, functions: 80, branches: 75 },
    },
  },
});
