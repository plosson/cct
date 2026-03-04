# Default Sound Theme Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bundle a default sound theme with the app so sounds work out of the box on first launch.

**Architecture:** A build-time script generates 4 short MP3 tones via ffmpeg into `assets/themes/default/`. On app startup, `SoundThemeService` copies the bundled default theme to `{userData}/themes/default/` if not already present. The config default changes from `'none'` to `'default'`.

**Tech Stack:** ffmpeg (dev-time), Node.js fs (copy at runtime), existing SoundThemeService/ConfigService

---

### Task 1: Create the sound generation script

**Files:**
- Create: `scripts/generate-sounds.js`

**Step 1: Create the script**

```js
/**
 * generate-sounds.js — Generate default theme MP3 files using ffmpeg
 *
 * Run: node scripts/generate-sounds.js
 * Requires: ffmpeg on PATH
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEST = path.join(__dirname, '..', 'assets', 'themes', 'default');

// Each sound: [filename, ffmpeg filter_complex expression, duration]
const sounds = [
  [
    'session-start.mp3',
    // Rising tone: 400Hz → 800Hz over 0.3s
    'sine=frequency=400:duration=0.3,asetrate=44100*2,aresample=44100,afade=t=in:d=0.05,afade=t=out:st=0.2:d=0.1',
    null,
  ],
  [
    'session-end.mp3',
    // Falling tone: 600Hz → 300Hz over 0.3s
    'sine=frequency=600:duration=0.3,asetrate=44100/2,aresample=44100,afade=t=in:d=0.05,afade=t=out:st=0.2:d=0.1',
    null,
  ],
  [
    'task-completed.mp3',
    // Two-note chime: C5 (523Hz) then E5 (659Hz)
    'sine=frequency=523:duration=0.2,afade=t=out:st=0.1:d=0.1[a];sine=frequency=659:duration=0.3,adelay=200|200,afade=t=out:st=0.15:d=0.15[b];[a][b]amix=inputs=2:duration=longest',
    null,
  ],
  [
    'notification.mp3',
    // Short ping at 880Hz (A5)
    'sine=frequency=880:duration=0.15,afade=t=in:d=0.02,afade=t=out:st=0.05:d=0.1',
    null,
  ],
];

fs.mkdirSync(DEST, { recursive: true });

for (const [filename, filter] of sounds) {
  const dest = path.join(DEST, filename);
  console.log(`Generating ${filename}...`);
  execFileSync('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', filter,
    '-codec:a', 'libmp3lame',
    '-b:a', '128k',
    dest,
  ], { stdio: 'pipe' });
}

console.log('Done. Files written to', DEST);
```

**Step 2: Run the script**

Run: `node scripts/generate-sounds.js`
Expected: 4 MP3 files created in `assets/themes/default/`

**Step 3: Verify the files exist and are audible**

Run: `ls -la assets/themes/default/` and `afplay assets/themes/default/notification.mp3`
Expected: 4 files, each a few KB, audible tones

**Step 4: Commit**

```bash
git add scripts/generate-sounds.js assets/themes/default/
git commit -m "feat(sound): add script to generate default theme MP3s"
```

---

### Task 2: Create theme.json for the default theme

**Files:**
- Create: `assets/themes/default/theme.json`

**Step 1: Create theme.json**

```json
{
  "name": "Default",
  "version": "1.0.0",
  "author": "Claudiu",
  "description": "Built-in sound theme with simple tones",
  "events": {
    "SessionStart": "session-start.mp3",
    "SessionEnd": "session-end.mp3",
    "TaskCompleted": "task-completed.mp3",
    "Notification": "notification.mp3"
  }
}
```

**Step 2: Commit**

```bash
git add assets/themes/default/theme.json
git commit -m "feat(sound): add default theme manifest"
```

---

### Task 3: Seed the default theme on startup

**Files:**
- Modify: `src/main/services/SoundThemeService.js` (constructor + new method)

