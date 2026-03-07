/**
 * Overlay UIs — project picker, search bar, shortcut help, debug pane
 */

import {
  getActiveId, getTerminalsContainer,
  getActiveSession, refitActiveTerminal,
} from './terminal.js';
import {
  getDebugPaneEl, getDebugPaneEntriesEl, getDebugPaneCountEl, getDebugPaneResizeHandle,
} from './index.js';
import { keybindings } from './keybindings.js';
import { projects, projectMRU, selectProject } from './sidebar.js';
import { getProjectColor } from './projectColors.js';

const api = window.electron_api;

// ── Helpers ──────────────────────────────────────────────────

/** Focus the active terminal — used after closing overlays and search */
function refocusTerminal() {
  const session = getActiveSession();
  if (session) session.terminal.focus();
}

// ── Prompt overlay ───────────────────────────────────────────

/**
 * Show a prompt overlay (replaces window.prompt which doesn't work in Electron).
 * Returns a Promise that resolves to the entered string, or null if cancelled.
 */
function showPromptOverlay(message, defaultValue = '') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.dataset.testid = 'prompt-overlay';

    const panel = document.createElement('div');
    panel.className = 'overlay-panel';
    panel.style.maxWidth = '400px';
    panel.style.padding = '16px';
    panel.style.marginTop = '20vh';

    const label = document.createElement('label');
    label.className = 'settings-label';
    label.textContent = message;
    label.style.marginBottom = '8px';
    label.style.display = 'block';

    const input = document.createElement('input');
    input.className = 'project-picker-input';
    input.dataset.testid = 'prompt-input';
    input.value = defaultValue;

    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.justifyContent = 'flex-end';
    btnRow.style.gap = '8px';
    btnRow.style.marginTop = '12px';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'settings-btn-secondary';
    cancelBtn.textContent = 'Cancel';

    const okBtn = document.createElement('button');
    okBtn.className = 'settings-btn-primary';
    okBtn.textContent = 'OK';

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(okBtn);
    panel.appendChild(label);
    panel.appendChild(input);
    panel.appendChild(btnRow);
    overlay.appendChild(panel);

    function close(value) {
      overlay.remove();
      resolve(value);
    }

    cancelBtn.addEventListener('click', () => close(null));
    okBtn.addEventListener('click', () => close(input.value || null));
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) close(null);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); close(input.value || null); }
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
    });

    document.querySelector('.app').appendChild(overlay);
    input.focus();
    input.select();
  });
}

// ── Project Picker (Cmd+E) ───────────────────────────────────

let pickerOverlay = null;
let pickerSelectedIndex = 0;
let pickerFilteredPaths = [];

function openProjectPicker() {
  if (pickerOverlay) { closeProjectPicker(); return; }

  pickerOverlay = document.createElement('div');
  pickerOverlay.className = 'overlay project-picker-overlay';
  pickerOverlay.dataset.testid = 'project-picker-overlay';

  const picker = document.createElement('div');
  picker.className = 'overlay-panel project-picker';

  const input = document.createElement('input');
  input.className = 'project-picker-input';
  input.dataset.testid = 'project-picker-input';
  input.placeholder = 'Switch to project…';

  const list = document.createElement('div');
  list.className = 'project-picker-list';
  list.dataset.testid = 'project-picker-list';

  picker.appendChild(input);
  picker.appendChild(list);
  pickerOverlay.appendChild(picker);

  // Click backdrop to close
  pickerOverlay.addEventListener('mousedown', (e) => {
    if (e.target === pickerOverlay) closeProjectPicker();
  });

  pickerSelectedIndex = projectMRU.length > 1 ? 1 : 0;
  renderPickerList(list, '');

  input.addEventListener('input', () => {
    pickerSelectedIndex = 0;
    renderPickerList(list, input.value);
  });

  input.addEventListener('keydown', (e) => {
    const count = pickerFilteredPaths.length;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        closeProjectPicker();
        break;
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        if (count === 0) break;
        const delta = e.key === 'ArrowDown' ? 1 : count - 1;
        pickerSelectedIndex = (pickerSelectedIndex + delta) % count;
        renderPickerList(list, input.value);
        break;
      }
      case 'Enter':
        e.preventDefault();
        if (count > 0) {
          selectProject(pickerFilteredPaths[pickerSelectedIndex]);
        }
        closeProjectPicker();
        break;
    }
  });

  document.querySelector('.app').appendChild(pickerOverlay);
  input.focus();
}

