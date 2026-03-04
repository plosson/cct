# Step 042 — Settings Redesign: Warp-Style Full Tab with Sound Hooks

## What was done

Completely replaced the 520x520 modal settings overlay with a full-tab Warp-style settings view.

### Files modified:
- **`src/renderer/index.js`** — Rewrote `openSettings()` to create a settings pseudo-session (type `'settings'`) in the tab system instead of a modal overlay. Added section renderers for General, Appearance, Sound & Hooks, and About. Added audio trim UI with waveform visualization and WAV export. Updated `activateTab`, `closeTab`, `updateStatusBar`, `selectProject`, and `applyThemeSetting` to handle the settings tab (no terminal/PTY).
- **`styles/base.css`** — Replaced settings overlay CSS with full-tab layout: scope toggle bar, left nav sidebar (180px), right content area, sound event table, trim UI, about grid.
- **`src/main/services/SoundThemeService.js`** — Added sound override layer: `getOverrideDir()`, `getOverridePath()`, `saveOverride()`, `saveOverrideFromBase64()`, `removeOverride()`, `getResolvedSoundMap()` with merge logic (project > global > theme).
- **`src/main/ipc/sound-theme.ipc.js`** — Added IPC handlers: `sound-override-upload` (file dialog), `sound-override-save-base64` (for trim export), `sound-override-remove`. Updated `sound-theme-get-sounds` to use `getResolvedSoundMap`.
- **`src/main/preload.js`** — Exposed `soundOverrides` API: `upload`, `saveFromBase64`, `remove`.
- **`main.js`** — Registered `claudiu-sound-override://` protocol with base64url-encoded file paths. Security: only serves from userData or `.claudiu` directories.
- **`index.html`** — Added `media-src` CSP directive for `claudiu-sound:`, `claudiu-sound-override:`, and `blob:`.
- **`tests/step-033-configuration.spec.js`** — Rewrote all 14 tests for tab-based settings + added 2 new tests (nav sections, single tab enforcement).

## Choices made

1. **Settings as a pseudo-session** — Rather than a separate panel system, settings reuse the existing tab/sessions Map with `type: 'settings'` and negative IDs to avoid PTY ID collisions. This leverages all existing tab infrastructure (activate, close, drag) for free.

2. **Scope toggle instead of Global/Project tabs** — The old Global/Project tabs conflicted conceptually with the new left nav sections. Using a scope toggle bar at the top is cleaner and independent of section navigation.

3. **Base64url protocol for overrides** — Override files can live anywhere (userData for global, project dir for per-project). Encoding the absolute path as base64url in the protocol URL avoids a lookup table while keeping security via path whitelisting.

4. **WAV export for trim** — Using `OfflineAudioContext` to render trimmed audio and a manual WAV encoder (PCM 16-bit). Simple, no dependencies, works in all Chromium versions.

## Architecture decisions

- Settings tab has `projectPath: '__global__'` so it doesn't get hidden during project switches (`selectProject` now shows settings tabs regardless).
- All `session.terminal` accesses are guarded with null checks since settings sessions have no terminal.
- Sound override resolution is layered: theme base → global overrides → project overrides. Each layer can add or replace any event.

## How it was tested

- **16 Playwright tests** in `step-033-configuration.spec.js` — all pass:
  - Opens settings tab via Cmd+,
  - Scope toggle (global/project) works
  - Form inputs present with correct defaults/placeholders
  - Save persists to config.json / .claudiu/config.json
  - Re-open shows saved values
  - Project scope shows project-specific values with global fallback
  - Unsaved changes discarded on close
  - Clear value removes from config
  - Nav sections switch correctly
  - Only one settings tab allowed
- **Full suite: 260 passed**, 2 pre-existing failures (dark theme CSS + flaky terminal links)

## Lessons / gotchas

- The `applyThemeSetting` function iterates all sessions and sets `sess.terminal.options.theme` — this crashes on settings tabs since they have no terminal. Added a null guard.
- `api.terminal.kill()` must be skipped for settings tabs — guarded with `session.type !== 'settings'`.
- The CSP `media-src` directive was missing, which would have blocked audio playback via custom protocols.
