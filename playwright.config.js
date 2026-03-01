// @ts-check
const { defineConfig } = require('@playwright/test');

// Hide the Electron window during tests
process.env.CCT_HEADLESS = '1';

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  workers: 1, // Electron single-instance lock prevents parallel app launches
  use: {
    trace: 'on-first-retry',
  },
});
