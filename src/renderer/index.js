/**
 * Renderer — tabbed terminal manager with project sidebar
 * Sessions are always project-scoped. Switching projects switches visible tabs.
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { getProjectColor } from './projectColors.js';
import { openSettings } from './settings.js';
import {
  openProjectPicker, closeProjectPicker,
  openSearchBar, closeSearchBar,
  showShortcutHelp, closeShortcutHelp,
  toggleDebugPane, initDebugPaneResize, addDebugEntry, clearDebugPane,
  updateDebugPaneCount,
  setDebugPaneOpen, getDebugPaneHeight, setDebugPaneHeight,
  setDebugAutoScroll,
} from './overlays.js';
import {
  projects, projectMRU, projectActivity,
  getSelectedProjectPath, setSelectedProjectPath,
  sessionsForProject, countSessionsForProject, refreshProjectList,
  renderSidebar, selectProject, addProject, removeProject, cycleProject,
  updateProjectActivityBadge,
  toggleSidebar, initSidebarResize, initSidebarAutoHide,
  updateEmptyState, updateAppGlow,
  showProjectContextMenu,
  getEmptyStateMessage,
  getSidebarMode, setSidebarMode, getSidebarRevealed,
  getSidebarWidth, setSidebarWidth,
} from './sidebar.js';

const api = window.electron_api;

// Expose for testing
window._claudiuProjectColors = { getProjectColor };

export const sessions = new Map(); // id -> { terminal, fitAddon, panelEl, tabEl, cleanup, projectPath, sessionId, type, createdAt }
let activeId = null;

// Tab drag-and-drop state
let draggedTabId = null;

// Data-driven keybindings
const DEFAULT_KEYBINDINGS = {
  'Meta+n': 'createClaudeSession',
  'Meta+t': 'createTerminalSession',
  'Meta+w': 'closeActiveTab',
  'Meta+e': 'openProjectPicker',
  'Meta+o': 'addProject',
  'Meta+ArrowLeft': 'prevTab',
  'Meta+ArrowRight': 'nextTab',
  'Meta+ArrowUp': 'prevProject',
  'Meta+ArrowDown': 'nextProject',
  'Meta+f': 'openSearchBar',
  'Meta+=': 'zoomIn',
  'Meta+-': 'zoomOut',
  'Meta+0': 'zoomReset',
  'Meta+k': 'clearTerminal',
  'Shift+Meta+C': 'copySelection',
  'Shift+Meta+V': 'pasteClipboard',
  'Shift+Meta+ArrowLeft': 'moveTabLeft',
  'Shift+Meta+ArrowRight': 'moveTabRight',
  'Meta+a': 'selectAll',
  'Meta+b': 'toggleSidebar',
  'Shift+Meta+W': 'closeOtherTabs',
  'Meta+,': 'openSettings',
  'Meta+/': 'showShortcutHelp',
  'Meta+1': 'goToTab1',
  'Meta+2': 'goToTab2',
  'Meta+3': 'goToTab3',
  'Meta+4': 'goToTab4',
  'Meta+5': 'goToTab5',
  'Meta+6': 'goToTab6',
  'Meta+7': 'goToTab7',
  'Meta+8': 'goToTab8',
  'Meta+9': 'goToLastTab',
  'Meta+j': 'toggleDebugPane',
};

let keybindings = { ...DEFAULT_KEYBINDINGS };

export const actions = new Map();

// Static DOM elements (populated in init)
let terminalsContainer;
let tabBarTabs;
let sidebarProjectsEl;
let sidebarEl;
let emptyStateEl;
let debugPaneEl;
let debugPaneEntriesEl;
let debugPaneCountEl;
let debugPaneResizeHandle;

// Getter functions for let variables (used by extracted modules)
export function getActiveId() { return activeId; }
export function setActiveId(id) { activeId = id; }
export function getTerminalsContainer() { return terminalsContainer; }
export function getTabBarTabs() { return tabBarTabs; }
export function getKeybindings() { return keybindings; }
export function getDebugPaneEl() { return debugPaneEl; }
export function getDebugPaneEntriesEl() { return debugPaneEntriesEl; }
export function getDebugPaneCountEl() { return debugPaneCountEl; }
export function getDebugPaneResizeHandle() { return debugPaneResizeHandle; }
export function getSidebarProjectsEl() { return sidebarProjectsEl; }
export function getSidebarEl() { return sidebarEl; }
export function getEmptyStateEl() { return emptyStateEl; }

// ── Theme helpers ────────────────────────────────────────────

const DARK_TERMINAL_THEME = {
  background: '#111111',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  selectionBackground: 'rgba(212, 148, 60, 0.25)',
  scrollbarSliderBackground: 'rgba(255, 255, 255, 0.2)',
  scrollbarSliderHoverBackground: 'rgba(255, 255, 255, 0.35)',
  scrollbarSliderActiveBackground: 'rgba(255, 255, 255, 0.5)',
};

const LIGHT_TERMINAL_THEME = {
  background: '#f5f5f7',
  foreground: '#1a1a1a',
  cursor: '#1a1a1a',
  selectionBackground: 'rgba(0, 102, 204, 0.2)',
  scrollbarSliderBackground: 'rgba(0, 0, 0, 0.2)',
  scrollbarSliderHoverBackground: 'rgba(0, 0, 0, 0.35)',
  scrollbarSliderActiveBackground: 'rgba(0, 0, 0, 0.5)',
};

function getCurrentThemeMode() {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  // system: check OS preference
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function getTerminalTheme() {
  return getCurrentThemeMode() === 'light' ? LIGHT_TERMINAL_THEME : DARK_TERMINAL_THEME;
}

export function applyThemeSetting(theme) {
  const root = document.documentElement;
  if (theme === 'dark' || theme === 'light') {
    root.setAttribute('data-theme', theme);
  } else {
    // 'system' — remove attribute so CSS @media kicks in
    root.removeAttribute('data-theme');
  }
  // Sync xterm terminals
  const xtermTheme = getTerminalTheme();
  TERMINAL_OPTIONS.theme = xtermTheme;
  document.documentElement.style.setProperty('--terminal-bg', xtermTheme.background);
  for (const sess of sessions.values()) {
    if (sess.terminal) sess.terminal.options.theme = xtermTheme;
  }
}

const TERMINAL_OPTIONS = {
  allowProposedApi: true,
  cursorBlink: true,
  fontSize: 14,
  fontFamily: "'Fira Code', 'Menlo', 'Monaco', 'Courier New', 'Symbols Nerd Font Mono', monospace",
  theme: DARK_TERMINAL_THEME,
};

// ── Helpers ──────────────────────────────────────────────────

/** Return the active session or null — avoids repeated null-check boilerplate */
export function getActiveSession() {
  return activeId ? sessions.get(activeId) || null : null;
}


