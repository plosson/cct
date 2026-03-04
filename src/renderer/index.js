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
window._cctProjectColors = { getProjectColor };

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
    sess.terminal.options.theme = xtermTheme;
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

  // Show/hide tabs and panels for the selected project
  for (const [, s] of sessions.entries()) {
    const belongsToProject = s.projectPath === projectPath;
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
    ? `<span class="tab-icon" style="background:${projColorBg};color:${projColor}">${claudeSvg}</span>`
    : `<span class="tab-icon" style="background:${projColorBg};color:${projColor}">${termSvg}</span>`;
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

  session.fitAddon.fit();
  api.terminal.resize({ id, cols: session.terminal.cols, rows: session.terminal.rows });
  session.terminal.focus();
  updateStatusBar();
}

/** Close a tab, activating a neighbor within the same project */
function closeTab(id) {
  const session = sessions.get(id);
  if (!session) return;

  const projectPath = session.projectPath;

  api.terminal.kill({ id });
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

// ── Settings overlay (Cmd+,) ─────────────────────────────────

let settingsOverlay = null;

async function openSettings() {
  if (settingsOverlay) { closeSettings(); return; }

  const [schema, globalConfig, projectConfig] = await Promise.all([
    api.appConfig.getSchema(),
    api.appConfig.getGlobal(),
    selectedProjectPath ? api.appConfig.getProject(selectedProjectPath) : Promise.resolve(null),
  ]);

  settingsOverlay = document.createElement('div');
  settingsOverlay.className = 'overlay settings-overlay';
  settingsOverlay.dataset.testid = 'settings-overlay';

  const panel = document.createElement('div');
  panel.className = 'overlay-panel settings-panel';

  // Title
  const title = document.createElement('h2');
  title.className = 'settings-title';
  title.textContent = 'Settings';
  panel.appendChild(title);

  // Tab bar: Global / Project
  const tabBar = document.createElement('div');
  tabBar.className = 'settings-tabs';

  const globalTab = document.createElement('button');
  globalTab.className = 'settings-tab active';
  globalTab.dataset.testid = 'settings-tab-global';
  globalTab.textContent = 'Global';

  const projectTab = document.createElement('button');
  projectTab.className = 'settings-tab';
  projectTab.dataset.testid = 'settings-tab-project';
  const projectName = selectedProjectPath
    ? projects.find(p => p.path === selectedProjectPath)?.name || 'Project'
    : 'Project';
  projectTab.textContent = projectName;
  projectTab.disabled = !selectedProjectPath;

  tabBar.appendChild(globalTab);
  tabBar.appendChild(projectTab);
  panel.appendChild(tabBar);

  // Content area
  const content = document.createElement('div');
  content.className = 'settings-content';
  panel.appendChild(content);

  let activeTab = 'global';

  function renderSettingsContent() {
    content.innerHTML = '';
    const isProject = activeTab === 'project';
    const values = isProject ? (projectConfig || {}) : globalConfig;

    for (const [key, schemaDef] of Object.entries(schema)) {
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
          const globalValue = globalConfig[key] ?? schemaDef.default;
          select.value = projectValue !== undefined ? projectValue : globalValue;

          if (projectValue !== undefined) {
            const clearBtn = document.createElement('button');
            clearBtn.className = 'settings-clear-btn';
            clearBtn.dataset.testid = `settings-clear-${key}`;
            clearBtn.textContent = '\u00d7';
            clearBtn.title = 'Use global default';
            clearBtn.addEventListener('click', () => {
              delete projectConfig[key];
              select.value = globalValue;
              clearBtn.remove();
            });
            inputRow.appendChild(clearBtn);
          }
        } else {
          select.value = values[key] !== undefined ? values[key] : schemaDef.default;
        }

        select.addEventListener('change', () => {
          values[key] = select.value;
        });

        inputEl = select;
      } else {
        const input = document.createElement('input');
        input.className = 'settings-input';
        input.dataset.testid = `settings-input-${key}`;
        input.type = 'text';

        if (isProject) {
          const projectValue = values[key];
          const globalValue = globalConfig[key] ?? schemaDef.default;
          input.value = projectValue !== undefined ? projectValue : '';
          input.placeholder = globalValue || schemaDef.default || '(default)';

          if (projectValue !== undefined) {
            const clearBtn = document.createElement('button');
            clearBtn.className = 'settings-clear-btn';
            clearBtn.dataset.testid = `settings-clear-${key}`;
            clearBtn.textContent = '\u00d7';
            clearBtn.title = 'Use global default';
            clearBtn.addEventListener('click', () => {
              delete projectConfig[key];
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
          if (trimmed) {
            values[key] = trimmed;
          } else {
            delete values[key];
          }
        });

        inputEl = input;
      }

      inputRow.insertBefore(inputEl, inputRow.firstChild);
      row.appendChild(inputRow);
      content.appendChild(row);
    }

    // Save button
    const actions = document.createElement('div');
    actions.className = 'settings-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'settings-save-btn';
    saveBtn.dataset.testid = 'settings-save-btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
      if (isProject && selectedProjectPath) {
        await api.appConfig.setProject(selectedProjectPath, projectConfig);
      } else {
        await api.appConfig.setGlobal(globalConfig);
      }
      // Apply theme immediately
      const resolvedTheme = await api.appConfig.resolve('theme', selectedProjectPath);
      applyThemeSetting(resolvedTheme || 'system');
      closeSettings();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'settings-cancel-btn';
    cancelBtn.dataset.testid = 'settings-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => closeSettings());

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    content.appendChild(actions);
  }

  globalTab.addEventListener('click', () => {
    activeTab = 'global';
    globalTab.classList.add('active');
    projectTab.classList.remove('active');
    renderSettingsContent();
  });

  projectTab.addEventListener('click', () => {
    if (!selectedProjectPath) return;
    activeTab = 'project';
    projectTab.classList.add('active');
    globalTab.classList.remove('active');
    renderSettingsContent();
  });

  renderSettingsContent();

  settingsOverlay.appendChild(panel);
  settingsOverlay.addEventListener('mousedown', (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });
  settingsOverlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeSettings();
    }
  });

  document.querySelector('.app').appendChild(settingsOverlay);
  settingsOverlay.tabIndex = -1;
  settingsOverlay.focus();
}

