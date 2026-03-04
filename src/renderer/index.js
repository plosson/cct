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

const api = window.electron_api;

// Expose for testing
window._claudiuProjectColors = { getProjectColor };

const sessions = new Map(); // id -> { terminal, fitAddon, panelEl, tabEl, cleanup, projectPath, sessionId, type, createdAt }
let activeId = null;
let selectedProjectPath = null;
let sessionCounter = 0;

// MRU ordering for project picker (most recently selected first)
const projectMRU = [];

// Tab drag-and-drop state
let draggedTabId = null;

// Project-level activity tracking
const projectActivity = new Set();

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

const actions = new Map();

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
let debugPaneOpen = false;
let debugPaneHeight = 200;

// Project list (synced with ProjectStore via IPC)
const projects = [];

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

function applyThemeSetting(theme) {
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
  // Update project accent colors for the new theme
  updateProjectIdentity();
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
function getActiveSession() {
  return activeId ? sessions.get(activeId) || null : null;
}

/** Focus the active terminal — used after closing overlays and search */
function refocusTerminal() {
  const session = getActiveSession();
  if (session) session.terminal.focus();
}

/** Update the app-shell glow color based on the active project */
function updateAppGlow(projectNameOrPath) {
  const appEl = document.querySelector('.app');
  if (!projectNameOrPath) {
    appEl.classList.remove('has-glow');
    return;
  }
  // Accept either a project name or path — look up name from projects array if it's a path
  const proj = projects.find(p => p.path === projectNameOrPath);
  const name = proj ? proj.name : projectNameOrPath;
  const color = getProjectColor(name);
  appEl.style.setProperty('--glow-color', `hsla(${color.hue}, ${color.s}%, ${color.l}%, 0.55)`);
  appEl.style.setProperty('--glow-color-dim', `hsla(${color.hue}, ${color.s}%, ${color.l}%, 0.25)`);
  appEl.classList.add('has-glow');
}

// ── Empty state ─────────────────────────────────────────────

function getEmptyStateMessage() {
  if (projects.length === 0) return 'Add a project to get started';
  if (!selectedProjectPath) return 'Select a project from the sidebar';
  if (countSessionsForProject(selectedProjectPath) === 0) return 'No sessions — click + to create one';
  return null;
}

function updateEmptyState() {
  const message = getEmptyStateMessage();
  if (!message) {
    emptyStateEl.style.display = 'none';
    return;
  }
  emptyStateEl.style.display = 'flex';
  const msgEl = emptyStateEl.querySelector('.empty-state-msg');
  const sessionsEl = emptyStateEl.querySelector('.empty-state-sessions');
  const isNoSessions = selectedProjectPath && countSessionsForProject(selectedProjectPath) === 0;
  if (isNoSessions) {
    msgEl.style.display = 'none';
    sessionsEl.style.display = 'flex';
    // Color empty state cards with project color
    const proj = projects.find(p => p.path === selectedProjectPath);
    if (proj) {
      const c = getProjectColor(proj.name);
      const col = `hsl(${c.hue}, ${c.s}%, ${c.l}%)`;
      const colBg = `hsla(${c.hue}, ${c.s}%, ${c.l}%, 0.1)`;
      const colBorder = `hsla(${c.hue}, ${c.s}%, ${c.l}%, 0.3)`;
      sessionsEl.querySelectorAll('.ess-card').forEach(card => {
        card.style.borderColor = colBorder;
        card.style.background = colBg;
        card.querySelector('.ess-icon').style.color = col;
        card.querySelector('.ess-label').style.color = col;
        // Recolor SVG fills to project color (skip white pixels used for eyes)
        card.querySelectorAll('rect[fill]').forEach(r => {
          if (r.getAttribute('fill') !== '#ffffff') r.setAttribute('fill', col);
        });
      });
    }
  } else {
    msgEl.textContent = message;
    msgEl.style.display = '';
    sessionsEl.style.display = 'none';
  }
}

// ── Sidebar ──────────────────────────────────────────────────

function renderSidebar() {
  sidebarProjectsEl.innerHTML = '';
  for (const project of projects) {
    const el = document.createElement('div');
    el.className = 'sidebar-project';
    if (project.path === selectedProjectPath) el.classList.add('selected');
    if (projectActivity.has(project.path)) el.classList.add('project-activity');
    el.dataset.testid = 'project-item';
    el.dataset.projectPath = project.path;

    const sessionCount = countSessionsForProject(project.path);

    const color = getProjectColor(project.name);
    const folderColor = `hsl(${color.hue}, ${color.s}%, ${color.l + 10}%)`;

    el.innerHTML = `
      <span class="sidebar-project-icon" style="color: ${folderColor}">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h3.3a1.5 1.5 0 0 1 1.1.5L8.6 3.5H13A1.5 1.5 0 0 1 14.5 5v7.5A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5V3z"/>
        </svg>
      </span>
      <span class="sidebar-project-name">${project.name}</span>
      <span class="sidebar-project-count" data-testid="session-count">${sessionCount}</span>
      <button class="sidebar-project-remove" data-testid="remove-project-btn">&times;</button>
    `;

    el.addEventListener('click', (e) => {
      if (!e.target.closest('.sidebar-project-remove')) {
        selectProject(project.path);
      }
    });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showProjectContextMenu(project.path);
    });

    el.querySelector('.sidebar-project-remove').addEventListener('click', () => {
      removeProject(project.path);
    });

    sidebarProjectsEl.appendChild(el);
  }
  updateEmptyState();
}

function updateProjectActivityBadge(projectPath) {
  const el = sidebarProjectsEl?.querySelector(`[data-project-path="${CSS.escape(projectPath)}"]`);
  if (!el) return;
  el.classList.toggle('project-activity', projectActivity.has(projectPath));
}