// ── Sessions / Tabs ──────────────────────────────────────────

/**
 * Create a new session tab.
 * @param {'claude'|'terminal'} [type='claude'] — 'claude' spawns Claude Code, 'terminal' spawns user shell
 */
async function createSession(type = 'claude', { claudeSessionId } = {}) {
  const selectedProjectPath = getSelectedProjectPath();
  if (!selectedProjectPath) return;

  const project = projects.find(p => p.path === selectedProjectPath);
  if (!project) return;

  const num = countSessionsForProject(project.path) + 1;
  const isClaude = type === 'claude';

  const panelEl = document.createElement('div');
  panelEl.className = 'terminal-panel';
  const color = getProjectColor(project.name);
  updateAppGlow(project.name);
  terminalsContainer.appendChild(panelEl);

  const terminal = new Terminal({ ...TERMINAL_OPTIONS, fontSize: currentFontSize });
  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  const webLinksAddon = new WebLinksAddon((event, uri) => {
    event.preventDefault();
    api.shell.openExternal(uri);
  });
  const unicode11Addon = new Unicode11Addon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(searchAddon);
  terminal.loadAddon(webLinksAddon);
  terminal.loadAddon(unicode11Addon);
  terminal.unicode.activeVersion = '11';
  terminal.open(panelEl);

  // Force scrollbar flush to right edge (xterm sets inline left/width)
  const scrollbar = panelEl.querySelector('.xterm-scrollable-element > .scrollbar.vertical');
  if (scrollbar) {
    const fixScrollbar = () => {
      scrollbar.style.setProperty('width', '7px', 'important');
      scrollbar.style.setProperty('left', 'auto', 'important');
      scrollbar.style.setProperty('right', '1px', 'important');
    };
    fixScrollbar();
    new MutationObserver(fixScrollbar).observe(scrollbar, { attributes: true, attributeFilter: ['style'] });
  }

  const createParams = {
    cols: terminal.cols,
    rows: terminal.rows,
    cwd: project.path,
    type
  };
  if (claudeSessionId) createParams.claudeSessionId = claudeSessionId;

  const { id, sessionId } = await api.terminal.create(createParams);

  const claudeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="12" height="12" shape-rendering="crispEdges"><rect x="2" y="4" width="12" height="2" fill="currentColor"/><rect x="1" y="6" width="2" height="2" fill="currentColor"/><rect x="5" y="6" width="6" height="2" fill="currentColor"/><rect x="13" y="6" width="2" height="2" fill="currentColor"/><rect x="1" y="8" width="14" height="1" fill="currentColor"/><rect x="2" y="9" width="12" height="3" fill="currentColor"/><rect x="2" y="12" width="1" height="2" fill="currentColor"/><rect x="4" y="12" width="1" height="2" fill="currentColor"/><rect x="11" y="12" width="1" height="2" fill="currentColor"/><rect x="13" y="12" width="1" height="2" fill="currentColor"/></svg>`;
  const termSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,5 8,8 4,11"/><line x1="9" y1="11" x2="12" y2="11"/></svg>`;
  const projColor = `hsl(${color.hue}, ${color.s}%, ${color.l}%)`;
  const projColorBg = `hsla(${color.hue}, ${color.s}%, ${color.l}%, 0.15)`;
  const icon = isClaude
    ? `<span class="tab-icon tab-icon-claude" style="background:${projColorBg};color:${projColor}">${claudeSvg}</span>`
    : `<span class="tab-icon tab-icon-terminal" style="background:${projColorBg};color:${projColor}">${termSvg}</span>`;
  const displayLabel = `${project.name} ${num}`;
  const dot = `<span class="tab-color-dot" style="background:${projColor}"></span>`;

  const tabEl = document.createElement('div');
  tabEl.className = 'tab-item';
  tabEl.dataset.testid = 'tab';
  tabEl.dataset.tabId = String(id);
  tabEl.innerHTML = `${icon}<span class="tab-label" data-testid="tab-label">${displayLabel}</span>${dot}<button class="tab-close" data-testid="tab-close">&times;</button>`;
  tabBarTabs.appendChild(tabEl);

  tabEl.draggable = true;

  tabEl.addEventListener('click', (e) => {
    if (!e.target.closest('.tab-close')) activateTab(id);
  });

  // Double-click to rename tab
  const labelEl = tabEl.querySelector('.tab-label');
  labelEl.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    startTabRename(id, labelEl);
  });

  tabEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showTabContextMenu(id);
  });

  tabEl.addEventListener('dragstart', (e) => {
    draggedTabId = id;
    tabEl.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(id));
  });

  tabEl.addEventListener('dragend', () => {
    tabEl.classList.remove('dragging');
    draggedTabId = null;
    clearDropIndicators();
  });

  tabEl.addEventListener('dragover', (e) => {
    if (draggedTabId === null || draggedTabId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDropIndicators();
    const rect = tabEl.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    tabEl.classList.add(e.clientX < midX ? 'drop-before' : 'drop-after');
  });

  tabEl.addEventListener('dragleave', () => {
    tabEl.classList.remove('drop-before', 'drop-after');
  });

  tabEl.addEventListener('drop', (e) => {
    e.preventDefault();
    if (draggedTabId === null || draggedTabId === id) return;
    const draggedSession = sessions.get(draggedTabId);
    if (!draggedSession) return;

    const rect = tabEl.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const insertBefore = e.clientX < midX;

    if (insertBefore) {
      tabBarTabs.insertBefore(draggedSession.tabEl, tabEl);
    } else {
      tabBarTabs.insertBefore(draggedSession.tabEl, tabEl.nextSibling);
    }
    clearDropIndicators();
  });

  tabEl.querySelector('.tab-close').addEventListener('click', () => closeTab(id));

  const onDataDisposable = terminal.onData((data) => api.terminal.input({ id, data }));

  const unsubData = api.terminal.onData(({ id: termId, data }) => {
    if (termId === id) {
      terminal.write(data);
      // Mark tab as having activity if it's not the active tab
      if (activeId !== id) {
        tabEl.classList.add('tab-activity');
      }
      // Mark project as having activity if it's not the selected project
      const sessionProjectPath = sessions.get(id)?.projectPath;
      if (sessionProjectPath && sessionProjectPath !== getSelectedProjectPath()) {
        if (!projectActivity.has(sessionProjectPath)) {
          projectActivity.add(sessionProjectPath);
          updateProjectActivityBadge(sessionProjectPath);
        }
      }
    }
  });

  const unsubExit = api.terminal.onExit(({ id: termId }) => {
    if (termId === id) closeTab(id);
  });

  const onBellDisposable = terminal.onBell(() => {
    if (activeId !== id) {
      tabEl.classList.add('tab-bell');
      setTimeout(() => tabEl.classList.remove('tab-bell'), 1000);
    }
  });

  let resizeTimeout = null;
  let lastCols = terminal.cols;
  let lastRows = terminal.rows;
  const resizeObserver = new ResizeObserver(() => {
    if (activeId !== id) return;
    // Fit xterm.js immediately so the UI stays responsive
    fitAddon.fit();
    // Debounce the PTY resize to avoid flooding the shell with SIGWINCH
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      resizeTimeout = null;
      if (terminal.cols !== lastCols || terminal.rows !== lastRows) {
        lastCols = terminal.cols;
        lastRows = terminal.rows;
        api.terminal.resize({ id, cols: terminal.cols, rows: terminal.rows });
        updateStatusBar();
      }
    }, 150);
  });
  resizeObserver.observe(panelEl);

  const cleanup = () => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    onDataDisposable.dispose();
    onBellDisposable.dispose();
    unsubData();
    unsubExit();
    resizeObserver.disconnect();
    terminal.dispose();
  };

  sessions.set(id, { terminal, fitAddon, searchAddon, panelEl, tabEl, cleanup, projectPath: project.path, sessionId, type, createdAt: Date.now() });
  activateTab(id);
  renderSidebar();
}