function closeProjectPicker() {
  if (!pickerOverlay) return;
  pickerOverlay.remove();
  pickerOverlay = null;
  refocusTerminal();
}

function renderPickerList(listEl, filter) {
  listEl.innerHTML = '';
  const lowerFilter = filter.toLowerCase();

  // Build filtered list from MRU order, resolving each path to its project once
  const projectsByPath = new Map(projects.map(p => [p.path, p]));
  const filtered = projectMRU
    .map(pp => projectsByPath.get(pp))
    .filter(p => p && (!lowerFilter || p.name.toLowerCase().includes(lowerFilter)));

  pickerFilteredPaths = filtered.map(p => p.path);

  filtered.forEach((project, i) => {
    const item = document.createElement('div');
    item.className = 'project-picker-item';
    item.dataset.testid = 'project-picker-item';
    if (i === pickerSelectedIndex) item.classList.add('selected');

    const color = getProjectColor(project.name);
    const folderColor = `hsl(${color.hue}, ${color.s}%, ${color.l + 10}%)`;

    item.innerHTML = `
      <span class="project-picker-item-row">
        <span class="project-picker-item-icon" style="color: ${folderColor}">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h3.3a1.5 1.5 0 0 1 1.1.5L8.6 3.5H13A1.5 1.5 0 0 1 14.5 5v7.5A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5V3z"/>
          </svg>
        </span>
        <span class="project-picker-item-name">${project.name}</span>
      </span>
      <span class="project-picker-item-path">${project.path}</span>
    `;

    item.addEventListener('click', () => {
      selectProject(project.path);
      closeProjectPicker();
    });

    listEl.appendChild(item);
  });
}

// ── Terminal search (Cmd+F) ──────────────────────────────────

let searchBarEl = null;

function openSearchBar() {
  if (!getActiveId()) return;
  if (searchBarEl) { focusSearchBar(); return; }
  if (!getActiveSession()) return;

  searchBarEl = document.createElement('div');
  searchBarEl.className = 'search-bar';
  searchBarEl.dataset.testid = 'search-bar';

  const input = document.createElement('input');
  input.className = 'search-bar-input';
  input.dataset.testid = 'search-bar-input';
  input.placeholder = 'Search…';

  const count = document.createElement('span');
  count.className = 'search-bar-count';
  count.dataset.testid = 'search-bar-count';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'search-bar-btn';
  prevBtn.dataset.testid = 'search-bar-prev';
  prevBtn.textContent = '\u2191';

  const nextBtn = document.createElement('button');
  nextBtn.className = 'search-bar-btn';
  nextBtn.dataset.testid = 'search-bar-next';
  nextBtn.textContent = '\u2193';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'search-bar-btn search-bar-close';
  closeBtn.dataset.testid = 'search-bar-close';
  closeBtn.textContent = '\u00d7';

  searchBarEl.appendChild(input);
  searchBarEl.appendChild(count);
  searchBarEl.appendChild(prevBtn);
  searchBarEl.appendChild(nextBtn);
  searchBarEl.appendChild(closeBtn);

  // Insert before the terminals container within its parent
  const tc = getTerminalsContainer();
  tc.parentElement.insertBefore(searchBarEl, tc);

  const doSearch = (direction = 'next') => {
    const s = getActiveSession();
    if (!s || !input.value) { count.textContent = ''; return; }
    const found = direction === 'next'
      ? s.searchAddon.findNext(input.value)
      : s.searchAddon.findPrevious(input.value);
    count.textContent = found ? '' : 'No results';
  };

  input.addEventListener('input', () => doSearch('next'));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearchBar();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      doSearch(e.shiftKey ? 'prev' : 'next');
    }
  });

  prevBtn.addEventListener('click', () => doSearch('prev'));
  nextBtn.addEventListener('click', () => doSearch('next'));
  closeBtn.addEventListener('click', () => closeSearchBar());

  input.focus();
}

function focusSearchBar() {
  if (!searchBarEl) return;
  const input = searchBarEl.querySelector('.search-bar-input');
  if (input) {
    input.focus();
    input.select();
  }
}

function closeSearchBar() {
  if (!searchBarEl) return;
  const session = getActiveSession();
  if (session) session.searchAddon.clearDecorations();
  searchBarEl.remove();
  searchBarEl = null;
  refocusTerminal();
}