function selectProject(projectPath) {
  // Clear project activity badge when switching to a project
  projectActivity.delete(projectPath);
  selectedProjectPath = projectPath;

  // Update MRU: move to front
  const mruIdx = projectMRU.indexOf(projectPath);
  if (mruIdx !== -1) projectMRU.splice(mruIdx, 1);
  projectMRU.unshift(projectPath);

  // Show/hide tabs and panels for the selected project (settings tabs always visible)
  for (const [, s] of sessions.entries()) {
    const belongsToProject = s.projectPath === projectPath || s.type === 'settings';
    s.tabEl.style.display = belongsToProject ? '' : 'none';
    if (!belongsToProject) {
      s.panelEl.classList.remove('active');
      s.tabEl.classList.remove('active');
    }
  }

  // Update app glow to match selected project
  updateAppGlow(projectPath);

  // Activate the last active tab for this project, or clear
  const projectSessionIds = sessionsForProject(projectPath).map(([id]) => id);
  if (projectSessionIds.length > 0) {
    activateTab(projectSessionIds[projectSessionIds.length - 1]);
  } else {
    activeId = null;
    // Restore persisted sessions if no live sessions exist
    restoreSessions(projectPath);
  }

  renderSidebar();
  updateStatusBar();
  updateProjectIdentity();
}

function updateProjectIdentity() {
  // No-op — per-project accent colors removed; kept for call-site compatibility
}

/** Get all session [id, session] entries for a given project path */
function sessionsForProject(projectPath) {
  return [...sessions.entries()].filter(([, s]) => s.projectPath === projectPath);
}

function countSessionsForProject(projectPath) {
  return sessionsForProject(projectPath).length;
}

/** Replace the in-memory project list and sync MRU (remove stale, add new) */
function refreshProjectList(projectList) {
  projects.length = 0;
  projects.push(...projectList);
  const validPaths = new Set(projectList.map(p => p.path));
  for (let i = projectMRU.length - 1; i >= 0; i--) {
    if (!validPaths.has(projectMRU[i])) projectMRU.splice(i, 1);
  }
  for (const p of projectList) {
    if (!projectMRU.includes(p.path)) projectMRU.push(p.path);
  }
}

async function addProject() {
  const project = await api.projects.add();
  if (!project) return; // dialog canceled
  if (!projects.some(p => p.path === project.path)) {
    projects.push(project);
  }
  selectProject(project.path);
}

async function removeProject(projectPath) {
  await api.projects.remove(projectPath);

  // Close all sessions for this project
  for (const [id] of sessionsForProject(projectPath)) closeTab(id);

  // Remove from local list and MRU
  const idx = projects.findIndex(p => p.path === projectPath);
  if (idx !== -1) projects.splice(idx, 1);
  const mruIdx = projectMRU.indexOf(projectPath);
  if (mruIdx !== -1) projectMRU.splice(mruIdx, 1);

  // If we removed the selected project, select another or clear
  if (selectedProjectPath === projectPath) {
    selectedProjectPath = projects.length > 0 ? projects[0].path : null;
    if (selectedProjectPath) {
      selectProject(selectedProjectPath);
      return;
    }
  }

  renderSidebar();
  updateProjectIdentity();
}

// ── Sessions / Tabs ──────────────────────────────────────────

/**
 * Create a new session tab.
 * @param {'claude'|'terminal'} [type='claude'] — 'claude' spawns Claude Code, 'terminal' spawns user shell
 */