/** Switch the visible tab and focus its terminal */
export function activateTab(id) {
  const session = sessions.get(id);
  if (!session) return;

  // Only deactivate panels/tabs for the same project
  for (const s of sessions.values()) {
    if (s.projectPath === session.projectPath) {
      s.panelEl.classList.remove('active');
      s.tabEl.classList.remove('active');
    }
  }

  session.panelEl.classList.add('active');
  session.panelEl.classList.remove('panel-fade-in');
  // Force reflow to restart animation
  void session.panelEl.offsetWidth;
  session.panelEl.classList.add('panel-fade-in');
  session.tabEl.classList.add('active');
  session.tabEl.classList.remove('tab-activity');
  activeId = id;

  if (session.terminal && session.fitAddon) {
    session.fitAddon.fit();
    api.terminal.resize({ id, cols: session.terminal.cols, rows: session.terminal.rows });
    session.terminal.focus();
  }
  updateStatusBar();
}

/** Close a tab, activating a neighbor within the same project */
export function closeTab(id) {
  const session = sessions.get(id);
  if (!session) return;

  const projectPath = session.projectPath;

  if (session.type !== 'settings') api.terminal.kill({ id });
  session.cleanup();
  session.panelEl.remove();
  session.tabEl.remove();
  sessions.delete(id);

  if (activeId === id) {
    activeId = null;
    const remaining = sessionsForProject(projectPath).map(([sid]) => sid);
    if (remaining.length > 0) {
      activateTab(remaining[remaining.length - 1]);
    }
  }

  renderSidebar();
  updateStatusBar();
}

