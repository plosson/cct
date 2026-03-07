/**
 * Renderer — tabbed terminal manager with project sidebar
 * Sessions are always project-scoped. Switching projects switches visible tabs.
 */

import { getProjectColor } from './projectColors.js';
import { openSettings } from './settings.js';
import {
  openProjectPicker,
  openSearchBar,
  showShortcutHelp,
  toggleDebugPane, initDebugPaneResize, addDebugEntry, clearDebugPane,
  setDebugPaneOpen, getDebugPaneHeight, setDebugPaneHeight,
  setDebugAutoScroll,
} from './overlays.js';
import {
  projects, projectMRU, projectActivity,
  getSelectedProjectPath, setSelectedProjectPath,
  sessionsForProject, refreshProjectList,
  renderSidebar, selectProject, addProject, cycleProject,
  toggleSidebar, initSidebarResize, initSidebarAutoHide,
  getSidebarMode, setSidebarMode, getSidebarRevealed,
  getSidebarWidth, setSidebarWidth,
} from './sidebar.js';
import {
  closeOtherTabs, closeAllTabs,
  cycleTab, goToTab, moveTab,
} from './tabs.js';
import {
  sessions,
  getActiveId,
  getTabBarTabs,
  initTerminal, initStatusBar,
  TERMINAL_OPTIONS,
  setInitialFontSize,
  createSession, createNotesTab, closeTab,
  zoomIn, zoomOut, zoomReset, toggleMute,
  clearTerminal, copySelection, pasteClipboard, selectAll,
  applyThemeSetting, getTerminalTheme,
  initSoundTheme,
} from './terminal.js';
import { actions, initKeyboardDispatch } from './keybindings.js';
import { toggleNotes, initNotes } from './notes.js';

const api = window.electron_api;

// Expose for testing
window._claudiuProjectColors = { getProjectColor };

// Static DOM elements (populated in init)
let sidebarProjectsEl;
let sidebarEl;
let emptyStateEl;
let debugPaneEl;
let debugPaneEntriesEl;
let debugPaneCountEl;
let debugPaneResizeHandle;

// DOM element accessors (used by overlays and sidebar modules)
export function getDebugPaneEl() { return debugPaneEl; }
export function getDebugPaneEntriesEl() { return debugPaneEntriesEl; }
export function getDebugPaneCountEl() { return debugPaneCountEl; }
export function getDebugPaneResizeHandle() { return debugPaneResizeHandle; }
export function getSidebarProjectsEl() { return sidebarProjectsEl; }
export function getSidebarEl() { return sidebarEl; }
export function getEmptyStateEl() { return emptyStateEl; }

// ── Test helpers ─────────────────────────────────────────────

window._claudiuGetBufferText = (targetId) => {
  const session = sessions.get(targetId || getActiveId());
  if (!session) return '';
  const buf = session.terminal.buffer.active;
  let text = '';
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (line) text += line.translateToString(true) + '\n';
  }
  return text;
};

