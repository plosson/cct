/**
 * Shared test helpers for Claudiu Playwright tests
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const appPath = path.join(__dirname, '..');

/**
 * Build env object for electron.launch() with an isolated userData dir.
 * Each call creates a unique temp directory so parallel workers don't collide.
 */
function launchEnv(extra = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'claudiu-test-'));
  return {
    ...process.env,
    CLAUDIU_COMMAND: process.env.SHELL || '/bin/zsh',
    CLAUDIU_USER_DATA: userData,
    ...extra,
  };
}

module.exports = { appPath, launchEnv };