/**
 * Restore persisted sessions for a project by spawning fresh PTYs.
 * Clears stale entries first — createSession re-records each one.
 */
export async function restoreSessions(projectPath) {
  const saved = await api.projects.getSessions(projectPath);
  if (!saved || saved.length === 0) return;

  // Clear stale entries — fresh PTYs will be recorded by createSession
  await api.projects.clearSessions(projectPath);

  for (const entry of saved) {
    await createSession(entry.type || 'claude', {
      claudeSessionId: entry.claudeSessionId
    });
  }
}

/** Cycle to next or previous tab (within current project) */
function cycleTab(direction) {
  const selectedProjectPath = getSelectedProjectPath();
  if (!selectedProjectPath) return;
  const ids = sessionsForProject(selectedProjectPath).map(([id]) => id);
  if (ids.length < 2) return;
  const idx = ids.indexOf(activeId);
  const offset = direction === 'next' ? 1 : ids.length - 1;
  activateTab(ids[(idx + offset) % ids.length]);
}

/** Activate the Nth tab (0-indexed) in the current project; -1 for last tab */
function goToTab(n) {
  const selectedProjectPath = getSelectedProjectPath();
  if (!selectedProjectPath) return;
  const ids = sessionsForProject(selectedProjectPath).map(([id]) => id);
  if (ids.length === 0) return;
  const idx = n === -1 ? ids.length - 1 : Math.min(n, ids.length - 1);
  activateTab(ids[idx]);
}

// ── Tab drag helpers ─────────────────────────────────────────

function clearDropIndicators() {
  for (const el of tabBarTabs.querySelectorAll('.drop-before, .drop-after')) {
    el.classList.remove('drop-before', 'drop-after');
  }
}

// ── Tab rename ───────────────────────────────────────────────

function startTabRename(tabId, labelEl) {
  const session = sessions.get(tabId);
  if (!session) return;

  const currentText = labelEl.textContent;
  const input = document.createElement('input');
  input.className = 'tab-rename-input';
  input.dataset.testid = 'tab-rename-input';
  input.value = currentText;
  input.style.width = Math.max(60, labelEl.offsetWidth + 10) + 'px';

  labelEl.textContent = '';
  labelEl.appendChild(input);
  input.focus();
  input.select();

  let cancelled = false;

  const finishRename = (commit) => {
    if (!input.parentElement) return; // already removed
    const newName = input.value.trim();
    input.remove();
    if (commit && newName) {
      labelEl.textContent = newName;
      session.customLabel = newName;
    } else {
      labelEl.textContent = session.customLabel || currentText;
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishRename(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelled = true;
      finishRename(false);
    }
    e.stopPropagation(); // prevent keybindings while editing
  });

  input.addEventListener('blur', () => {
    if (!cancelled) finishRename(true);
  });
}

