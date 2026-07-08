import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    // Fake R2 credentials so the upload routes exercise fully — presigning is
    // a local HMAC computation, no network involved. The unconfigured 503
    // path is covered separately (adminUploads.unconfigured.test.ts).
    env: {
      R2_ACCOUNT_ID: 'testaccount',
      R2_ACCESS_KEY_ID: 'testkey',
      R2_SECRET_ACCESS_KEY: 'testsecret',
      R2_BUCKET: 'test-bucket',
      R2_PUBLIC_BASE_URL: 'https://pub-test.r2.dev',
    },
    // Only run source tests. Without this, a prior `tsc` build can leave compiled
    // *.test.js in dist/ that vitest would run a second time, colliding on the shared DB.
    exclude: ['**/node_modules/**', '**/dist/**'],
    // All test files share one real Postgres and several do table-wide DELETEs
    // (observations.test.ts on observations, admin.test.ts on the admin_* tables).
    // Running files sequentially removes that class of cross-file race outright.
    fileParallelism: false,
  },
});
