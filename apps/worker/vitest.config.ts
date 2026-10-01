import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://bookmarker:bookmarker@localhost:5432/bookmarker_test',
    },
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