// ── Tab context menu ─────────────────────────────────────────

async function showTabContextMenu(tabId) {
  const session = sessions.get(tabId);
  if (!session) return;

  const projectPath = session.projectPath;
  const projectSessions = sessionsForProject(projectPath);
  const hasOthers = projectSessions.length > 1;

  const action = await api.contextMenu.show([
    { label: 'Duplicate', action: 'duplicate' },
    { type: 'separator' },
    { label: 'Close', action: 'close' },
    { label: 'Close Others', action: 'closeOthers', enabled: hasOthers },
    { label: 'Close All', action: 'closeAll' },
  ]);

  switch (action) {
    case 'duplicate':
      createSession(session.type);
      break;
    case 'close':
      closeTab(tabId);
      break;
    case 'closeOthers':
      closeOtherTabs(tabId);
      break;
    case 'closeAll':
      closeAllTabs(projectPath);
      break;
  }
}

function closeOtherTabs(keepId) {
  const session = sessions.get(keepId);
  if (!session) return;
  const toClose = sessionsForProject(session.projectPath)
    .filter(([id]) => id !== keepId)
    .map(([id]) => id);
  for (const id of toClose) closeTab(id);
  activateTab(keepId);
}

function closeAllTabs(projectPath) {
  const toClose = sessionsForProject(projectPath).map(([id]) => id);
  for (const id of toClose) closeTab(id);
}

// ── Font size zoom ───────────────────────────────────────────

const DEFAULT_FONT_SIZE = 14;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 32;
let currentFontSize = DEFAULT_FONT_SIZE;

function setFontSize(size) {
  currentFontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, size));
  for (const [, session] of sessions) {
    session.terminal.options.fontSize = currentFontSize;
    session.fitAddon.fit();
  }
  if (api.windowState) {
    api.windowState.setFontSize(currentFontSize);
  }
  updateStatusBar();
}

function zoomIn() { setFontSize(currentFontSize + 1); }
function zoomOut() { setFontSize(currentFontSize - 1); }
function zoomReset() { setFontSize(DEFAULT_FONT_SIZE); }

// ── Clear terminal (Cmd+K) ───────────────────────────────────

function clearTerminal() {
  const session = getActiveSession();
  if (!session) return;
  session.terminal.clear();
}

// ── Clipboard (Cmd+Shift+C / Cmd+Shift+V) ───────────────────

function copySelection() {
  const session = getActiveSession();
  if (!session) return;
  const selection = session.terminal.getSelection();
  if (selection) {
    api.clipboard.writeText(selection);
  }
}

function pasteClipboard() {
  if (!getActiveSession()) return;
  const text = api.clipboard.readText();
  if (text) {
    api.terminal.input({ id: activeId, data: text });
  }
}


// ── Select All (Cmd+A) ───────────────────────────────────────

function selectAll() {
  const session = getActiveSession();
  if (!session) return;
  session.terminal.selectAll();
}

// ── Move tab (Cmd+Shift+Left/Right) ──────────────────────────

function moveTab(direction) {
  const session = getActiveSession();
  const selectedProjectPath = getSelectedProjectPath();
  if (!session || !selectedProjectPath) return;

  // Get visible tab elements for the current project
  const allTabs = [...tabBarTabs.children];
  const projectTabs = allTabs.filter(el => {
    const tabId = Number(el.dataset.tabId);
    const s = sessions.get(tabId);
    return s && s.projectPath === selectedProjectPath;
  });

  if (projectTabs.length < 2) return;

  const currentTab = session.tabEl;
  const idx = projectTabs.indexOf(currentTab);
  if (idx === -1) return;

  if (direction === 'left') {
    if (idx === 0) {
      // Wrap: move to after the last project tab
      const lastTab = projectTabs[projectTabs.length - 1];
      tabBarTabs.insertBefore(currentTab, lastTab.nextSibling);
    } else {
      // Move before the previous project tab
      tabBarTabs.insertBefore(currentTab, projectTabs[idx - 1]);
    }
  } else {
    if (idx === projectTabs.length - 1) {
      // Wrap: move to before the first project tab
      tabBarTabs.insertBefore(currentTab, projectTabs[0]);
    } else {
      // Move after the next project tab
      tabBarTabs.insertBefore(currentTab, projectTabs[idx + 1].nextSibling);
    }
  }
}

// ── Status bar ───────────────────────────────────────────────

let statusProjectEl;
let statusSessionTypeEl;
let statusUptimeEl;
let statusTerminalSizeEl;
let uptimeInterval = null;

