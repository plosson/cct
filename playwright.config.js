// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  workers: 1, // Electron single-instance lock prevents parallel app launches
  use: {
    trace: 'on-first-retry',
  },
});
