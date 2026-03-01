# Step 012 — Tab Drag-and-Drop Reordering

## What was done

Added drag-and-drop tab reordering using HTML5 Drag and Drop API. Users can click and drag tabs to rearrange their order within the tab bar.

**Modified files:**
- `src/renderer/index.js` — added `draggable="true"` to tabs, dragstart/dragend/dragover/dragleave/drop event listeners, `clearDropIndicators()` helper, `draggedTabId` state
- `styles/base.css` — added `.tab-item.dragging` (opacity: 0.4), `.tab-item.drop-before`/`.drop-after` (blue inset box-shadow drop indicators)

**New files:**
- `tests/step-012-tab-reorder.spec.js` — 7 Playwright tests

**Resulting behavior:**
- Tabs have `draggable="true"` attribute
- Dragging a tab reduces its opacity (0.4) for visual feedback
- Hovering a dragged tab over another tab shows a blue drop indicator on the left or right side, depending on cursor position relative to the midpoint
- Dropping the tab repositions it in the DOM before or after the target tab
- All drop indicators are cleared on dragend
- Tab functionality (click to activate, close button) works normally after reorder

## Choices made

- **HTML5 Drag and Drop API**: Native browser API, no libraries needed. Sufficient for reordering within a single container.
- **Midpoint-based insertion**: The drop position (before/after) is determined by whether the cursor is left or right of the target tab's horizontal center. This is intuitive — drag left of center to insert before, right of center to insert after.
- **DOM-only reorder**: Tab reordering only changes DOM order, not any data structure. The sessions Map doesn't have an ordering concept — tab order is determined purely by DOM position. This keeps the implementation simple.
- **Blue inset box-shadow for drop indicator**: Uses `box-shadow: inset 2px 0 0 #58a6ff` to show a 2px blue line on the left (drop-before) or right (drop-after) edge of the target tab. Matches the accent color used in search bar focus.

## Architecture decisions

- **Event listeners on each tab**: dragstart, dragend, dragover, dragleave, drop are all set on individual tab elements. This avoids complex delegation logic and each tab manages its own drag state.
- **`draggedTabId` module-level state**: A single variable tracks which tab is being dragged. Set on dragstart, cleared on dragend. The drop handler uses it to find the dragged session and its tab element.
- **`clearDropIndicators()` helper**: Removes `drop-before`/`drop-after` classes from all tabs. Called on dragend and drop to ensure no stale indicators remain.
- **No persistence**: Tab order is visual only and resets when the app restarts. This is intentional — tab order is a transient preference, not worth persisting for now.

## How it was tested

7 Playwright tests:

1. Tabs have `draggable="true"` attribute
2. Three tabs exist in ascending ID order (initial state)
3. Dragging first tab to right of second tab reorders (verifies new DOM order via tab IDs)
4. Dragging last tab to before first tab reorders (verifies new DOM order)
5. Dragging tab gets visual feedback (checks for `dragging` class)
6. Tab count unchanged after reorder (still 3 tabs)
7. Clicking a reordered tab activates it correctly

All 7 tests pass. Full suite: 112 tests in ~54s.

## Lessons / gotchas

- **HTML5 drag in Playwright**: Playwright's `mouse.move/down/up` sequence works well with HTML5 drag and drop. The `steps` parameter is important — it generates intermediate mousemove events that trigger dragover handlers.
- **`e.dataTransfer.setData` required**: Some browsers require `setData` to be called in dragstart for the drag to work. Setting `text/plain` with the tab ID ensures compatibility.
- **`insertBefore(el, null)` appends**: Using `insertBefore(el, tabEl.nextSibling)` when nextSibling is null effectively appends to the end, which is correct for inserting after the last tab.
