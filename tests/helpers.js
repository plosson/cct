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

/**
 * Show and center the Electron window when CLAUDIU_HEADLESS=0.
 * Call after electronApp.firstWindow() in beforeAll.
 */
async function showWindow(electronApp) {
  if (process.env.CLAUDIU_HEADLESS === '0') {
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) { win.show(); win.center(); }
    });
  }
}

/**
 * Close an Electron app with a hard-kill fallback.
 * Prevents test hangs when electronApp.close() blocks.
 */
async function closeApp(electronApp, timeoutMs = 5000) {
  if (!electronApp) return;
  const pid = electronApp.process().pid;
  const kill = () => { try { process.kill(pid, 'SIGKILL'); } catch {} };
  const timer = setTimeout(kill, timeoutMs);
  try {
    await electronApp.close();
  } catch {
    kill();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { appPath, launchEnv, showWindow, closeApp };
