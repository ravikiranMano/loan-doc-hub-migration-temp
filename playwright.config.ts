import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, 'e2e', '.env.e2e') });
dotenv.config({ path: path.join(__dirname, 'e2e', '.env.e2e.local'), override: true });

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:8080';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'setup-admin', testMatch: /admin\.auth\.setup\.ts/ },
    { name: 'setup-csr', testMatch: /csr\.auth\.setup\.ts/ },

    {
      name: 'chromium-admin',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/admin.json',
      },
      dependencies: ['setup-admin'],
      testIgnore: [
        /\.setup\.ts/,
        /role-guards\.spec\.ts/,
        /unauthenticated\.spec\.ts/,
        /\/csr\//,
        /documents-generate\.spec\.ts/,
      ],
    },
    {
      name: 'chromium-csr',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/csr.json',
      },
      dependencies: ['setup-csr'],
      testIgnore: [
        /\.setup\.ts/,
        /\/admin\//,
        /unauthenticated\.spec\.ts/,
        /role-guards\.spec\.ts/,
        /smoke\/dashboard\.spec\.ts/,
        /smoke\/implemented-routes\.spec\.ts/,
      ],
    },
    {
      name: 'chromium-admin-slow',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/admin.json',
      },
      dependencies: ['setup-admin'],
      testMatch: [/documents-generate\.spec\.ts/],
      timeout: 180_000,
    },
    {
      name: 'chromium-guest',
      use: { ...devices['Desktop Chrome'] },
      testMatch: [/unauthenticated\.spec\.ts/, /role-guards\.spec\.ts/],
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
