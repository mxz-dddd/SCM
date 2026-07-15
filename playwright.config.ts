import { defineConfig } from '@playwright/test';

const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;

if (!databaseUrl)
  throw new Error('DATABASE_URL is required for Playwright E2E');
if (!jwtSecret) throw new Error('JWT_SECRET is required for Playwright E2E');

export default defineConfig({
  fullyParallel: false,
  reporter: [['list']],
  testDir: './apps/api/e2e',
  testIgnore: 'v2.acceptance.spec.ts',
  timeout: 120_000,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm --dir apps/api dev',
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      JWT_SECRET: jwtSecret,
      PORT: '3100',
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: 'http://127.0.0.1:3100/api/v1/auth/login',
  },
  workers: 1,
});