// ── Shortcut help overlay (Cmd+/) ────────────────────────────

const ACTION_LABELS = {
  createClaudeSession: 'New Claude Session',
  createTerminalSession: 'New Terminal Session',
  closeActiveTab: 'Close Active Tab',
  openProjectPicker: 'Project Picker',
  addProject: 'Add Project',
  prevTab: 'Previous Tab',
  nextTab: 'Next Tab',
  prevProject: 'Previous Project',
  nextProject: 'Next Project',
  openSearchBar: 'Find in Terminal',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  zoomReset: 'Reset Zoom',
  clearTerminal: 'Clear Terminal',
  copySelection: 'Copy Selection',
  pasteClipboard: 'Paste',
  moveTabLeft: 'Move Tab Left',
  moveTabRight: 'Move Tab Right',
  selectAll: 'Select All',
  toggleSidebar: 'Pin/Unpin Sidebar',
  closeOtherTabs: 'Close Other Tabs',
  openSettings: 'Settings',
  showShortcutHelp: 'Show Shortcuts',
  toggleDebugPane: 'Toggle Debug Log',
  goToTab1: 'Go to Tab 1',
  goToTab2: 'Go to Tab 2',
  goToTab3: 'Go to Tab 3',
  goToTab4: 'Go to Tab 4',
  goToTab5: 'Go to Tab 5',
  goToTab6: 'Go to Tab 6',
  goToTab7: 'Go to Tab 7',
  goToTab8: 'Go to Tab 8',
  goToLastTab: 'Go to Last Tab',
};

function formatKeyCombo(combo) {
  return combo
    .replace(/Meta/g, '\u2318')
    .replace(/Alt/g, '\u2325')
    .replace(/Shift/g, '\u21e7')
    .replace(/Ctrl/g, '\u2303')
    .replace(/ArrowLeft/g, '\u2190')
    .replace(/ArrowRight/g, '\u2192')
    .replace(/ArrowUp/g, '\u2191')
    .replace(/ArrowDown/g, '\u2193')
    .replace(/\+/g, ' ');
}

let shortcutHelpOverlay = null;

function showShortcutHelp() {
  if (shortcutHelpOverlay) { closeShortcutHelp(); return; }

  shortcutHelpOverlay = document.createElement('div');
  shortcutHelpOverlay.className = 'overlay shortcut-help-overlay';
  shortcutHelpOverlay.dataset.testid = 'shortcut-help-overlay';

  const panel = document.createElement('div');
  panel.className = 'overlay-panel shortcut-help-panel';

  const title = document.createElement('h2');
  title.className = 'shortcut-help-title';
  title.textContent = 'Keyboard Shortcuts';
  panel.appendChild(title);

  const list = document.createElement('div');
  list.className = 'shortcut-help-list';

  for (const [combo, actionName] of Object.entries(keybindings)) {
    const label = ACTION_LABELS[actionName] || actionName;
    const row = document.createElement('div');
    row.className = 'shortcut-help-row';
    row.dataset.testid = 'shortcut-help-row';
    row.innerHTML = `<span class="shortcut-help-label">${label}</span><kbd class="shortcut-help-key">${formatKeyCombo(combo)}</kbd>`;
    list.appendChild(row);
  }

  panel.appendChild(list);
  shortcutHelpOverlay.appendChild(panel);

  shortcutHelpOverlay.addEventListener('mousedown', (e) => {
    if (e.target === shortcutHelpOverlay) closeShortcutHelp();
  });

  shortcutHelpOverlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeShortcutHelp();
    }
  });

  document.querySelector('.app').appendChild(shortcutHelpOverlay);
  shortcutHelpOverlay.tabIndex = -1;
  shortcutHelpOverlay.focus();
}

function closeShortcutHelp() {
  if (!shortcutHelpOverlay) return;
  shortcutHelpOverlay.remove();
  shortcutHelpOverlay = null;
  refocusTerminal();
}

// ── Debug pane state ─────────────────────────────────────────

let debugPaneOpen = false;
let debugPaneHeight = 200;

export function getDebugPaneOpen() { return debugPaneOpen; }
export function setDebugPaneOpen(val) { debugPaneOpen = val; }
export function getDebugPaneHeight() { return debugPaneHeight; }
export function setDebugPaneHeight(val) { debugPaneHeight = val; }

