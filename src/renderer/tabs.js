/**
 * Tabs — tab creation, drag/drop, rename, context menu, navigation
 * Extracted from renderer/index.js
 */

import {
  sessions, getActiveId, getActiveSession,
  activateTab, closeTab, createSession,
  getTabBarTabs,
} from './terminal.js';
import {
  getSelectedProjectPath, sessionsForProject,
} from './sidebar.js';

const api = window.electron_api;

// Tab drag-and-drop state
let draggedTabId = null;

// ── Tab element creation ─────────────────────────────────────

/**
 * Build a tab DOM element with all event wiring.
 * @param {number} id — session id
 * @param {{ projectName: string, projectColor: object, type: string, num: number }} display
 * @param {{ onActivate: Function, onClose: Function }} callbacks
 * @returns {HTMLElement} the tab element
 */
export function createTabElement(id, { projectName, projectColor, type, num }, { onActivate, onClose }) {
  const isClaude = type === 'claude';
  const projColor = `hsl(${projectColor.hue}, ${projectColor.s}%, ${projectColor.l}%)`;
  const projColorBg = `hsla(${projectColor.hue}, ${projectColor.s}%, ${projectColor.l}%, 0.15)`;

  const claudeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="12" height="12" shape-rendering="crispEdges"><rect x="2" y="4" width="12" height="2" fill="currentColor"/><rect x="1" y="6" width="2" height="2" fill="currentColor"/><rect x="5" y="6" width="6" height="2" fill="currentColor"/><rect x="13" y="6" width="2" height="2" fill="currentColor"/><rect x="1" y="8" width="14" height="1" fill="currentColor"/><rect x="2" y="9" width="12" height="3" fill="currentColor"/><rect x="2" y="12" width="1" height="2" fill="currentColor"/><rect x="4" y="12" width="1" height="2" fill="currentColor"/><rect x="11" y="12" width="1" height="2" fill="currentColor"/><rect x="13" y="12" width="1" height="2" fill="currentColor"/></svg>`;
  const termSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,5 8,8 4,11"/><line x1="9" y1="11" x2="12" y2="11"/></svg>`;

  const icon = isClaude
    ? `<span class="tab-icon tab-icon-claude" style="background:${projColorBg};color:${projColor}">${claudeSvg}</span>`
    : `<span class="tab-icon tab-icon-terminal" style="background:${projColorBg};color:${projColor}">${termSvg}</span>`;
  const displayLabel = `${projectName} ${num}`;
  const dot = `<span class="tab-color-dot" style="background:${projColor}"></span>`;

  const tabEl = document.createElement('div');
  tabEl.className = 'tab-item';
  tabEl.dataset.testid = 'tab';
  tabEl.dataset.tabId = String(id);
  tabEl.innerHTML = `${icon}<span class="tab-label" data-testid="tab-label">${displayLabel}</span>${dot}<button class="tab-close" data-testid="tab-close">&times;</button>`;

  tabEl.draggable = true;

  tabEl.addEventListener('click', (e) => {
    if (!e.target.closest('.tab-close')) onActivate();
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

    const tabBarTabs = getTabBarTabs();
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

  tabEl.querySelector('.tab-close').addEventListener('click', () => onClose());

  return tabEl;
}

// ── Tab drag helpers ─────────────────────────────────────────

function clearDropIndicators() {
  const tabBarTabs = getTabBarTabs();
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

// ── Tab navigation ───────────────────────────────────────────

/** Cycle to next or previous tab (within current project) */
function cycleTab(direction) {
  const selectedProjectPath = getSelectedProjectPath();
  if (!selectedProjectPath) return;
  const ids = sessionsForProject(selectedProjectPath).map(([id]) => id);
  if (ids.length < 2) return;
  const idx = ids.indexOf(getActiveId());
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

// ── Move tab (Cmd+Shift+Left/Right) ──────────────────────────

function moveTab(direction) {
  const session = getActiveSession();
  const selectedProjectPath = getSelectedProjectPath();
  if (!session || !selectedProjectPath) return;

  const tabBarTabs = getTabBarTabs();
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

// ── Exports ──────────────────────────────────────────────────

export {
  clearDropIndicators,
  startTabRename,
  showTabContextMenu,
  closeOtherTabs, closeAllTabs,
  cycleTab, goToTab, moveTab,
};