**Step 1: Add `_seedDefaultTheme()` method**

After the `_ensureThemesDir()` call in the constructor, add a call to `_seedDefaultTheme()`.

Add this method to the class:

```js
/**
 * Copy the bundled default theme to {userData}/themes/default/ if not present.
 * Bundled assets live in assets/themes/default/ relative to the app root.
 */
_seedDefaultTheme() {
  const destDir = path.join(this._themesDir, 'default');
  if (fs.existsSync(path.join(destDir, 'theme.json'))) return; // already seeded

  // Locate bundled assets — works both in dev and packaged app
  const appRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'app')
    : path.join(__dirname, '..', '..', '..');
  const srcDir = path.join(appRoot, 'assets', 'themes', 'default');

  if (!fs.existsSync(path.join(srcDir, 'theme.json'))) {
    if (this._logService) this._logService.warn('sound-theme', 'Bundled default theme not found at ' + srcDir);
    return;
  }

  fs.mkdirSync(destDir, { recursive: true });
  const files = fs.readdirSync(srcDir);
  for (const file of files) {
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
  }
  if (this._logService) this._logService.info('sound-theme', 'Seeded default theme');
}
```

Update constructor:

```js
constructor(logService) {
  this._logService = logService || null;
  this._themesDir = path.join(app.getPath('userData'), 'themes');
  this._ensureThemesDir();
  this._seedDefaultTheme();
}
```

**Step 2: Verify with `node --check`**

Run: `node --check src/main/services/SoundThemeService.js`
Expected: No output (syntax OK)

**Step 3: Commit**

```bash
git add src/main/services/SoundThemeService.js
git commit -m "feat(sound): seed bundled default theme on first launch"
```

---

### Task 4: Change config default to 'default'

**Files:**
- Modify: `src/main/services/ConfigService.js:40`

**Step 1: Update the default value**

Change line 40 from:
```js
    default: 'none',
```
to:
```js
    default: 'default',
```

**Step 2: Verify with `node --check`**

Run: `node --check src/main/services/ConfigService.js`
Expected: No output (syntax OK)

**Step 3: Commit**

```bash
git add src/main/services/ConfigService.js
git commit -m "feat(sound): auto-activate default theme out of the box"
```

---

### Task 5: Include assets in electron-builder

**Files:**
- Modify: `electron-builder.config.js:8-17`

**Step 1: Add assets to files array**

Add `"assets/**/*"` to the `files` array:

```js
files: [
  "main.js",
  "index.html",
  "styles/**/*",
  "fonts/**/*",
  "src/main/**/*",
  "dist/renderer.bundle.js",
  "dist/renderer.bundle.js.map",
  "node_modules/@xterm/xterm/css/**",
  "assets/**/*",
  "package.json"
],
```

**Step 2: Commit**

```bash
git add electron-builder.config.js
git commit -m "build: include assets dir in electron-builder output"
```

---

### Task 6: Add generate:sounds npm script

**Files:**
- Modify: `package.json` (scripts section)

**Step 1: Add the script**

Add to the `"scripts"` object:

```json
"generate:sounds": "node scripts/generate-sounds.js"
```

**Step 2: Commit**

```bash
git add package.json
git commit -m "chore: add generate:sounds npm script"
```

---

### Task 7: Manual integration test

**Step 1: Start the app**

Run: `npm run start`

**Step 2: Verify default theme was seeded**

Check: `ls ~/Library/Application\ Support/claudiu/themes/default/`
Expected: `theme.json`, `session-start.mp3`, `session-end.mp3`, `task-completed.mp3`, `notification.mp3`

**Step 3: Verify sounds play**

- Open a project and start a Claude session → should hear session-start tone
- Or check DevTools console: `await electron_api.soundThemes.getSounds(selectedProjectPath)` should return the sound map

**Step 4: Verify config**

In DevTools: `await electron_api.appConfig.resolve('soundTheme')` → should return `'default'`