async function createSession(type = 'claude', { claudeSessionId } = {}) {
  if (!selectedProjectPath) return;

  const project = projects.find(p => p.path === selectedProjectPath);
  if (!project) return;

  sessionCounter++;
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
      if (sessionProjectPath && sessionProjectPath !== selectedProjectPath) {
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
function activateTab(id) {
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
function closeTab(id) {
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
async function restoreSessions(projectPath) {
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

/** Cycle to next or previous project in the sidebar (wraps around) */
function cycleProject(direction) {
  if (projects.length < 2) return;
  const idx = projects.findIndex(p => p.path === selectedProjectPath);
  const offset = direction === 'next' ? 1 : projects.length - 1;
  selectProject(projects[(idx + offset) % projects.length].path);
}

/** Cycle to next or previous tab (within current project) */
function cycleTab(direction) {
  if (!selectedProjectPath) return;
  const ids = sessionsForProject(selectedProjectPath).map(([id]) => id);
  if (ids.length < 2) return;
  const idx = ids.indexOf(activeId);
  const offset = direction === 'next' ? 1 : ids.length - 1;
  activateTab(ids[(idx + offset) % ids.length]);
}

/** Activate the Nth tab (0-indexed) in the current project; -1 for last tab */
function goToTab(n) {
  if (!selectedProjectPath) return;
  const ids = sessionsForProject(selectedProjectPath).map(([id]) => id);
  if (ids.length === 0) return;
  const idx = n === -1 ? ids.length - 1 : Math.min(n, ids.length - 1);
  activateTab(ids[idx]);
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

    item.innerHTML = `
      <span class="project-picker-item-name">${project.name}</span>
      <span class="project-picker-item-path">${project.path}</span>
    `;

    item.addEventListener('click', () => {
      selectProject(project.path);
      closeProjectPicker();
    });

    listEl.appendChild(item);
  });
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

// ── Project context menu ─────────────────────────────────────

async function showProjectContextMenu(projectPath) {
  const action = await api.contextMenu.show([
    { label: 'Reveal in Finder', action: 'revealInFinder' },
    { label: 'Copy Path', action: 'copyPath' },
    { type: 'separator' },
    { label: 'Project Settings…', action: 'projectSettings' },
    { type: 'separator' },
    { label: 'Remove Project', action: 'remove' },
  ]);

  switch (action) {
    case 'revealInFinder':
      api.shell.showItemInFolder(projectPath);
      break;
    case 'copyPath':
      api.clipboard.writeText(projectPath);
      break;
    case 'projectSettings':
      selectProject(projectPath);
      openSettings();
      break;
    case 'remove':
      removeProject(projectPath);
      break;
  }
}

// ── Terminal search (Cmd+F) ──────────────────────────────────

let searchBarEl = null;

function openSearchBar() {
  if (!activeId) return;
  if (searchBarEl) { focusSearchBar(); return; }

  const session = sessions.get(activeId);
  if (!session) return;

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

  // Insert into the active panel's parent (main area)
  const mainArea = document.querySelector('.main-area');
  mainArea.insertBefore(searchBarEl, terminalsContainer);

  const doSearch = (direction = 'next') => {
    const s = sessions.get(activeId);
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

// ── Sidebar Auto-Hide (Dock Mode) ────────────────────────────

let sidebarMode = 'pinned'; // 'pinned' | 'autohide'
let sidebarRevealed = false;
let sidebarHideTimeout = null;
let sidebarWidth = 220; // persisted width, used to restore on reveal

/** Toggle between pinned and autohide sidebar modes */
function toggleSidebar() {
  const appBody = document.querySelector('.app-body');

  if (sidebarMode === 'pinned') {
    // Switch to autohide — collapse sidebar
    sidebarMode = 'autohide';
    appBody.classList.add('sidebar-autohide', 'sidebar-transitions');
    sidebarEl.classList.remove('sidebar-revealed');
    sidebarEl.style.width = '0';
    document.documentElement.style.setProperty('--sidebar-width', '0px');
    sidebarRevealed = false;
  } else {
    // Switch to pinned — restore sidebar width
    sidebarMode = 'pinned';
    if (sidebarHideTimeout) {
      clearTimeout(sidebarHideTimeout);
      sidebarHideTimeout = null;
    }
    appBody.classList.remove('sidebar-autohide');
    sidebarEl.classList.remove('sidebar-revealed');
    sidebarEl.style.width = sidebarWidth + 'px';
    document.documentElement.style.setProperty('--sidebar-width', sidebarWidth + 'px');
    sidebarRevealed = false;
  }

  if (api.windowState) {
    api.windowState.setSidebarMode(sidebarMode);
  }
}

/** Reveal the sidebar in autohide mode */
function revealSidebar() {
  if (sidebarMode !== 'autohide') return;
  if (sidebarHideTimeout) {
    clearTimeout(sidebarHideTimeout);
    sidebarHideTimeout = null;
  }
  if (!sidebarRevealed) {
    sidebarRevealed = true;
    sidebarEl.style.width = sidebarWidth + 'px';
    sidebarEl.classList.add('sidebar-revealed');
  }
}

/** Schedule hiding the sidebar after a delay */
function scheduleSidebarHide() {
  if (sidebarMode !== 'autohide') return;
  if (sidebarHideTimeout) clearTimeout(sidebarHideTimeout);
  sidebarHideTimeout = setTimeout(() => {
    sidebarHideTimeout = null;
    hideSidebar();
  }, 300);
}

/** Hide the sidebar immediately */
function hideSidebar() {
  if (sidebarMode !== 'autohide' || !sidebarRevealed) return;
  sidebarRevealed = false;
  sidebarEl.style.width = '0';
  sidebarEl.classList.remove('sidebar-revealed');
}

/** Set up mouse event listeners for auto-hide trigger zone and sidebar */
function initSidebarAutoHide() {
  const triggerZone = document.querySelector('[data-testid="sidebar-trigger-zone"]');
  if (!triggerZone) return;

  triggerZone.addEventListener('mouseenter', () => revealSidebar());
  sidebarEl.addEventListener('mouseenter', () => revealSidebar());
  sidebarEl.addEventListener('mouseleave', () => scheduleSidebarHide());
  triggerZone.addEventListener('mouseleave', () => scheduleSidebarHide());
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

// ── Settings tab (Cmd+,) ─────────────────────────────────────

/** Unique counter for settings pseudo-sessions (negative to avoid PTY id collisions) */
let settingsIdCounter = -1000;

/** All hook event names for the Sound & Hooks UI */
const ALL_HOOK_EVENTS = [
  'SessionStart', 'SessionEnd',
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'Notification',
  'SubagentStart', 'SubagentStop',
  'PreCompact', 'ConfigChange',
  'UserPromptSubmit', 'Stop',
  'TeammateIdle', 'TaskCompleted',
  'WorktreeCreate', 'WorktreeRemove',
];

/**
 * Find an existing settings tab for the current project (or global).
 * Returns the session id or null.
 */
function findSettingsTab() {
  for (const [id, s] of sessions.entries()) {
    if (s.type === 'settings') return id;
  }
  return null;
}

/** Open (or focus) the settings tab */
async function openSettings() {
  // If a settings tab already exists, just focus it
  const existing = findSettingsTab();
  if (existing !== null) {
    activateTab(existing);
    return;
  }

  const id = settingsIdCounter--;

  const panelEl = document.createElement('div');
  panelEl.className = 'terminal-panel settings-tab-panel';
  terminalsContainer.appendChild(panelEl);

  // Build settings icon for tab
  const settingsSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M3.4 12.6l.85-.85M11.75 4.25l.85-.85"/></svg>`;
  const tabEl = document.createElement('div');
  tabEl.className = 'tab-item';
  tabEl.dataset.testid = 'tab';
  tabEl.dataset.tabId = String(id);
  tabEl.innerHTML = `<span class="tab-icon tab-icon-settings" style="background:var(--accent-bg);color:var(--accent)">${settingsSvg}</span><span class="tab-label" data-testid="tab-label">Settings</span><button class="tab-close" data-testid="tab-close">&times;</button>`;
  tabBarTabs.appendChild(tabEl);

  tabEl.addEventListener('click', (e) => {
    if (!e.target.closest('.tab-close')) activateTab(id);
  });
  tabEl.querySelector('.tab-close').addEventListener('click', () => closeTab(id));

  const cleanup = () => {}; // no PTY to dispose

  sessions.set(id, {
    terminal: null, fitAddon: null, searchAddon: null,
    panelEl, tabEl, cleanup,
    projectPath: selectedProjectPath || '__global__',
    sessionId: null, type: 'settings', createdAt: Date.now(),
  });

  // Render settings content into the panel
  await renderSettingsTab(panelEl);
  activateTab(id);
  renderSidebar();
}

/** Render the full settings tab UI into a panel element */
async function renderSettingsTab(panelEl) {
  const [schema, globalConfig, projectConfig, themes, version] = await Promise.all([
    api.appConfig.getSchema(),
    api.appConfig.getGlobal(),
    selectedProjectPath ? api.appConfig.getProject(selectedProjectPath) : Promise.resolve(null),
    api.soundThemes ? api.soundThemes.list() : Promise.resolve([]),
    api.getVersion().catch(() => '?'),
  ]);

  let resolvedSoundMap = null;
  if (api.soundThemes) {
    resolvedSoundMap = await api.soundThemes.getSounds(selectedProjectPath) || {};
  }

  // State
  let activeSection = 'general';
  let settingsScope = 'global'; // 'global' or 'project'
  const editGlobal = { ...globalConfig };
  const editProject = projectConfig ? { ...projectConfig } : {};

  const container = document.createElement('div');
  container.className = 'settings-container';

  // ── Scope toggle bar ───────────────────────────────────────
  const scopeBar = document.createElement('div');
  scopeBar.className = 'settings-scope-bar';

  const scopeGlobalBtn = document.createElement('button');
  scopeGlobalBtn.className = 'settings-scope-btn active';
  scopeGlobalBtn.dataset.testid = 'settings-scope-global';
  scopeGlobalBtn.textContent = 'All Projects';

  const scopeProjectBtn = document.createElement('button');
  scopeProjectBtn.className = 'settings-scope-btn';
  scopeProjectBtn.dataset.testid = 'settings-scope-project';
  const currentProjectName = selectedProjectPath
    ? projects.find(p => p.path === selectedProjectPath)?.name || 'Project'
    : 'Project';
  scopeProjectBtn.textContent = currentProjectName;
  scopeProjectBtn.disabled = !selectedProjectPath;

  scopeBar.appendChild(scopeGlobalBtn);
  scopeBar.appendChild(scopeProjectBtn);
  container.appendChild(scopeBar);

  scopeGlobalBtn.addEventListener('click', () => {
    settingsScope = 'global';
    scopeGlobalBtn.classList.add('active');
    scopeProjectBtn.classList.remove('active');
    renderActiveSection();
  });
  scopeProjectBtn.addEventListener('click', () => {
    if (!selectedProjectPath) return;
    settingsScope = 'project';
    scopeProjectBtn.classList.add('active');
    scopeGlobalBtn.classList.remove('active');
    renderActiveSection();
  });

  // ── Two-column layout ──────────────────────────────────────
  const layout = document.createElement('div');
  layout.className = 'settings-layout';

  // Left nav
  const nav = document.createElement('nav');
  nav.className = 'settings-nav';
  const sections = [
    { id: 'general', label: 'General', icon: '⚙' },
    { id: 'sounds', label: 'Sound & Hooks', icon: '🔊' },
    { id: 'about', label: 'About', icon: 'ℹ' },
  ];

  for (const sec of sections) {
    const btn = document.createElement('button');
    btn.className = 'settings-nav-item' + (sec.id === activeSection ? ' active' : '');
    btn.dataset.section = sec.id;
    btn.dataset.testid = `settings-nav-${sec.id}`;
    btn.textContent = sec.label;
    btn.addEventListener('click', () => {
      activeSection = sec.id;
      nav.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderActiveSection();
    });
    nav.appendChild(btn);
  }
  layout.appendChild(nav);

  // Right content
  const contentArea = document.createElement('div');
  contentArea.className = 'settings-content';
  layout.appendChild(contentArea);

  container.appendChild(layout);
  panelEl.appendChild(container);

  // ── Section renderers ──────────────────────────────────────

  function renderActiveSection() {
    contentArea.innerHTML = '';
    switch (activeSection) {
      case 'general': renderGeneralSection(); break;
      case 'sounds': renderSoundsSection(); break;
      case 'about': renderAboutSection(); break;
    }
  }

  function renderGeneralSection() {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-section';

    const heading = document.createElement('h3');
    heading.className = 'settings-section-title';
    heading.textContent = 'General';
    wrapper.appendChild(heading);

    const isProject = settingsScope === 'project';
    const values = isProject ? editProject : editGlobal;

    for (const [key, schemaDef] of Object.entries(schema)) {
      // Skip soundTheme — that goes in the Sounds section
      if (key === 'soundTheme') continue;

      const row = document.createElement('div');
      row.className = 'settings-row';

      const label = document.createElement('label');
      label.className = 'settings-label';
      label.textContent = schemaDef.label;
      row.appendChild(label);

      const desc = document.createElement('div');
      desc.className = 'settings-description';
      desc.textContent = schemaDef.description;
      row.appendChild(desc);

      const inputRow = document.createElement('div');
      inputRow.className = 'settings-input-row';

      let inputEl;

      if (schemaDef.type === 'select') {
        const select = document.createElement('select');
        select.className = 'settings-select';
        select.dataset.testid = `settings-input-${key}`;

        for (const opt of schemaDef.options) {
          const option = document.createElement('option');
          option.value = opt;
          option.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
          select.appendChild(option);
        }

        if (isProject) {
          const projectValue = values[key];
          const globalValue = editGlobal[key] ?? schemaDef.default;
          select.value = projectValue !== undefined ? projectValue : globalValue;

          if (projectValue !== undefined) {
            const clearBtn = document.createElement('button');
            clearBtn.className = 'settings-clear-btn';
            clearBtn.dataset.testid = `settings-clear-${key}`;
            clearBtn.textContent = '\u00d7';
            clearBtn.title = 'Use global default';
            clearBtn.addEventListener('click', () => {
              delete editProject[key];
              select.value = globalValue;
              clearBtn.remove();
            });
            inputRow.appendChild(clearBtn);
          }
        } else {
          select.value = values[key] !== undefined ? values[key] : schemaDef.default;
        }

        select.addEventListener('change', () => { values[key] = select.value; });
        inputEl = select;
      } else {
        const input = document.createElement('input');
        input.className = 'settings-input';
        input.dataset.testid = `settings-input-${key}`;
        input.type = 'text';

        if (isProject) {
          const projectValue = values[key];
          const globalValue = editGlobal[key] ?? schemaDef.default;
          input.value = projectValue !== undefined ? projectValue : '';
          input.placeholder = globalValue || schemaDef.default || '(default)';

          if (projectValue !== undefined) {
            const clearBtn = document.createElement('button');
            clearBtn.className = 'settings-clear-btn';
            clearBtn.dataset.testid = `settings-clear-${key}`;
            clearBtn.textContent = '\u00d7';
            clearBtn.title = 'Use global default';
            clearBtn.addEventListener('click', () => {
              delete editProject[key];
              input.value = '';
              clearBtn.remove();
            });
            inputRow.appendChild(clearBtn);
          }
        } else {
          input.value = values[key] !== undefined ? values[key] : '';
          input.placeholder = schemaDef.default || '(default)';
        }

        input.addEventListener('input', () => {
          const trimmed = input.value.trim();
          if (trimmed) values[key] = trimmed;
          else delete values[key];
        });

        inputEl = input;
      }

      inputRow.insertBefore(inputEl, inputRow.firstChild);
      row.appendChild(inputRow);
      wrapper.appendChild(row);
    }

    // Save button
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'settings-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'settings-save-btn';
    saveBtn.dataset.testid = 'settings-save-btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
      if (isProject && selectedProjectPath) {
        await api.appConfig.setProject(selectedProjectPath, editProject);
      } else {
        await api.appConfig.setGlobal(editGlobal);
      }
      const resolvedTheme = await api.appConfig.resolve('theme', selectedProjectPath);
      applyThemeSetting(resolvedTheme || 'system');
      saveBtn.textContent = 'Saved!';
      setTimeout(() => { saveBtn.textContent = 'Save'; }, 1500);
    });

    actionsDiv.appendChild(saveBtn);
    wrapper.appendChild(actionsDiv);
    contentArea.appendChild(wrapper);
  }

  function renderSoundsSection() {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-section';

    const heading = document.createElement('h3');
    heading.className = 'settings-section-title';
    heading.textContent = 'Sound & Hooks';
    wrapper.appendChild(heading);

    // Theme selector
    const themeRow = document.createElement('div');
    themeRow.className = 'settings-row';

    const themeLabel = document.createElement('label');
    themeLabel.className = 'settings-label';
    themeLabel.textContent = 'Sound theme';
    themeRow.appendChild(themeLabel);

    const themeDesc = document.createElement('div');
    themeDesc.className = 'settings-description';
    themeDesc.textContent = 'Select a sound theme or "none" to disable all sounds';
    themeRow.appendChild(themeDesc);

    const themeInputRow = document.createElement('div');
    themeInputRow.className = 'settings-input-row';

    const themeSelect = document.createElement('select');
    themeSelect.className = 'settings-select';
    themeSelect.dataset.testid = 'settings-sound-theme-select';

    const noneOpt = document.createElement('option');
    noneOpt.value = 'none';
    noneOpt.textContent = 'None';
    themeSelect.appendChild(noneOpt);

    for (const t of themes) {
      const opt = document.createElement('option');
      opt.value = t.dirName;
      opt.textContent = t.name;
      themeSelect.appendChild(opt);
    }

    const isProject = settingsScope === 'project';
    const values = isProject ? editProject : editGlobal;
    const currentTheme = values.soundTheme !== undefined ? values.soundTheme : (editGlobal.soundTheme || 'none');
    themeSelect.value = currentTheme;

    themeSelect.addEventListener('change', () => {
      values.soundTheme = themeSelect.value;
    });

    themeInputRow.appendChild(themeSelect);
    themeRow.appendChild(themeInputRow);
    wrapper.appendChild(themeRow);

    // Theme install buttons
    const installRow = document.createElement('div');
    installRow.className = 'settings-row settings-theme-install-row';

    const installZipBtn = document.createElement('button');
    installZipBtn.className = 'settings-btn-secondary';
    installZipBtn.textContent = 'Install from ZIP';
    installZipBtn.addEventListener('click', async () => {
      const result = await api.soundThemes.installFromZip();
      if (result.success) {
        // Refresh themes list
        const newThemes = await api.soundThemes.list();
        themes.length = 0;
        themes.push(...newThemes);
        renderActiveSection();
      }
    });

    const installGhBtn = document.createElement('button');
    installGhBtn.className = 'settings-btn-secondary';
    installGhBtn.textContent = 'Install from GitHub';
    installGhBtn.addEventListener('click', async () => {
      const url = prompt('Enter GitHub repository URL:');
      if (!url) return;
      const result = await api.soundThemes.installFromGitHub(url);
      if (result.success) {
        const newThemes = await api.soundThemes.list();
        themes.length = 0;
        themes.push(...newThemes);
        renderActiveSection();
      } else {
        alert('Failed: ' + (result.error || 'Unknown error'));
      }
    });

    installRow.appendChild(installZipBtn);
    installRow.appendChild(installGhBtn);
    wrapper.appendChild(installRow);

    // Event sound table
    const tableHeading = document.createElement('h4');
    tableHeading.className = 'settings-subsection-title';
    tableHeading.textContent = 'Event Sounds';
    wrapper.appendChild(tableHeading);

    const tableDesc = document.createElement('div');
    tableDesc.className = 'settings-description';
    tableDesc.textContent = 'Upload custom sounds per event. Overrides are saved globally or per-project depending on scope.';
    wrapper.appendChild(tableDesc);

    const table = document.createElement('div');
    table.className = 'settings-sound-table';

    // Header row
    const headerRow = document.createElement('div');
    headerRow.className = 'settings-sound-row settings-sound-header';
    headerRow.innerHTML = '<span class="settings-sound-event">Event</span><span class="settings-sound-source">Source</span><span class="settings-sound-actions">Actions</span>';
    table.appendChild(headerRow);

    for (const eventName of ALL_HOOK_EVENTS) {
      const row = document.createElement('div');
      row.className = 'settings-sound-row';
      row.dataset.testid = `settings-sound-row-${eventName}`;

      const eventCell = document.createElement('span');
      eventCell.className = 'settings-sound-event';
      eventCell.textContent = eventName;
      row.appendChild(eventCell);

      const sourceCell = document.createElement('span');
      sourceCell.className = 'settings-sound-source';
      const hasSound = resolvedSoundMap && resolvedSoundMap[eventName];
      sourceCell.textContent = hasSound ? 'Theme' : '—';
      row.appendChild(sourceCell);

      const actionsCell = document.createElement('span');
      actionsCell.className = 'settings-sound-actions';

      // Play button
      if (hasSound) {
        const playBtn = document.createElement('button');
        playBtn.className = 'settings-btn-icon';
        playBtn.dataset.testid = `settings-sound-play-${eventName}`;
        playBtn.title = 'Play';
        playBtn.textContent = '\u25B6';
        playBtn.addEventListener('click', () => {
          const url = resolvedSoundMap[eventName];
          if (url) {
            const a = new Audio(url);
            a.play().catch(() => {});
          }
        });
        actionsCell.appendChild(playBtn);
      }

      // Upload button
      const uploadBtn = document.createElement('button');
      uploadBtn.className = 'settings-btn-icon';
      uploadBtn.dataset.testid = `settings-sound-upload-${eventName}`;
      uploadBtn.title = 'Upload custom sound';
      uploadBtn.textContent = '\u2191'; // up arrow
      uploadBtn.addEventListener('click', async () => {
        if (!api.soundOverrides) return;
        const scope = settingsScope === 'project' && selectedProjectPath
          ? { type: 'project', projectPath: selectedProjectPath }
          : { type: 'global' };
        const result = await api.soundOverrides.upload(eventName, scope);
        if (result && result.success) {
          // Refresh the sound map
          resolvedSoundMap = await api.soundThemes.getSounds(selectedProjectPath) || {};
          renderActiveSection();
        }
      });
      actionsCell.appendChild(uploadBtn);

      // Trim button
      if (hasSound) {
        const trimBtn = document.createElement('button');
        trimBtn.className = 'settings-btn-icon';
        trimBtn.dataset.testid = `settings-sound-trim-${eventName}`;
        trimBtn.title = 'Trim sound';
        trimBtn.textContent = '\u2702'; // scissors
        trimBtn.addEventListener('click', () => {
          const url = resolvedSoundMap[eventName];
          if (url) openTrimUI(eventName, url, wrapper, settingsScope, () => renderActiveSection());
        });
        actionsCell.appendChild(trimBtn);
      }

      row.appendChild(actionsCell);
      table.appendChild(row);
    }

    wrapper.appendChild(table);

    // Save theme setting
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'settings-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'settings-save-btn';
    saveBtn.dataset.testid = 'settings-sound-save-btn';
    saveBtn.textContent = 'Save Sound Settings';
    saveBtn.addEventListener('click', async () => {
      if (isProject && selectedProjectPath) {
        await api.appConfig.setProject(selectedProjectPath, editProject);
      } else {
        await api.appConfig.setGlobal(editGlobal);
      }
      // Reload sound cache
      await loadSoundTheme();
      saveBtn.textContent = 'Saved!';
      setTimeout(() => { saveBtn.textContent = 'Save Sound Settings'; }, 1500);
    });
    actionsDiv.appendChild(saveBtn);
    wrapper.appendChild(actionsDiv);

    contentArea.appendChild(wrapper);
  }

  function renderAboutSection() {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-section';

    const heading = document.createElement('h3');
    heading.className = 'settings-section-title';
    heading.textContent = 'About';
    wrapper.appendChild(heading);

    const infoGrid = document.createElement('div');
    infoGrid.className = 'settings-about-grid';
    infoGrid.innerHTML = `
      <div class="settings-about-row"><span class="settings-about-label">Version</span><span class="settings-about-value">${version}</span></div>
      <div class="settings-about-row"><span class="settings-about-label">Electron</span><span class="settings-about-value">${navigator.userAgent.match(/Electron\/([^\s]+)/)?.[1] || '—'}</span></div>
      <div class="settings-about-row"><span class="settings-about-label">Chrome</span><span class="settings-about-value">${navigator.userAgent.match(/Chrome\/([^\s]+)/)?.[1] || '—'}</span></div>
      <div class="settings-about-row"><span class="settings-about-label">Platform</span><span class="settings-about-value">${navigator.platform}</span></div>
    `;
    wrapper.appendChild(infoGrid);

    contentArea.appendChild(wrapper);
  }

  // Initial render
  renderActiveSection();
}

// ── Audio Trim UI ────────────────────────────────────────────

/**
 * Open an inline trim editor for a sound event.
 * Uses Web Audio API for waveform + OfflineAudioContext for export.
 */
function openTrimUI(eventName, audioUrl, parentEl, scope, onSave) {
  // Remove any existing trim UI
  parentEl.querySelector('.trim-ui')?.remove();

  const trimContainer = document.createElement('div');
  trimContainer.className = 'trim-ui';
  trimContainer.dataset.testid = `trim-ui-${eventName}`;

  const titleBar = document.createElement('div');
  titleBar.className = 'trim-ui-title';
  titleBar.textContent = `Trim: ${eventName}`;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'trim-ui-close';
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', () => trimContainer.remove());
  titleBar.appendChild(closeBtn);
  trimContainer.appendChild(titleBar);

  const canvas = document.createElement('canvas');
  canvas.className = 'trim-ui-canvas';
  canvas.width = 600;
  canvas.height = 100;
  trimContainer.appendChild(canvas);

  const controls = document.createElement('div');
  controls.className = 'trim-ui-controls';

  const startLabel = document.createElement('label');
  startLabel.textContent = 'Start: ';
  const startInput = document.createElement('input');
  startInput.type = 'range';
  startInput.min = '0';
  startInput.max = '1000';
  startInput.value = '0';
  startInput.className = 'trim-ui-slider';
  startLabel.appendChild(startInput);
  controls.appendChild(startLabel);

  const endLabel = document.createElement('label');
  endLabel.textContent = 'End: ';
  const endInput = document.createElement('input');
  endInput.type = 'range';
  endInput.min = '0';
  endInput.max = '1000';
  endInput.value = '1000';
  endInput.className = 'trim-ui-slider';
  endLabel.appendChild(endInput);
  controls.appendChild(endLabel);

  const timeDisplay = document.createElement('span');
  timeDisplay.className = 'trim-ui-time';
  controls.appendChild(timeDisplay);

  trimContainer.appendChild(controls);

  const btnRow = document.createElement('div');
  btnRow.className = 'trim-ui-actions';

  const previewBtn = document.createElement('button');
  previewBtn.className = 'settings-btn-secondary';
  previewBtn.textContent = 'Preview';
  btnRow.appendChild(previewBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'settings-save-btn';
  saveBtn.textContent = 'Save Trimmed';
  btnRow.appendChild(saveBtn);

  trimContainer.appendChild(btnRow);
  parentEl.appendChild(trimContainer);

  // Load and decode audio
  let audioBuffer = null;
  let audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  fetch(audioUrl)
    .then(r => r.arrayBuffer())
    .then(buf => audioCtx.decodeAudioData(buf))
    .then(decoded => {
      audioBuffer = decoded;
      drawWaveform(canvas, audioBuffer, 0, audioBuffer.duration);
      updateTimeDisplay();
    })
    .catch(() => {
      const ctx2d = canvas.getContext('2d');
      ctx2d.fillStyle = 'var(--text-dim)';
      ctx2d.fillText('Failed to load audio', 10, 50);
    });

  function getStartEnd() {
    if (!audioBuffer) return { start: 0, end: 0 };
    const duration = audioBuffer.duration;
    const start = (parseInt(startInput.value) / 1000) * duration;
    const end = (parseInt(endInput.value) / 1000) * duration;
    return { start: Math.min(start, end), end: Math.max(start, end) };
  }

  function updateTimeDisplay() {
    const { start, end } = getStartEnd();
    timeDisplay.textContent = `${start.toFixed(2)}s — ${end.toFixed(2)}s`;
    if (audioBuffer) drawWaveform(canvas, audioBuffer, start, end);
  }

  startInput.addEventListener('input', updateTimeDisplay);
  endInput.addEventListener('input', updateTimeDisplay);

  previewBtn.addEventListener('click', () => {
    if (!audioBuffer) return;
    const { start, end } = getStartEnd();
    const previewCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = previewCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(previewCtx.destination);
    source.start(0, start, end - start);
  });

  saveBtn.addEventListener('click', async () => {
    if (!audioBuffer || !api.soundOverrides) return;
    const { start, end } = getStartEnd();

    // Render trimmed audio to WAV
    const sampleRate = audioBuffer.sampleRate;
    const channels = audioBuffer.numberOfChannels;
    const startSample = Math.floor(start * sampleRate);
    const endSample = Math.floor(end * sampleRate);
    const length = endSample - startSample;

    if (length <= 0) return;

    const offlineCtx = new OfflineAudioContext(channels, length, sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0, start, end - start);

    const rendered = await offlineCtx.startRendering();
    const wavBlob = audioBufferToWav(rendered);

    // Convert blob to base64 for IPC transfer
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1];
      const scopeObj = scope === 'project' && selectedProjectPath
        ? { type: 'project', projectPath: selectedProjectPath }
        : { type: 'global' };
      await api.soundOverrides.saveFromBase64(eventName, base64, scopeObj);
      await loadSoundTheme();
      trimContainer.remove();
      if (onSave) onSave();
    };
    reader.readAsDataURL(wavBlob);
  });
}

/** Draw a waveform on canvas with optional highlight region */
function drawWaveform(canvas, audioBuffer, highlightStart, highlightEnd) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const duration = audioBuffer.duration;
  const data = audioBuffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / width));

  // Use CSS variables via computed style
  const computedStyle = getComputedStyle(document.documentElement);
  const dimColor = computedStyle.getPropertyValue('--text-muted').trim() || '#555';
  const accentColor = computedStyle.getPropertyValue('--accent').trim() || '#d4943c';
  const bgColor = computedStyle.getPropertyValue('--bg-surface').trim() || '#1a1a1a';

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < width; i++) {
    const idx = i * step;
    let min = 0, max = 0;
    for (let j = 0; j < step && idx + j < data.length; j++) {
      const val = data[idx + j];
      if (val < min) min = val;
      if (val > max) max = val;
    }
    const time = (i / width) * duration;
    const inRegion = time >= highlightStart && time <= highlightEnd;
    ctx.fillStyle = inRegion ? accentColor : dimColor;
    const barTop = ((1 - max) / 2) * height;
    const barBottom = ((1 - min) / 2) * height;
    ctx.fillRect(i, barTop, 1, barBottom - barTop || 1);
  }

  // Draw start/end markers
  const startX = (highlightStart / duration) * width;
  const endX = (highlightEnd / duration) * width;
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(startX, 0); ctx.lineTo(startX, height);
  ctx.moveTo(endX, 0); ctx.lineTo(endX, height);
  ctx.stroke();
}

