# Step 008 — Draggable Sidebar Resize

## What was done

Added a draggable resize handle between the sidebar and main area, allowing the user to adjust sidebar width by clicking and dragging.

**Modified files:**
- `index.html` — added `<div class="sidebar-resize-handle" data-testid="sidebar-resize-handle"></div>` between sidebar and main-area
- `styles/base.css` — added resize handle styles (4px wide, `col-resize` cursor, highlight on hover/drag)
- `src/renderer/index.js` — added `initSidebarResize()` with mousedown/mousemove/mouseup handlers, min/max width constraints, terminal refit during drag, width persistence

**New files:**
- `tests/step-008-sidebar-resize.spec.js` — 7 Playwright tests

**Resulting behavior:**
- 4px invisible handle between sidebar and main content
- On hover, handle shows a subtle highlight (`#3a3a5a`)
- Click-and-drag resizes sidebar between 140px (min) and 500px (max)
- During drag, cursor changes to `col-resize` globally and user-select is disabled
- Active terminal refits during drag so dimensions update live
- Final width is persisted via `WindowStateService` (from step 007)
- Persisted width is restored on app restart

## Choices made

- **4px handle width**: Narrow enough to be unobtrusive but wide enough to be a comfortable drag target. Consistent with VS Code and other editors.
- **Min 140px / Max 500px**: Min ensures project names remain readable. Max prevents the sidebar from consuming too much horizontal space.
- **Live terminal refit during drag**: Calling `fitAddon.fit()` on every mousemove gives immediate visual feedback of terminal dimension changes. No debounce needed here since fit is cheap.
- **Persist on mouseup (not during drag)**: Only one IPC call at the end of the drag, avoiding unnecessary writes.
- **`user-select: none` during drag**: Prevents text selection artifacts while dragging across the sidebar and terminal.

## Architecture decisions

- **Handle as a separate DOM element**: Placed between sidebar and main-area in the flex layout. This is simpler than using CSS resize or a library — just three mouse event handlers.
- **Global mousemove/mouseup**: Attached to `document` so dragging continues even when the cursor moves outside the handle. The `isDragging` flag gates the handlers.
- **Reuses WindowStateService**: No new IPC channels — uses `setSidebarWidth()` added in step 007.

## How it was tested

7 Playwright tests:

1. Resize handle is visible between sidebar and main area
2. Handle has correct `col-resize` cursor style
3. Dragging right increases sidebar width
4. Dragging left decreases sidebar width
5. Width cannot go below 140px minimum
6. Width cannot go above 500px maximum
7. Resized width persists and is restored on next launch (write + read via IPC)

All 7 tests pass. Full suite: 70 tests in ~29s.

## Lessons / gotchas

- **`-webkit-app-region: no-drag` on handle**: The handle sits near the title bar area. Without explicitly opting out of app-region drag, macOS treats it as a window drag target.
- **Testing drag with Playwright**: Used `page.mouse.move()` with `steps` parameter for smooth simulation. The `steps: 5` parameter generates intermediate mousemove events which is important for the resize handler to detect movement.
