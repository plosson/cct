# Changelog

All notable changes to Claudiu are documented in this file.

## [0.10.0] - 2026-03-07

### Fixed
- Auto-updater "Check for Updates" now shows feedback when already up to date (temporary info banner)
- Banner insertion no longer crashes when no tab bar is present

### Added
- Playwright tests for auto-updater UI (step-051)

## [0.9.0] - 2026-03-07

### Changed
- Added `.claude/` and `tests/screenshots/` to `.gitignore`

## [0.8.0] - 2026-03-07

### Added
- Colored folder icons in project picker
- Changelog documentation in CLAUDE.md

### Changed
- Reworked release workflow: proper code signing with import-codesign-certs action, dmg+zip builds
- Optimized app icons (smaller file sizes)

### Fixed
- 10 flaky Playwright tests: drag simulation, sound theme persistence, settings UI assertions

## [0.7.0] - 2025-03-06

### Added
- Splash screen with video background and app icon animation
- Microphone recording for sound hooks
- Live banner toggle in settings

### Changed
- UI polish: removed tab border line, settings cleanup

## [0.6.0]

### Changed
- Removed DMG from release builds, keep zip only for Homebrew

## [0.5.0]

### Added
- Notes panel with Cmd+L toggle
- Border glow style option
- Tab chevron menu and border beam animation
- Tab drag-drop reorder, inline rename, bell flash
- Project banner and Claude icon in tab labels
- Per-project custom background images behind terminal panels
- Mute toggle

### Changed
- Restructured Sound & Hooks into generic Theme section
- Simplified Sound & Hooks settings UI
- Improved active tab visibility with muted inactive tab background

### Fixed
- Terminal search bar (Cmd+F) not opening
- Theme inheritance and background image overlay visibility
- Flaky CI tests (timing, clipboard races, xterm keybinding bypass)

## [0.3.1]

### Added
- Sound themes system with copy-on-write themes
- Default sound theme bundled and auto-installed on first launch
- Audio trim UI with wavesurfer.js
- Crash resilience, PTY error handling, and renderer recovery

### Changed
- Renamed CCT to Claudiu across all source files, config dirs, and tests
- Auto-migrate Electron userData from cct to claudiu on first launch
- Renderer monolith extracted into 6 modules (settings, overlays, sidebar, tabs, terminal, keybindings)
- Redesigned settings as full-tab with sound override layer
- Simplified SoundThemeService with shared helpers and constants
- Simplified to single sound per event

### Fixed
- Hook system: use command hook for SessionStart, fix session resume
- Sound UI: fixed 7 bugs in settings panel, broken window.prompt() replaced with custom overlay

## [0.2.14]

### Added
- Dark/light mode support with titlebar tab integration
- Custom app icon
- Manual workflow_dispatch trigger for release workflow
- macOS glassmorphism vibrancy effect
- Project-colored pulsing glow effect on active terminal panels
- Colored folder icons in sidebar
- HTTP hook system for all 17 Claude Code events
- Terminal fade-in animation
- Fira Code as primary font (UI + terminal)
- Rich empty state with Claude and terminal launcher cards
- VS Code-style sidebar hover/active states

### Changed
- Styled xterm scrollbar to match native macOS overlay look
- Removed per-project accent colors, subtle Warp-style active tab
- Active tab matches terminal body color

### Fixed
- Capture full login-shell environment on macOS
- Split command string into binary + args for settings with flags

## [0.2.11]

### Added
- Debug pane with Cmd+J toggle, resizable via drag handle
- LogService with ring buffer and IPC bridge
- Structured logging instrumented across codebase
- Configuration screen with global and per-project settings (Cmd+,)
- Sidebar auto-hide dock mode with Cmd+B pin/unpin toggle
- Cmd+O keybinding to open/add a project
- Command-line invocation with `cct .` and `cct /path/to/project`
- Project color palette with deterministic hash assignment
- Project visual identity with accent colors and titlebar display
- Headless mode for tests via CCT_HEADLESS env variable
- Parallel test execution with isolated userData per worker

### Fixed
- Unicode rendering with Unicode11 addon and UTF-8 locale
- Nerd Font Symbols bundled for Powerline glyph rendering
- Cmd+N intercepted by native menu, not reaching renderer
- PTY resize EBADF error when fd is already closed

## [0.2.0]

### Added
- Auto-update via electron-updater with code signing
- Check for Updates menu item
- Tab features: context menu, drag-and-drop reorder, rename, number shortcuts (Cmd+1-9)
- Terminal features: font zoom, search (Cmd+F), bell notification, clipboard integration, select all
- Keyboard shortcuts: Cmd+K (clear), Cmd+Shift+Left/Right (move tab), Cmd+B (toggle sidebar), Cmd+/ (help)
- Project context menu with Reveal in Finder and Copy Path
- Session uptime display in status bar
- Clickable URLs in terminal
- App version in status bar
- Close other tabs shortcut (Cmd+Shift+W)

## [0.1.0]

### Added
- Initial Electron skeleton with xterm.js and node-pty
- Tabbed terminal sessions (Claude Code and shell)
- Sidebar with projects and sessions
- Per-project session persistence and restore
- Claude Code session continuity (--session-id/--resume)
- Window state persistence
- Draggable sidebar resize
- Status bar with session info
- Data-driven keybinding system
