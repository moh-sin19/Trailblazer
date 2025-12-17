import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4200',
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: {
    command: 'npm start',
    url: 'http://localhost:4200',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
