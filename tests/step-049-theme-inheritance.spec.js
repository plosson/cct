/**
 * Step 049 — Dark / Light theme inheritance
 * Verifies that all UI elements properly adapt to the current theme.
 * Elements should never appear pitch black in light mode or pitch white in dark mode.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const { appPath, launchEnv, closeApp } = require('./helpers');

let electronApp;
let window;

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: [appPath],
    env: launchEnv(),
    timeout: 90000,
  });
  window = await electronApp.firstWindow({ timeout: 90000 });
  await window.waitForSelector('.app', { timeout: 15000 });
  await window.waitForTimeout(500);
});

test.afterAll(async () => {
  await closeApp(electronApp);
});

/**
 * Helper: parse a CSS color string to { r, g, b, a }.
 * Handles rgb(), rgba(), and hex.
 */
function parseColor(str) {
  const rgbaMatch = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1]),
      g: parseInt(rgbaMatch[2]),
      b: parseInt(rgbaMatch[3]),
      a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1,
    };
  }
  return null;
}

/** True if the color is very dark (near black) */
function isNearBlack(color) {
  if (!color || color.a === 0) return false;
  return color.r < 40 && color.g < 40 && color.b < 40;
}

/** True if the color is very light (near white) */
function isNearWhite(color) {
  if (!color || color.a === 0) return false;
  return color.r > 220 && color.g > 220 && color.b > 220;
}

// ── LIGHT THEME TESTS ──────────────────────────────────────────

test('1 - set light theme', async () => {
  await window.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
  });
  await window.waitForTimeout(200);
});

test('2 - sidebar resize handle not pitch black in light mode', async () => {
  const handle = window.locator('.sidebar-resize-handle');
  await expect(handle).toBeAttached();

  const bg = await handle.evaluate((el) => getComputedStyle(el).backgroundColor);
  const color = parseColor(bg);
  // Should be transparent or theme-appropriate, not near-black
  expect(
    !color || color.a === 0 || !isNearBlack(color)
  ).toBe(true);
});

test('3 - sidebar resize handle hover color adapts to light theme', async () => {
  const hoverBg = await window.evaluate(() => {
    // Check the CSS rule for .sidebar-resize-handle:hover
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText && rule.selectorText.includes('sidebar-resize-handle') &&
              (rule.selectorText.includes(':hover') || rule.selectorText.includes('.dragging'))) {
            return rule.style.background || rule.style.backgroundColor;
          }
        }
      } catch {}
    }
    return '';
  });
  // Should reference a CSS variable, not a hardcoded dark color
  expect(hoverBg).toContain('--border-strong');
});

test('4 - notes resize handle not pitch black in light mode', async () => {
  const handle = window.locator('.notes-resize-handle');
  if (await handle.count() === 0) {
    test.skip();
    return;
  }
  const bg = await handle.evaluate((el) => getComputedStyle(el).backgroundColor);
  const color = parseColor(bg);
  expect(!color || color.a === 0 || !isNearBlack(color)).toBe(true);
});

test('5 - debug pane resize handle not pitch black in light mode', async () => {
  const handle = window.locator('.debug-pane-resize-handle');
  if (await handle.count() === 0) {
    test.skip();
    return;
  }
  const bg = await handle.evaluate((el) => getComputedStyle(el).backgroundColor);
  const color = parseColor(bg);
  expect(!color || color.a === 0 || !isNearBlack(color)).toBe(true);
});

test('6 - status bar adapts to light theme', async () => {
  const bar = window.locator('.status-bar');
  await expect(bar).toBeAttached();
  const bg = await bar.evaluate((el) => getComputedStyle(el).backgroundColor);
  const color = parseColor(bg);
  // In light mode, bg-surface is #e8e8ec — should NOT be near-black
  expect(!color || !isNearBlack(color)).toBe(true);
});

