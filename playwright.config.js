// @ts-check
const { defineConfig } = require('@playwright/test');
const { execSync } = require('child_process');

// Hide the Electron window during tests (override with CLAUDIU_HEADLESS=0)
if (process.env.CLAUDIU_HEADLESS === undefined) {
  process.env.CLAUDIU_HEADLESS = '1';
}

// Disable macOS window restoration to suppress "unexpectedly quit" dialog
if (process.platform === 'darwin') {
  try {
    execSync('defaults write com.github.Electron NSQuitAlwaysKeepsWindows -bool false');
    execSync('defaults write com.github.Electron ApplePersistenceIgnoreState -bool true');
  } catch {}
}

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  workers: 10,
  use: {
    trace: 'on-first-retry',
  },
});