/** Encode an AudioBuffer as a WAV Blob */
function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const samples = buffer.length;
  const dataSize = samples * blockAlign;
  const bufferSize = 44 + dataSize;
  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view = new DataView(arrayBuffer);

  function writeString(offset, string) {
    for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
  }

  writeString(0, 'RIFF');
  view.setUint32(4, bufferSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let sample = buffer.getChannelData(ch)[i];
      sample = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
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

function updateStatusBar() {
  if (!statusProjectEl) return;

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

// ── Sidebar resize ───────────────────────────────────────────

function initSidebarResize() {
  const handle = document.querySelector('[data-testid="sidebar-resize-handle"]');
  if (!handle) return;

  let isDragging = false;
  let startX = 0;
  let startWidth = 0;
  const MIN_WIDTH = 140;
  const MAX_WIDTH = 500;

  handle.addEventListener('mousedown', (e) => {
    if (sidebarMode === 'autohide') return;
    isDragging = true;
    startX = e.clientX;
    startWidth = sidebarEl.getBoundingClientRect().width;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const delta = e.clientX - startX;
    const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta));
    sidebarEl.style.width = newWidth + 'px';
    document.documentElement.style.setProperty('--sidebar-width', newWidth + 'px');
    // Refit active terminal
    if (activeId) {
      const session = sessions.get(activeId);
      if (session) session.fitAddon.fit();
    }
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // Persist sidebar width and update local variable
    const finalWidth = Math.round(sidebarEl.getBoundingClientRect().width);
    sidebarWidth = finalWidth;
    document.documentElement.style.setProperty('--sidebar-width', finalWidth + 'px');
    if (api.windowState) {
      api.windowState.setSidebarWidth(finalWidth);
    }
  });
}

