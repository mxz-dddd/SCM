import { defineConfig } from '@playwright/test';

export default defineConfig({
  fullyParallel: false,
  outputDir: 'artifacts/v2/playwright-results',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'artifacts/v2/playwright-report' }],
  ],
  testDir: './apps/api/e2e',
  testMatch: 'v2.acceptance.spec.ts',
  timeout: 120_000,
  use: {
    baseURL: process.env.V2_API_URL ?? 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
  },
  workers: 1,
});