window._claudiuCreateSession = (type) => createSession(type || 'terminal');
window._claudiuActiveTabId = () => getActiveId();
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
  const tabBarTabs = getTabBarTabs();
  return [...tabBarTabs.children]
    .filter(el => el.style.display !== 'none')
    .map(el => el.querySelector('.tab-label')?.textContent || '');
};
window._claudiuGetProjectContextMenuItems = (projectPath) => {
  return [
    { label: 'Reveal in Finder', action: 'revealInFinder' },
    { label: 'Copy Path', action: 'copyPath' },
    { label: 'Project Settings\u2026', action: 'projectSettings' },
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

// ── Init ─────────────────────────────────────────────────────

async function init() {
  const splashStart = Date.now();

  // Initialise terminal module DOM refs
  initTerminal();
  initStatusBar();

  sidebarProjectsEl = document.querySelector('[data-testid="project-list"]');
  sidebarEl = document.querySelector('[data-testid="sidebar"]');
  emptyStateEl = document.querySelector('[data-testid="empty-state"]');
  debugPaneEl = document.querySelector('[data-testid="debug-pane"]');
  debugPaneEntriesEl = document.querySelector('[data-testid="debug-pane-entries"]');
  debugPaneCountEl = document.querySelector('[data-testid="debug-pane-count"]');
  debugPaneResizeHandle = document.querySelector('[data-testid="debug-pane-resize-handle"]');

  // Display app version
  const statusVersionEl = document.querySelector('[data-testid="status-version"]');
  if (statusVersionEl) {
    api.getVersion().then(v => { statusVersionEl.textContent = `v${v}`; }).catch(() => {});
  }

  // Auto-updater notification
  if (api.updater) {
    function insertBanner(banner) {
      const mainArea = document.querySelector('.main-area');
      if (!mainArea) return;
      const tabBar = mainArea.querySelector('.tab-bar');
      if (tabBar) {
        mainArea.insertBefore(banner, tabBar.nextSibling);
      } else {
        mainArea.prepend(banner);
      }
    }

    api.updater.onUpdateDownloaded(({ version }) => {
      // Don't add duplicate banners
      if (document.querySelector('.update-banner')) return;
      const banner = document.createElement('div');
      banner.className = 'update-banner';
      banner.dataset.testid = 'update-banner';
      banner.textContent = `Update v${version} ready \u2014 click to restart`;
      banner.addEventListener('click', () => api.updater.installNow());
      insertBanner(banner);
    });

    api.updater.onUpdateNotAvailable(() => {
      // Show a temporary "up to date" banner that auto-dismisses
      if (document.querySelector('.update-banner')) return;
      const banner = document.createElement('div');
      banner.className = 'update-banner update-banner--info';
      banner.dataset.testid = 'update-banner-info';
      banner.textContent = 'You are running the latest version';
      insertBanner(banner);
      setTimeout(() => banner.remove(), 4000);
    });
  }

  // Restore sidebar width, mode, and font size from persisted state
  if (api.windowState) {
    const savedWidth = await api.windowState.get('sidebarWidth');
    if (savedWidth && savedWidth > 0) {
      setSidebarWidth(savedWidth);
    }
    const savedMode = await api.windowState.get('sidebarMode');
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
    const savedFontSize = await api.windowState.get('fontSize');
    if (savedFontSize && savedFontSize >= 8 && savedFontSize <= 32) {
      setInitialFontSize(savedFontSize);
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
    const savedDebugHeight = await api.windowState.get('debugPaneHeight');
    if (savedDebugHeight && savedDebugHeight > 0) setDebugPaneHeight(savedDebugHeight);
    const savedDebugOpen = await api.windowState.get('debugPaneOpen');
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
  actions.set('closeActiveTab', () => { if (getActiveId() !== null) closeTab(getActiveId()); });
  actions.set('closeOtherTabs', () => { if (getActiveId() !== null) closeOtherTabs(getActiveId()); });
  actions.set('openProjectPicker', openProjectPicker);
  actions.set('addProject', addProject);
  actions.set('prevTab', () => cycleTab('prev'));
  actions.set('nextTab', () => cycleTab('next'));
  actions.set('prevProject', () => cycleProject('prev'));
  actions.set('nextProject', () => cycleProject('next'));
  actions.set('moveTabLeft', () => moveTab('left'));
  actions.set('moveTabRight', () => moveTab('right'));
  actions.set('openSearchBar', openSearchBar);
  actions.set('zoomIn', zoomIn);
  actions.set('zoomOut', zoomOut);
  actions.set('zoomReset', zoomReset);
  actions.set('clearTerminal', clearTerminal);
  actions.set('copySelection', copySelection);
  actions.set('pasteClipboard', pasteClipboard);
  actions.set('selectAll', selectAll);
  actions.set('toggleSidebar', toggleSidebar);
  actions.set('openSettings', openSettings);
  actions.set('showShortcutHelp', showShortcutHelp);
  actions.set('toggleDebugPane', toggleDebugPane);
  actions.set('toggleNotes', createNotesTab);
  actions.set('toggleMute', toggleMute);
  for (let i = 1; i <= 8; i++) {
    actions.set(`goToTab${i}`, () => goToTab(i - 1));
  }
  actions.set('goToLastTab', () => goToTab(-1));

  initKeyboardDispatch();

  // Wire up UI buttons
  document.querySelector('.sidebar-toggle-btn')?.addEventListener('click', toggleSidebar);
  document.querySelector('[data-testid="new-tab-btn"]').addEventListener('click', async () => {
    const action = await api.contextMenu.show([
      { label: 'Claude\t\t⌘N', action: 'claude' },
      { label: 'Terminal\t\t⌘T', action: 'terminal' },
      { type: 'separator' },
      { label: 'Notes\t\t⌘L', action: 'notes' },
    ]);
    if (action === 'claude') createSession('claude');
    else if (action === 'terminal') createSession('terminal');
    else if (action === 'notes') createNotesTab();
  });
  document.querySelector('.ess-card[data-action="claude"]').addEventListener('click', () => createSession('claude'));
  document.querySelector('.ess-card[data-action="terminal"]').addEventListener('click', () => createSession('terminal'));
  document.querySelector('.ess-card[data-action="notes"]').addEventListener('click', () => createNotesTab());

  // Sound theme — play sounds on hook events
  initSoundTheme();

  initNotes();
  initSidebarResize();
  initDebugPaneResize();
  initSidebarAutoHide();

  // Enable sidebar transitions after first paint to prevent slide-on-load
  requestAnimationFrame(() => {
    document.querySelector('.app-body').classList.add('sidebar-transitions');
  });

  // Dismiss splash screen (minimum 2s display)
  const splash = document.getElementById('splash-screen');
  if (splash) {
    const elapsed = Date.now() - splashStart;
    await new Promise(r => setTimeout(r, Math.max(0, 2000 - elapsed)));
    splash.classList.add('splash-fade-out');
    splash.addEventListener('transitionend', () => splash.remove());
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
