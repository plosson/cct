// @ts-check
const { defineConfig } = require('@playwright/test');

// Hide the Electron window during tests
process.env.CCT_HEADLESS = '1';

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  workers: 4,
  use: {
    trace: 'on-first-retry',
  },
});