function formatUptime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function updateStatusBar() {
  if (!statusProjectEl) return;

  const selectedProjectPath = getSelectedProjectPath();
  if (!selectedProjectPath) {
    statusProjectEl.textContent = '';
    statusSessionTypeEl.textContent = '';
    statusUptimeEl.textContent = '';
    statusTerminalSizeEl.textContent = '';
    stopUptimeTimer();
    return;
  }

  const project = projects.find(p => p.path === selectedProjectPath);
  statusProjectEl.textContent = project ? project.name : '';

  const session = getActiveSession();
  if (session) {
    if (session.type === 'settings') {
      statusSessionTypeEl.textContent = 'Settings';
      statusTerminalSizeEl.textContent = '';
    } else {
      statusSessionTypeEl.textContent = session.type === 'claude' ? 'Claude' : 'Terminal';
      statusTerminalSizeEl.textContent = `${session.terminal.cols}\u00d7${session.terminal.rows}`;
    }
    statusUptimeEl.textContent = formatUptime(Date.now() - session.createdAt);
    startUptimeTimer();
  } else {
    statusSessionTypeEl.textContent = '';
    statusTerminalSizeEl.textContent = '';
    statusUptimeEl.textContent = '';
    stopUptimeTimer();
  }
}

function startUptimeTimer() {
  if (uptimeInterval) return;
  uptimeInterval = setInterval(() => {
    const session = getActiveSession();
    if (session && statusUptimeEl) {
      statusUptimeEl.textContent = formatUptime(Date.now() - session.createdAt);
    }
  }, 1000);
}

function stopUptimeTimer() {
  if (uptimeInterval) {
    clearInterval(uptimeInterval);
    uptimeInterval = null;
  }
}

// ── Test helpers ─────────────────────────────────────────────

window._claudiuGetBufferText = (targetId) => {
  const session = sessions.get(targetId || activeId);
  if (!session) return '';
  const buf = session.terminal.buffer.active;
  let text = '';
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (line) text += line.translateToString(true) + '\n';
  }
  return text;
};

window._claudiuActiveTabId = () => activeId;
window._claudiuSelectedProject = () => getSelectedProjectPath();
window._claudiuProjectMRU = () => [...projectMRU];
window._claudiuCloseOtherTabs = (keepId) => closeOtherTabs(keepId);
window._claudiuCloseAllTabs = (projectPath) => closeAllTabs(projectPath || getSelectedProjectPath());
window._claudiuDuplicateTab = (tabId) => {
  const session = sessions.get(tabId);
  if (!session) return;
  createSession(session.type);
};
window._claudiuGetTabContextMenuItems = (tabId) => {
  const session = sessions.get(tabId);
  if (!session) return null;
  const projectSessions = sessionsForProject(session.projectPath);
  return [
    { label: 'Duplicate', action: 'duplicate' },
    { label: 'Close', action: 'close' },
    { label: 'Close Others', action: 'closeOthers', enabled: projectSessions.length > 1 },
    { label: 'Close All', action: 'closeAll' },
  ];
};

window._claudiuGetTabOrder = () => {
  return [...tabBarTabs.children]
    .filter(el => el.style.display !== 'none')
    .map(el => el.querySelector('.tab-label')?.textContent || '');
};
window._claudiuGetProjectContextMenuItems = (projectPath) => {
  return [
    { label: 'Reveal in Finder', action: 'revealInFinder' },
    { label: 'Copy Path', action: 'copyPath' },
    { label: 'Project Settings…', action: 'projectSettings' },
    { label: 'Remove Project', action: 'remove' },
  ];
};
window._claudiuIsSidebarVisible = () => getSidebarMode() === 'pinned' || getSidebarRevealed();
window._claudiuGetSidebarMode = () => getSidebarMode();
window._claudiuProjectActivity = () => [...projectActivity];
window._claudiuGetSessionsForProject = (projectPath) => {
  return sessionsForProject(projectPath).map(([id]) => id);
};

// Reload projects from store and re-render sidebar (used by tests)
window._claudiuReloadProjects = (projectList) => {
  refreshProjectList(projectList);
  if (getSelectedProjectPath() && !projects.some(p => p.path === getSelectedProjectPath())) {
    setSelectedProjectPath(null);
  }
  renderSidebar();
};

// Select a project programmatically (used by tests)
window._claudiuSelectProject = (projectPath) => {
  selectProject(projectPath);
};
window._claudiuAddDebugEntry = addDebugEntry;

// ── Keybindings ──────────────────────────────────────────────

function normalizeKeyEvent(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  parts.push(e.key);
  return parts.join('+');
}

// ── Sound Theme ───────────────────────────────────────────────

/** Cached Audio objects keyed by event name */
const soundCache = new Map();

/** Load (or reload) the active sound theme into the cache */
export async function loadSoundTheme() {
  soundCache.clear();
  if (!api.soundThemes) return;
  const soundMap = await api.soundThemes.getSounds(getSelectedProjectPath());
  if (!soundMap) return;
  for (const [event, entry] of Object.entries(soundMap)) {
    const audio = new Audio(entry.url);
    audio.preload = 'auto';
    audio.volume = 1.0;
    soundCache.set(event, { audio, trimStart: entry.trimStart, trimEnd: entry.trimEnd });
  }
}

