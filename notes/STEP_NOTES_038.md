# Step 038 — Colored folder icons + status bar shortcut hints

## What was done

- Added colored folder SVG icons to each project in the sidebar, using the existing `getProjectColor()` deterministic palette
- Added shortcut hint badges to the status bar footer showing `⌘N` Claude, `⌘T` Terminal, `⌘/` Shortcuts
- Styled both new elements to fit the existing dark/light theme system

### Files modified
- `src/renderer/index.js` — Added folder icon with per-project HSL color in `renderSidebar()`
- `index.html` — Added `status-bar-shortcuts` span in the status bar
- `styles/base.css` — Added `.sidebar-project-icon` and `.status-bar-shortcuts` styles

## Choices made

- Used a filled folder SVG path (not outlined) for better visibility at 14px
- Lightened folder colors by +10 lightness from the palette for a softer pastel look in dark theme
- Placed shortcut hints between the spacer and uptime in the status bar, so they sit right-of-center but before the version

## Architecture decisions

- Reused existing `getProjectColor()` from `projectColors.js` (already imported) — no new color logic needed
- Shortcut hints are static HTML in `index.html` — no JS logic required, keeps it simple
- Used CSS variables (`--kbd-bg`, `--border`, `--text-dim`, `--text-muted`) so hints adapt to theme automatically

## How it was tested

- Built with esbuild — no errors
- Manual verification: `npm run start` to confirm folder icons appear with distinct colors per project and status bar shortcuts render correctly

## Lessons / gotchas

- The `getProjectColor()` palette values are tuned for use as accents, so bumping lightness +10 for folder icons keeps them gentle against the dark sidebar background
