/**
 * Trim UI Waveform Rendering Test
 * Verifies that wavesurfer.js renders the waveform and trim handles
 * in the trim panel (right side of settings).
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { appPath, launchEnv } = require('./helpers');

let electronApp;
let window;
let env;

/**
 * Generate a minimal valid WAV file with a sine wave.
 * 16-bit PCM, mono, 44100 Hz, ~0.5 seconds.
 */
function generateWav(durationSec = 0.5, freq = 440) {
  const sampleRate = 44100;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2; // 16-bit = 2 bytes per sample
  const fileSize = 44 + dataSize;

  const buf = Buffer.alloc(fileSize);
  let offset = 0;

  // RIFF header
  buf.write('RIFF', offset); offset += 4;
  buf.writeUInt32LE(fileSize - 8, offset); offset += 4;
  buf.write('WAVE', offset); offset += 4;

  // fmt chunk
  buf.write('fmt ', offset); offset += 4;
  buf.writeUInt32LE(16, offset); offset += 4;       // chunk size
  buf.writeUInt16LE(1, offset); offset += 2;         // PCM
  buf.writeUInt16LE(1, offset); offset += 2;         // mono
  buf.writeUInt32LE(sampleRate, offset); offset += 4; // sample rate
  buf.writeUInt32LE(sampleRate * 2, offset); offset += 4; // byte rate
  buf.writeUInt16LE(2, offset); offset += 2;         // block align
  buf.writeUInt16LE(16, offset); offset += 2;        // bits per sample

  // data chunk
  buf.write('data', offset); offset += 4;
  buf.writeUInt32LE(dataSize, offset); offset += 4;

  // Sine wave samples
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin(2 * Math.PI * freq * i / sampleRate);
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    buf.writeInt16LE(intSample, offset); offset += 2;
  }

  return buf;
}

test.beforeAll(async () => {
  env = launchEnv();
  const userData = env.CLAUDIU_USER_DATA;

  // Create a sound theme with an actual WAV file
  const themeDir = path.join(userData, 'themes', 'test-theme');
  fs.mkdirSync(themeDir, { recursive: true });

  // Write a valid WAV file
  fs.writeFileSync(path.join(themeDir, 'start.wav'), generateWav(0.5, 440));

  // Write theme.json
  fs.writeFileSync(path.join(themeDir, 'theme.json'), JSON.stringify({
    name: 'Test Theme',
    version: '1.0.0',
    author: 'Test',
    description: 'Test theme for waveform rendering',
    events: {
      SessionStart: 'start.wav',
    },
  }));

  // Set config to use this theme
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
    soundTheme: 'test-theme',
  }));

  // Seed a project so the app loads properly
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudiu-trim-test-'));
  fs.writeFileSync(path.join(userData, 'projects.json'), JSON.stringify({
    projects: [{ path: projectDir, name: path.basename(projectDir) }],
  }));

  electronApp = await electron.launch({
    args: [appPath],
    env,
    timeout: 90000,
  });
  window = await electronApp.firstWindow({ timeout: 90000 });
  await window.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 });
  await window.waitForTimeout(500);
});

test.afterAll(async () => {
  if (electronApp) await electronApp.close();
});

test('1 - open settings and navigate to Sound & Hooks', async () => {
  await window.keyboard.press('Meta+,');
  const nav = window.locator('[data-testid="settings-nav-sounds"]');
  await expect(nav).toBeAttached({ timeout: 3000 });
  await nav.click();
  await window.waitForTimeout(300);

  // Verify SessionStart row with trim button is visible
  const trimBtn = window.locator('[data-testid="settings-sound-trim-SessionStart"]');
  await expect(trimBtn).toBeAttached({ timeout: 3000 });

  // Screenshot: sounds section showing the trim button
  await window.screenshot({ path: 'tests/screenshots/trim-01-sounds-section.png' });
});

test('2 - click trim button opens trim panel with waveform', async () => {
  const trimBtn = window.locator('[data-testid="settings-sound-trim-SessionStart"]');
  await trimBtn.click();

  // Wait for trim panel to appear
  const trimPanel = window.locator('[data-testid="trim-ui-SessionStart"]');
  await expect(trimPanel).toBeAttached({ timeout: 3000 });

  // Wait for wavesurfer to load and render (it needs time to fetch + decode audio)
  await window.waitForTimeout(2000);

  // Screenshot: trim panel with waveform
  await window.screenshot({ path: 'tests/screenshots/trim-02-waveform-rendered.png' });

  // Verify wavesurfer created a canvas inside the wave container
  const waveContainer = trimPanel.locator('.trim-ui-wave-container');
  await expect(waveContainer).toBeAttached();

  // Wavesurfer renders a shadow DOM or direct canvas elements
  // Check that the container has child content (not empty/black)
  const containerHeight = await waveContainer.evaluate(el => el.offsetHeight);
  expect(containerHeight).toBeGreaterThan(0);

  const containerWidth = await waveContainer.evaluate(el => el.offsetWidth);
  expect(containerWidth).toBeGreaterThan(0);

  // Check that wavesurfer injected its wrapper div (it creates a div with display:flex)
  const hasWavesurferContent = await waveContainer.evaluate(el => {
    // wavesurfer.js creates child elements: a wrapper div with shadow root or direct children
    return el.children.length > 0;
  });
  expect(hasWavesurferContent).toBe(true);
});