test('7 - titlebar adapts to light theme', async () => {
  const titlebar = window.locator('.titlebar-drag-region');
  await expect(titlebar).toBeAttached();
  const bg = await titlebar.evaluate((el) => getComputedStyle(el).backgroundColor);
  const color = parseColor(bg);
  expect(!color || !isNearBlack(color)).toBe(true);
});

test('8 - sidebar adapts to light theme', async () => {
  const sidebar = window.locator('.sidebar');
  await expect(sidebar).toBeAttached();
  const bg = await sidebar.evaluate((el) => getComputedStyle(el).backgroundColor);
  const color = parseColor(bg);
  expect(!color || !isNearBlack(color)).toBe(true);
});

test('9 - app-body has theme background (prevents dark bleed-through on resize handles)', async () => {
  // The app-body must have a background so transparent children (resize handles)
  // don't show the dark Electron native window backing
  const bg = await window.evaluate(() => {
    const el = document.querySelector('.app-body');
    return getComputedStyle(el).backgroundColor;
  });
  const color = parseColor(bg);
  expect(color).not.toBeNull();
  // Must be opaque (or semi-transparent) AND light in light mode
  expect(color.a).toBeGreaterThan(0);
  expect(isNearBlack(color)).toBe(false);
});

test('9b - main-content-row has theme background for notes resize handle', async () => {
  const bg = await window.evaluate(() => {
    const el = document.querySelector('.main-content-row');
    if (!el) return null;
    return getComputedStyle(el).backgroundColor;
  });
  if (bg === null) { test.skip(); return; }
  const color = parseColor(bg);
  // Either has a proper light background or inherits from app-body
  expect(!color || color.a === 0 || !isNearBlack(color)).toBe(true);
});

// ── DARK THEME TESTS ──────────────────────────────────────────

test('10 - set dark theme', async () => {
  await window.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await window.waitForTimeout(200);
});

test('11 - sidebar resize handle not pitch white in dark mode', async () => {
  const handle = window.locator('.sidebar-resize-handle');
  const bg = await handle.evaluate((el) => getComputedStyle(el).backgroundColor);
  const color = parseColor(bg);
  expect(!color || color.a === 0 || !isNearWhite(color)).toBe(true);
});

test('12 - status bar adapts to dark theme', async () => {
  const bar = window.locator('.status-bar');
  const bg = await bar.evaluate((el) => getComputedStyle(el).backgroundColor);
  const color = parseColor(bg);
  // In dark mode, should NOT be near-white
  expect(!color || !isNearWhite(color)).toBe(true);
});

test('13 - titlebar adapts to dark theme', async () => {
  const titlebar = window.locator('.titlebar-drag-region');
  const bg = await titlebar.evaluate((el) => getComputedStyle(el).backgroundColor);
  const color = parseColor(bg);
  expect(!color || !isNearWhite(color)).toBe(true);
});

test('14 - all theme token CSS variables resolve in light mode', async () => {
  await window.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
  });
  await window.waitForTimeout(100);

  const missing = await window.evaluate(() => {
    const vars = [
      '--bg-app', '--bg-surface', '--bg-overlay', '--bg-deep',
      '--border', '--border-strong',
      '--text-primary', '--text-secondary', '--text-dim', '--text-faint',
      '--hover-bg', '--active-bg',
    ];
    const style = getComputedStyle(document.documentElement);
    return vars.filter(v => !style.getPropertyValue(v).trim());
  });
  expect(missing).toEqual([]);
});

test('15 - all theme token CSS variables resolve in dark mode', async () => {
  await window.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await window.waitForTimeout(100);

  const missing = await window.evaluate(() => {
    const vars = [
      '--bg-app', '--bg-surface', '--bg-overlay', '--bg-deep',
      '--border', '--border-strong',
      '--text-primary', '--text-secondary', '--text-dim', '--text-faint',
      '--hover-bg', '--active-bg',
    ];
    const style = getComputedStyle(document.documentElement);
    return vars.filter(v => !style.getPropertyValue(v).trim());
  });
  expect(missing).toEqual([]);
});