/** Play the sound for a hook event (if mapped) */
function playEventSound(eventName) {
  const entry = soundCache.get(eventName);
  if (!entry) return;
  const clone = entry.audio.cloneNode();
  clone.volume = entry.audio.volume;
  if (entry.trimStart != null) clone.currentTime = entry.trimStart;
  if (entry.trimEnd != null) {
    clone.addEventListener('timeupdate', () => {
      if (clone.currentTime >= entry.trimEnd) clone.pause();
    });
  }
  clone.play().catch(() => { /* ignore autoplay blocks */ });
}

/** Wire up hook events to sound playback */
function initSoundTheme() {
  // Initial load
  loadSoundTheme();

  // Play sounds on hook events
  api.hooks.onEvent(({ event }) => {
    playEventSound(event);
  });
}

// ── Init ─────────────────────────────────────────────────────

async function init() {
  terminalsContainer = document.getElementById('terminals');
  tabBarTabs = document.querySelector('.titlebar-tabs');
  sidebarProjectsEl = document.querySelector('[data-testid="project-list"]');
  sidebarEl = document.querySelector('[data-testid="sidebar"]');
  emptyStateEl = document.querySelector('[data-testid="empty-state"]');
  debugPaneEl = document.querySelector('[data-testid="debug-pane"]');
  debugPaneEntriesEl = document.querySelector('[data-testid="debug-pane-entries"]');
  debugPaneCountEl = document.querySelector('[data-testid="debug-pane-count"]');
  debugPaneResizeHandle = document.querySelector('[data-testid="debug-pane-resize-handle"]');

  // Status bar elements
  statusProjectEl = document.querySelector('[data-testid="status-project"]');
  statusSessionTypeEl = document.querySelector('[data-testid="status-session-type"]');
  statusUptimeEl = document.querySelector('[data-testid="status-uptime"]');
  statusTerminalSizeEl = document.querySelector('[data-testid="status-terminal-size"]');

  // Display app version
  const statusVersionEl = document.querySelector('[data-testid="status-version"]');
  if (statusVersionEl) {
    api.getVersion().then(v => { statusVersionEl.textContent = `v${v}`; }).catch(() => {});
  }

  // Auto-updater notification
  if (api.updater) {
    api.updater.onUpdateDownloaded(({ version }) => {
      // Don't add duplicate banners
      if (document.querySelector('.update-banner')) return;
      const banner = document.createElement('div');
      banner.className = 'update-banner';
      banner.dataset.testid = 'update-banner';
      banner.textContent = `Update v${version} ready \u2014 click to restart`;
      banner.addEventListener('click', () => api.updater.installNow());
      const mainArea = document.querySelector('.main-area');
      const tabBar = mainArea.querySelector('.tab-bar');
      mainArea.insertBefore(banner, tabBar.nextSibling);
    });
  }

  // Restore sidebar width, mode, and font size from persisted state
  if (api.windowState) {
    const savedWidth = await api.windowState.getSidebarWidth();
    if (savedWidth && savedWidth > 0) {
      setSidebarWidth(savedWidth);
    }
    const savedMode = await api.windowState.getSidebarMode();
    if (savedMode === 'pinned' || savedMode === 'autohide') {
      setSidebarMode(savedMode);
    }
    // HTML starts with sidebar-autohide class (default).
    if (getSidebarMode() === 'pinned') {
      document.querySelector('.app-body').classList.remove('sidebar-autohide');
      sidebarEl.style.width = getSidebarWidth() + 'px';
      document.documentElement.style.setProperty('--sidebar-width', getSidebarWidth() + 'px');
    } else {
      // Autohide: collapse to 0
      sidebarEl.style.width = '0';
      document.documentElement.style.setProperty('--sidebar-width', '0px');
    }
    const savedFontSize = await api.windowState.getFontSize();
    if (savedFontSize && savedFontSize >= MIN_FONT_SIZE && savedFontSize <= MAX_FONT_SIZE) {
      currentFontSize = savedFontSize;
      TERMINAL_OPTIONS.fontSize = currentFontSize;
    }

    // Apply theme setting
    const resolvedTheme = await api.appConfig.resolve('theme', null);
    applyThemeSetting(resolvedTheme || 'system');

    // Listen for OS theme changes (relevant when theme is 'system')
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (!document.documentElement.hasAttribute('data-theme')) {
        // System mode — re-sync xterm themes
        const xtermTheme = getTerminalTheme();
        TERMINAL_OPTIONS.theme = xtermTheme;
        document.documentElement.style.setProperty('--terminal-bg', xtermTheme.background);
        for (const sess of sessions.values()) {
          sess.terminal.options.theme = xtermTheme;
        }
      }
    });

    // Restore debug pane state
    const savedDebugHeight = await api.windowState.getDebugPaneHeight();
    if (savedDebugHeight && savedDebugHeight > 0) setDebugPaneHeight(savedDebugHeight);
    const savedDebugOpen = await api.windowState.getDebugPaneOpen();
    if (savedDebugOpen) {
      setDebugPaneOpen(true);
      debugPaneEl.style.height = getDebugPaneHeight() + 'px';
      debugPaneEl.classList.add('open');
      debugPaneResizeHandle.classList.add('visible');
    }
  }

  // Wire up debug pane
  if (api.log) {
    // Load history
    const history = await api.log.getHistory();
    for (const entry of history) addDebugEntry(entry);

    // Stream new entries
    api.log.onEntry((entry) => addDebugEntry(entry));
  }

  // Clear button
  document.querySelector('[data-testid="debug-pane-clear-btn"]')
    .addEventListener('click', clearDebugPane);

  // Track scroll position for auto-scroll behavior
  debugPaneEntriesEl.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = debugPaneEntriesEl;
    setDebugAutoScroll(scrollTop + clientHeight >= scrollHeight - 10);
  });

  // Sidebar: add project button
  document.querySelector('[data-testid="add-project-btn"]')
    .addEventListener('click', addProject);

  // Load persisted projects and seed MRU from their order
  const savedProjects = await api.projects.list();
  for (const p of savedProjects) {
    projects.push(p);
    projectMRU.push(p.path);
  }

  // If there are projects, select the first one (restoreSessions is called inside selectProject)
  if (projects.length > 0) {
    selectProject(projects[0].path);
  } else {
    renderSidebar();
  }

  // Listen for open-project from main process (CLI invocation / second instance)
  api.projects.onOpen(async (projectPath) => {
    // Reload projects from store in case main process added a new one
    refreshProjectList(await api.projects.list());
    selectProject(projectPath);
  });

  // Register keybinding actions
  actions.set('createClaudeSession', () => createSession('claude'));
  actions.set('createTerminalSession', () => createSession('terminal'));
  actions.set('closeActiveTab', () => { if (activeId !== null) closeTab(activeId); });
  actions.set('openProjectPicker', openProjectPicker);
  actions.set('addProject', addProject);
  actions.set('prevTab', () => cycleTab('prev'));
  actions.set('nextTab', () => cycleTab('next'));
  actions.set('prevProject', () => cycleProject('prev'));
  actions.set('nextProject', () => cycleProject('next'));
  actions.set('openSearchBar', openSearchBar);
  actions.set('zoomIn', zoomIn);
  actions.set('zoomOut', zoomOut);
  actions.set('zoomReset', zoomReset);
  actions.set('clearTerminal', clearTerminal);
  actions.set('copySelection', copySelection);
  actions.set('pasteClipboard', pasteClipboard);
  actions.set('moveTabLeft', () => moveTab('left'));
  actions.set('moveTabRight', () => moveTab('right'));
  actions.set('selectAll', selectAll);
  actions.set('toggleSidebar', toggleSidebar);

  // Sidebar toggle button in titlebar
  document.querySelector('.sidebar-toggle-btn')?.addEventListener('click', toggleSidebar);
  actions.set('closeOtherTabs', () => { if (activeId !== null) closeOtherTabs(activeId); });
  actions.set('openSettings', openSettings);
  actions.set('showShortcutHelp', showShortcutHelp);
  actions.set('toggleDebugPane', toggleDebugPane);
  for (let i = 1; i <= 8; i++) {
    actions.set(`goToTab${i}`, () => goToTab(i - 1));
  }
  actions.set('goToLastTab', () => goToTab(-1));

  // Data-driven keyboard dispatch
  document.addEventListener('keydown', (e) => {
    const key = normalizeKeyEvent(e);
    const actionName = keybindings[key];
    if (!actionName) return;
    const handler = actions.get(actionName);
    if (!handler) return;
    e.preventDefault();
    handler();
  });

  document.querySelector('[data-testid="new-tab-btn"]').addEventListener('click', () => createSession('claude'));

  document.querySelector('.ess-card[data-action="claude"]').addEventListener('click', () => createSession('claude'));
  document.querySelector('.ess-card[data-action="terminal"]').addEventListener('click', () => createSession('terminal'));

  // Sound theme — play sounds on hook events
  initSoundTheme();

  initSidebarResize();
  initDebugPaneResize();
  initSidebarAutoHide();

  // Enable sidebar transitions after first paint to prevent slide-on-load
  requestAnimationFrame(() => {
    document.querySelector('.app-body').classList.add('sidebar-transitions');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
