import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { env } from './src/config/env';

export default defineConfig({
  testDir: './src',
  outputDir: './test-results',
  fullyParallel: false,
  forbidOnly: !!env.CI,
  retries: env.CI ? 2 : 0,
  workers: 1,
  timeout: 90_000,
  grep: env.E2E_GREP ? new RegExp(env.E2E_GREP) : undefined,
  grepInvert: env.E2E_GREP_INVERT ? new RegExp(env.E2E_GREP_INVERT) : undefined,
  reporter: env.CI
    ? [
        ['list'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
        ['junit', { outputFile: 'test-results/junit.xml' }],
      ]
    : [['html', { outputFolder: 'playwright-report' }], ['list']],
  use: {
    baseURL: env.BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /setup\/auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.join(__dirname, 'src/.auth/session.json'),
      },
      dependencies: ['setup'],
      testIgnore: /setup\/auth\.setup\.ts/,
    },
  ],

  webServer: {
    command: 'cd ../.. && bun run dev:all',
    url: env.BASE_URL,
    reuseExistingServer: !env.CI,
    timeout: 120_000,
  },
});
