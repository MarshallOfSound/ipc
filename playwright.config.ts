import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: ['**/test-app/**'],
  timeout: 15000,
  projects: [
    {
      name: 'sandbox-off',
      use: {
        trace: 'on-first-retry',
      },
    },
    {
      name: 'sandbox-on',
      use: {
        trace: 'on-first-retry',
      },
    },
    {
      name: 'sandbox-off-cjs',
      use: {
        trace: 'on-first-retry',
      },
    },
  ],
});