// ── Debug pane toggle ────────────────────────────────────────

function toggleDebugPane() {
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
    api.windowState.setDebugPaneOpen(debugPaneOpen);
  }
  // Refit active terminal since available space changed
  if (activeId) {
    const session = sessions.get(activeId);
    if (session) session.fitAddon.fit();
  }
}

// ── Debug pane resize ────────────────────────────────────────

function initDebugPaneResize() {
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
    // Refit active terminal
    if (activeId) {
      const session = sessions.get(activeId);
      if (session) session.fitAddon.fit();
    }
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    debugPaneResizeHandle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    debugPaneHeight = debugPaneEl.offsetHeight;
    if (api.windowState) {
      api.windowState.setDebugPaneHeight(debugPaneHeight);
    }
  });
}

// ── Debug pane entries ───────────────────────────────────────

let debugAutoScroll = true;

function formatLogTime(timestamp) {
  const d = new Date(timestamp);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function addDebugEntry(entry) {
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
  if (debugPaneCountEl) {
    const count = debugPaneEntriesEl.querySelectorAll('.debug-entry').length;
    debugPaneCountEl.textContent = count > 0 ? `(${count})` : '';
  }
}

function clearDebugPane() {
  if (debugPaneEntriesEl) {
    debugPaneEntriesEl.innerHTML = '';
    updateDebugPaneCount();
  }
  if (api.log) api.log.clear();
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
window._claudiuSelectedProject = () => selectedProjectPath;
window._claudiuProjectMRU = () => [...projectMRU];
window._claudiuCloseOtherTabs = (keepId) => closeOtherTabs(keepId);
window._claudiuCloseAllTabs = (projectPath) => closeAllTabs(projectPath || selectedProjectPath);
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
window._claudiuIsSidebarVisible = () => sidebarMode === 'pinned' || sidebarRevealed;
window._claudiuGetSidebarMode = () => sidebarMode;
window._claudiuProjectActivity = () => [...projectActivity];
window._claudiuGetSessionsForProject = (projectPath) => {
  return sessionsForProject(projectPath).map(([id]) => id);
};

// Reload projects from store and re-render sidebar (used by tests)
window._claudiuReloadProjects = (projectList) => {
  refreshProjectList(projectList);
  if (selectedProjectPath && !projects.some(p => p.path === selectedProjectPath)) {
    selectedProjectPath = null;
  }
  renderSidebar();
  updateProjectIdentity();
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
async function loadSoundTheme() {
  soundCache.clear();
  if (!api.soundThemes) return;
  const soundMap = await api.soundThemes.getSounds(selectedProjectPath);
  if (!soundMap) return;
  for (const [event, url] of Object.entries(soundMap)) {
    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.volume = 1.0;
    soundCache.set(event, audio);
  }
}

/** Play the sound for a hook event (if mapped) */
function playEventSound(eventName) {
  const audio = soundCache.get(eventName);
  if (!audio) return;
  // Clone the audio node so overlapping sounds work
  const clone = audio.cloneNode();
  clone.volume = audio.volume;
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
      sidebarWidth = savedWidth;
    }
    const savedMode = await api.windowState.getSidebarMode();
    if (savedMode === 'pinned' || savedMode === 'autohide') {
      sidebarMode = savedMode;
    }
    // HTML starts with sidebar-autohide class (default).
    if (sidebarMode === 'pinned') {
      document.querySelector('.app-body').classList.remove('sidebar-autohide');
      sidebarEl.style.width = sidebarWidth + 'px';
      document.documentElement.style.setProperty('--sidebar-width', sidebarWidth + 'px');
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
    console.log('[THEME DEBUG] resolved:', resolvedTheme, '| data-theme before:', document.documentElement.getAttribute('data-theme'), '| prefers-light:', window.matchMedia('(prefers-color-scheme: light)').matches);
    applyThemeSetting(resolvedTheme || 'system');
    console.log('[THEME DEBUG] after apply | data-theme:', document.documentElement.getAttribute('data-theme'), '| --bg-app:', getComputedStyle(document.documentElement).getPropertyValue('--bg-app'));

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
        updateProjectIdentity();
      }
    });

    // Restore debug pane state
    const savedDebugHeight = await api.windowState.getDebugPaneHeight();
    if (savedDebugHeight && savedDebugHeight > 0) debugPaneHeight = savedDebugHeight;
    const savedDebugOpen = await api.windowState.getDebugPaneOpen();
    if (savedDebugOpen) {
      debugPaneOpen = true;
      debugPaneEl.style.height = debugPaneHeight + 'px';
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
    debugAutoScroll = scrollTop + clientHeight >= scrollHeight - 10;
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