// ── Debug pane toggle ────────────────────────────────────────

function toggleDebugPane() {
  const debugPaneEl = getDebugPaneEl();
  const debugPaneResizeHandle = getDebugPaneResizeHandle();
  debugPaneOpen = !debugPaneOpen;
  if (debugPaneOpen) {
    debugPaneEl.style.height = debugPaneHeight + 'px';
    debugPaneEl.classList.add('open');
    debugPaneResizeHandle.classList.add('visible');
  } else {
    debugPaneEl.style.height = '0';
    debugPaneEl.classList.remove('open');
    debugPaneResizeHandle.classList.remove('visible');
  }
  if (api.windowState) {
    api.windowState.set('debugPaneOpen', debugPaneOpen);
  }
  refitActiveTerminal();
}

// ── Debug pane resize ────────────────────────────────────────

function initDebugPaneResize() {
  const debugPaneEl = getDebugPaneEl();
  const debugPaneResizeHandle = getDebugPaneResizeHandle();
  const MIN_HEIGHT = 80;

  let isDragging = false;
  let startY = 0;
  let startHeight = 0;

  debugPaneResizeHandle.addEventListener('mousedown', (e) => {
    if (!debugPaneOpen) return;
    isDragging = true;
    startY = e.clientY;
    startHeight = debugPaneEl.offsetHeight;
    debugPaneResizeHandle.classList.add('dragging');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const mainArea = document.querySelector('.main-area');
    const maxHeight = Math.floor(mainArea.offsetHeight * 0.5);
    const delta = startY - e.clientY; // dragging up increases height
    const newHeight = Math.max(MIN_HEIGHT, Math.min(maxHeight, startHeight + delta));
    debugPaneEl.style.height = newHeight + 'px';
    refitActiveTerminal();
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    debugPaneResizeHandle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    debugPaneHeight = debugPaneEl.offsetHeight;
    if (api.windowState) {
      api.windowState.set('debugPaneHeight', debugPaneHeight);
    }
  });
}

// ── Debug pane entries ───────────────────────────────────────

let debugAutoScroll = true;

export function setDebugAutoScroll(val) { debugAutoScroll = val; }

function formatLogTime(timestamp) {
  const d = new Date(timestamp);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function addDebugEntry(entry) {
  const debugPaneEntriesEl = getDebugPaneEntriesEl();
  if (!debugPaneEntriesEl) return;

  const row = document.createElement('div');
  row.className = `debug-entry level-${entry.level}`;

  const time = document.createElement('span');
  time.className = 'debug-entry-time';
  time.textContent = formatLogTime(entry.timestamp);

  const source = document.createElement('span');
  source.className = 'debug-entry-source';
  source.textContent = `[${entry.source}]`;

  const msg = document.createElement('span');
  msg.className = 'debug-entry-message';
  msg.textContent = entry.message;

  row.append(time, source, msg);
  debugPaneEntriesEl.appendChild(row);

  updateDebugPaneCount();

  // Auto-scroll if user hasn't scrolled up
  if (debugAutoScroll) {
    debugPaneEntriesEl.scrollTop = debugPaneEntriesEl.scrollHeight;
  }
}

function updateDebugPaneCount() {
  const debugPaneCountEl = getDebugPaneCountEl();
  const debugPaneEntriesEl = getDebugPaneEntriesEl();
  if (debugPaneCountEl) {
    const count = debugPaneEntriesEl.querySelectorAll('.debug-entry').length;
    debugPaneCountEl.textContent = count > 0 ? `(${count})` : '';
  }
}

function clearDebugPane() {
  const debugPaneEntriesEl = getDebugPaneEntriesEl();
  if (debugPaneEntriesEl) {
    debugPaneEntriesEl.innerHTML = '';
    updateDebugPaneCount();
  }
  if (api.log) api.log.clear();
}

// ── Exports ──────────────────────────────────────────────────

export {
  refocusTerminal, showPromptOverlay,
  openProjectPicker, closeProjectPicker,
  openSearchBar, closeSearchBar,
  showShortcutHelp, closeShortcutHelp,
  ACTION_LABELS, formatKeyCombo,
  toggleDebugPane, initDebugPaneResize, addDebugEntry, clearDebugPane,
  updateDebugPaneCount,
};
