/**
 * Shared test helpers for CCT Playwright tests
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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cct-test-'));
  return {
    ...process.env,
    CCT_COMMAND: process.env.SHELL || '/bin/zsh',
    CCT_USER_DATA: userData,
    ...extra,
  };
}

module.exports = { appPath, launchEnv };
