/**
 * Terminal — theme, session lifecycle, font zoom, terminal actions,
 * sound theme, status bar.
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { getProjectColor } from './projectColors.js';
import { createTabElement } from './tabs.js';
import {
  projects, projectActivity,
  getSelectedProjectPath,
  sessionsForProject, countSessionsForProject,
  renderSidebar, updateEmptyState, updateAppGlow,
  updateProjectActivityBadge,
} from './sidebar.js';
import { addDebugEntry } from './overlays.js';

const api = window.electron_api;

// ── Session state (source of truth) ──────────────────────────

export const sessions = new Map(); // id -> { terminal, fitAddon, panelEl, tabEl, cleanup, projectPath, sessionId, type, createdAt }
let activeId = null;

// Static DOM elements (populated in initTerminal)
let terminalsContainer;
let tabBarTabs;

// Getter/setter functions
export function getActiveId() { return activeId; }
export function setActiveId(id) { activeId = id; }
export function getTerminalsContainer() { return terminalsContainer; }
export function getTabBarTabs() { return tabBarTabs; }

/** Initialise DOM refs owned by the terminal module. Called from init(). */
export function initTerminal() {
  terminalsContainer = document.getElementById('terminals');
  tabBarTabs = document.querySelector('.titlebar-tabs');
}

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

export function getCurrentThemeMode() {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  // system: check OS preference
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function getTerminalTheme() {
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

export const TERMINAL_OPTIONS = {
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

/** Refit the active terminal after a layout change (sidebar/debug pane resize) */
export function refitActiveTerminal() {
  const session = getActiveSession();
  if (session) session.fitAddon.fit();
}

// ── Sessions / Tabs ──────────────────────────────────────────

/**
 * Create a new session tab.
 * @param {'claude'|'terminal'} [type='claude'] — 'claude' spawns Claude Code, 'terminal' spawns user shell
 */
export async function createSession(type = 'claude', { claudeSessionId } = {}) {
  const selectedProjectPath = getSelectedProjectPath();
  if (!selectedProjectPath) return;

  const project = projects.find(p => p.path === selectedProjectPath);
  if (!project) return;

  const num = countSessionsForProject(project.path) + 1;

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

  const tabEl = createTabElement(
    id,
    { projectName: project.name, projectColor: color, type, num },
    { onActivate: () => activateTab(id), onClose: () => closeTab(id) }
  );
  tabBarTabs.appendChild(tabEl);

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

// ── Font size zoom ───────────────────────────────────────────

const DEFAULT_FONT_SIZE = 14;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 32;
export let currentFontSize = DEFAULT_FONT_SIZE;

/** Set the initial font size at startup (before any sessions exist). */
export function setInitialFontSize(size) {
  currentFontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, size));
  TERMINAL_OPTIONS.fontSize = currentFontSize;
}

export function setFontSize(size) {
  currentFontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, size));
  for (const session of sessions.values()) {
    session.terminal.options.fontSize = currentFontSize;
    session.fitAddon.fit();
  }
  if (api.windowState) {
    api.windowState.set('fontSize', currentFontSize);
  }
  updateStatusBar();
}

export function zoomIn() { setFontSize(currentFontSize + 1); }
export function zoomOut() { setFontSize(currentFontSize - 1); }
export function zoomReset() { setFontSize(DEFAULT_FONT_SIZE); }

// ── Clear terminal (Cmd+K) ───────────────────────────────────

export function clearTerminal() {
  const session = getActiveSession();
  if (!session) return;
  session.terminal.clear();
}

// ── Clipboard (Cmd+Shift+C / Cmd+Shift+V) ───────────────────

export function copySelection() {
  const session = getActiveSession();
  if (!session) return;
  const selection = session.terminal.getSelection();
  if (selection) {
    api.clipboard.writeText(selection);
  }
}

export function pasteClipboard() {
  if (!getActiveSession()) return;
  const text = api.clipboard.readText();
  if (text) {
    api.terminal.input({ id: activeId, data: text });
  }
}

// ── Select All (Cmd+A) ───────────────────────────────────────

export function selectAll() {
  const session = getActiveSession();
  if (!session) return;
  session.terminal.selectAll();
}

// ── Project Background Image ──────────────────────────────────

/** Apply (or clear) the per-project background image on .terminals-container.
 *  @param {string} projectPath — active project
 *  @param {string} [imagePathOverride] — pass directly to skip IPC resolve (avoids autoSave race)
 */
export async function applyProjectBackground(projectPath, imagePathOverride) {
  const container = terminalsContainer || document.getElementById('terminals');
  if (!container) return;
  const bgImage = imagePathOverride !== undefined
    ? imagePathOverride
    : await api.appConfig.resolve('backgroundImage', projectPath);
  if (bgImage) {
    container.style.setProperty('--bg-image', `url("file://${bgImage}")`);
    container.classList.add('has-bg-image');
  } else {
    container.style.removeProperty('--bg-image');
    container.classList.remove('has-bg-image');
  }
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
export function initSoundTheme() {
  // Initial load
  loadSoundTheme();

  // Play sounds on hook events
  api.hooks.onEvent(({ event }) => {
    playEventSound(event);
  });
}

// ── Status bar ───────────────────────────────────────────────

let statusProjectEl;
let statusSessionTypeEl;
let statusUptimeEl;
let statusTerminalSizeEl;
let uptimeInterval = null;

/** Initialise status bar DOM refs. Called from init(). */
export function initStatusBar() {
  statusProjectEl = document.querySelector('[data-testid="status-project"]');
  statusSessionTypeEl = document.querySelector('[data-testid="status-session-type"]');
  statusUptimeEl = document.querySelector('[data-testid="status-uptime"]');
  statusTerminalSizeEl = document.querySelector('[data-testid="status-terminal-size"]');
}

export function formatUptime(ms) {
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