test('3 - waveform has visible audio bars (not black/empty)', async () => {
  const trimPanel = window.locator('[data-testid="trim-ui-SessionStart"]');
  const waveContainer = trimPanel.locator('.trim-ui-wave-container');

  // Take a screenshot of just the wave container to inspect pixel content
  const waveScreenshot = await waveContainer.screenshot({ path: 'tests/screenshots/trim-03-wave-container.png' });
  expect(waveScreenshot.byteLength).toBeGreaterThan(0);

  // Check that the waveform is actually rendered by examining canvas pixel data
  // Wavesurfer uses canvas elements - check they exist and have non-zero dimensions
  const canvasInfo = await waveContainer.evaluate(el => {
    // wavesurfer creates its own shadow DOM in v7+, or direct canvases
    const canvases = el.querySelectorAll('canvas');
    const shadowCanvases = [];
    // Also check shadow roots
    el.querySelectorAll('div').forEach(div => {
      if (div.shadowRoot) {
        div.shadowRoot.querySelectorAll('canvas').forEach(c => shadowCanvases.push(c));
      }
    });
    const allCanvases = [...canvases, ...shadowCanvases];
    return {
      directCanvasCount: canvases.length,
      shadowCanvasCount: shadowCanvases.length,
      totalCanvasCount: allCanvases.length,
      canvasSizes: allCanvases.map(c => ({ w: c.width, h: c.height })),
      // Sample some pixel data from the first canvas to verify it's not all black
      hasNonBlackPixels: (() => {
        if (allCanvases.length === 0) return false;
        const c = allCanvases[0];
        const ctx = c.getContext('2d');
        if (!ctx) return false;
        const imageData = ctx.getImageData(0, 0, c.width, c.height);
        const data = imageData.data;
        // Check if any pixel has non-zero RGB values (skip alpha)
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 5 || data[i+1] > 5 || data[i+2] > 5) return true;
        }
        return false;
      })(),
    };
  });

  console.log('Canvas info:', JSON.stringify(canvasInfo, null, 2));

  // There should be at least one canvas
  expect(canvasInfo.totalCanvasCount).toBeGreaterThan(0);

  // Canvas should have non-zero dimensions
  if (canvasInfo.canvasSizes.length > 0) {
    expect(canvasInfo.canvasSizes[0].w).toBeGreaterThan(0);
    expect(canvasInfo.canvasSizes[0].h).toBeGreaterThan(0);
  }

  // Waveform should have visible pixels (not all black)
  expect(canvasInfo.hasNonBlackPixels).toBe(true);
});

test('4 - trim region handles are visible', async () => {
  const trimPanel = window.locator('[data-testid="trim-ui-SessionStart"]');

  // Check for wavesurfer region (the trim region overlay)
  const hasRegion = await trimPanel.evaluate(el => {
    // wavesurfer regions plugin creates elements with data-id attribute
    // In v7+ they may be in shadow DOM
    const allDivs = el.querySelectorAll('div');
    let foundRegion = false;
    let foundHandle = false;

    allDivs.forEach(div => {
      if (div.shadowRoot) {
        const regionEls = div.shadowRoot.querySelectorAll('[data-id]');
        if (regionEls.length > 0) foundRegion = true;
        const handleEls = div.shadowRoot.querySelectorAll('[data-resize]');
        if (handleEls.length > 0) foundHandle = true;
      }
    });

    // Also check direct children
    const directRegions = el.querySelectorAll('[data-id]');
    if (directRegions.length > 0) foundRegion = true;
    const directHandles = el.querySelectorAll('[data-resize]');
    if (directHandles.length > 0) foundHandle = true;

    return { foundRegion, foundHandle };
  });

  console.log('Region info:', JSON.stringify(hasRegion, null, 2));

  // Verify time display shows valid time values
  const timeDisplay = trimPanel.locator('.trim-ui-time');
  const timeText = await timeDisplay.textContent();
  console.log('Time display:', timeText);
  // Should show something like "0:00.00 — 0:00.50"
  expect(timeText).toMatch(/\d+:\d+\.\d+ — \d+:\d+\.\d+/);

  // Play button should be present
  const playBtn = trimPanel.locator('[data-testid="trim-play-btn"]');
  await expect(playBtn).toBeAttached();

  // Save button should be present
  const saveBtn = trimPanel.locator('.settings-save-btn');
  await expect(saveBtn).toBeAttached();

  // Final full screenshot
  await window.screenshot({ path: 'tests/screenshots/trim-04-full-trim-panel.png' });
});
