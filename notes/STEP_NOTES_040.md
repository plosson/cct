# Step 040 — Sound Themes System

## What was done

Implemented a sound theme system that plays MP3 sounds in response to Claude Code hook events. A theme is a directory containing a `theme.json` manifest and MP3 files.

### Files created
- `src/main/services/SoundThemeService.js` — Theme management service (list, install from zip/GitHub, remove, resolve sounds)
- `src/main/ipc/sound-theme.ipc.js` — IPC bridge for renderer ↔ SoundThemeService

### Files modified
- `src/main/services/ConfigService.js` — Added `soundTheme` config key (default: `'none'`)
- `src/main/preload.js` — Added `soundThemes` API namespace (list, install, remove, getSounds)
- `main.js` — Registered `cct-sound://` custom protocol, initialized SoundThemeService, registered IPC
- `src/renderer/index.js` — Added sound cache, hook event → sound playback wiring

## Theme format

```
my-theme/
├── theme.json
├── boot.mp3
├── done.mp3
└── ...
```

`theme.json`:
```json
{
  "name": "My Theme",
  "version": "1.0.0",
  "author": "Author",
  "description": "Description",
  "events": {
    "SessionStart": "boot.mp3",
    "TaskCompleted": "done.mp3"
  }
}
```

Events map 1:1 to the 17 hook events from Step 039. Unmapped events are silent.

## Choices made

- **Custom `cct-sound://` protocol** over `file://` or base64 data URLs — clean, secure (path-validated), no encoding overhead, and works naturally with `new Audio(url)` in the renderer
- **Audio clone on play** — `audio.cloneNode()` so overlapping event sounds don't cut each other off
- **GitHub install via shallow `git clone`** — simplest approach; `.git` dir is removed post-clone to save space
- **Zip install via system `unzip`** — avoids adding a Node zip dependency; available on macOS/Linux out of the box
- **`soundTheme` as a ConfigService key** — inherits the existing 3-tier hierarchy (project → global → default), so different projects can have different themes
- **No UI for theme management in MVP** — install/activate via settings or future step; focus was on the plumbing

## Architecture decisions

- Theme files stored in `{userData}/themes/{dir-name}/` — outside any project, shared across all sessions
- `SoundThemeService` is a pure main-process service following the same patterns as `ConfigService` and `ProjectStore`
- IPC follows the existing invoke pattern with a dedicated `sound-theme.ipc.js` file
- Renderer sound playback is fully decoupled: `initSoundTheme()` subscribes to `api.hooks.onEvent()` and plays cached Audio objects — no changes needed to the hook system itself
- Path traversal protection in both the protocol handler and `getSoundPath()` — resolved paths must stay inside the themes directory

## How it was tested

- Syntax validation via `node --check` on all modified files
- Architecture review: follows existing service/IPC/preload patterns exactly

## Lessons / gotchas

- `protocol.registerSchemesAsPrivileged()` must be called **before** `app.whenReady()` — it's a synchronous setup step
- `protocol.handle()` (Electron 25+) is the modern replacement for `registerFileProtocol` — returns `Response` objects directly
- Audio `cloneNode()` is needed because calling `.play()` on an Audio element that's already playing restarts it rather than overlapping
- GitHub theme repos should have `theme.json` at the repository root — the install won't find it if nested deeper than one level