function closeSettings() {
  if (!settingsOverlay) return;
  settingsOverlay.remove();
  settingsOverlay = null;
  refocusTerminal();
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
    statusSessionTypeEl.textContent = session.type === 'claude' ? 'Claude' : 'Terminal';
    statusTerminalSizeEl.textContent = `${session.terminal.cols}\u00d7${session.terminal.rows}`;
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

window._cctGetBufferText = (targetId) => {
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

window._cctActiveTabId = () => activeId;
window._cctSelectedProject = () => selectedProjectPath;
window._cctProjectMRU = () => [...projectMRU];
window._cctCloseOtherTabs = (keepId) => closeOtherTabs(keepId);
window._cctCloseAllTabs = (projectPath) => closeAllTabs(projectPath || selectedProjectPath);
window._cctDuplicateTab = (tabId) => {
  const session = sessions.get(tabId);
  if (!session) return;
  createSession(session.type);
};
window._cctGetTabContextMenuItems = (tabId) => {
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

window._cctGetTabOrder = () => {
  return [...tabBarTabs.children]
    .filter(el => el.style.display !== 'none')
    .map(el => el.querySelector('.tab-label')?.textContent || '');
};
window._cctGetProjectContextMenuItems = (projectPath) => {
  return [
    { label: 'Reveal in Finder', action: 'revealInFinder' },
    { label: 'Copy Path', action: 'copyPath' },
    { label: 'Project Settings…', action: 'projectSettings' },
    { label: 'Remove Project', action: 'remove' },
  ];
};
window._cctIsSidebarVisible = () => sidebarMode === 'pinned' || sidebarRevealed;
window._cctGetSidebarMode = () => sidebarMode;
window._cctProjectActivity = () => [...projectActivity];
window._cctGetSessionsForProject = (projectPath) => {
  return sessionsForProject(projectPath).map(([id]) => id);
};

// Reload projects from store and re-render sidebar (used by tests)
window._cctReloadProjects = (projectList) => {
  refreshProjectList(projectList);
  if (selectedProjectPath && !projects.some(p => p.path === selectedProjectPath)) {
    selectedProjectPath = null;
  }
  renderSidebar();
  updateProjectIdentity();
};

// Select a project programmatically (used by tests)
window._cctSelectProject = (projectPath) => {
  selectProject(projectPath);
};
window._cctAddDebugEntry = addDebugEntry;

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
