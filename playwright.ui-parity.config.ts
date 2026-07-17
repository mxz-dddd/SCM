import { defineConfig } from '@playwright/test';

export default defineConfig({
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.005,
      threshold: 0.2,
    },
  },
  fullyParallel: false,
  outputDir: 'artifacts/ui-parity/playwright-results',
  reporter: [
    ['list'],
    [
      'html',
      { open: 'never', outputFolder: 'artifacts/ui-parity/playwright-report' },
    ],
  ],
  // Browser text rasterization is OS-specific. Keep reviewed baselines per
  // platform so CI compares Linux-to-Linux without relaxing pixel thresholds.
  snapshotPathTemplate:
    '{testDir}/{testFilePath}-snapshots/{platform}/{arg}{ext}',
  testDir: './tests/ui-parity',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:5200',
    colorScheme: 'light',
    locale: 'zh-CN',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { height: 900, width: 1440 },
  },
  webServer: {
    command: 'pnpm --filter @scm/web exec vite --host 127.0.0.1 --port 5200',
    env: {
      ...process.env,
      VITE_API_PROXY_TARGET: 'http://127.0.0.1:3200',
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: 'http://127.0.0.1:5200/workbench',
  },
  workers: 1,
});
