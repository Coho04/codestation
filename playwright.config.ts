import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  // Electron launches are heavy and the index is shared state; one at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  // The HTML report only exists to be uploaded as a CI artifact; locally the
  // list reporter in the terminal is the whole story.
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : [['list']],
});
