/**
 * Sidebar — project list, selection, auto-hide, resize, glow
 */

import { getProjectColor } from './projectColors.js';
import { openSettings, refreshSettingsTab } from './settings.js';
import {
  sessions, setActiveId,
  activateTab, closeTab, restoreSessions, updateStatusBar,
  refitActiveTerminal, applyProjectBackground,
} from './terminal.js';
import {
  getSidebarProjectsEl, getSidebarEl, getEmptyStateEl,
} from './index.js';

const api = window.electron_api;

// ── State (source of truth) ──────────────────────────────────

let selectedProjectPath = null;
// MRU ordering for project picker (most recently selected first)
const projectMRU = [];
// Project-level activity tracking
const projectActivity = new Set();
// Project list (synced with ProjectStore via IPC)
const projects = [];

// Getter/setter for selectedProjectPath
function getSelectedProjectPath() { return selectedProjectPath; }
function setSelectedProjectPath(path) { selectedProjectPath = path; }

// ── Empty state ─────────────────────────────────────────────

function getEmptyStateMessage() {
  if (projects.length === 0) return 'Add a project to get started';
  if (!selectedProjectPath) return 'Select a project from the sidebar';
  if (countSessionsForProject(selectedProjectPath) === 0) return 'No sessions — click + to create one';
  return null;
}

function updateEmptyState() {
  const emptyStateEl = getEmptyStateEl();
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
  const sidebarProjectsEl = getSidebarProjectsEl();
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
  const sidebarProjectsEl = getSidebarProjectsEl();
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
  for (const s of sessions.values()) {
    // Keep settings tab's projectPath in sync so activateTab deactivation works
    if (s.type === 'settings') s.projectPath = projectPath;
    const belongsToProject = s.projectPath === projectPath;
    s.tabEl.style.display = belongsToProject ? '' : 'none';
    if (!belongsToProject) {
      s.panelEl.classList.remove('active');
      s.tabEl.classList.remove('active');
    }
  }

  // Update app glow and background image to match selected project
  updateAppGlow(projectPath);
  applyProjectBackground(projectPath);

  // Activate the last active tab for this project, or clear
  const projectSessionIds = sessionsForProject(projectPath).map(([id]) => id);
  if (projectSessionIds.length > 0) {
    activateTab(projectSessionIds[projectSessionIds.length - 1]);
  } else {
    setActiveId(null);
    // Restore persisted sessions if no live sessions exist
    restoreSessions(projectPath);
  }

  renderSidebar();
  updateStatusBar();
  refreshSettingsTab();

  // Notify listeners of project change
  document.dispatchEvent(new CustomEvent('claudiu-project-changed', { detail: { projectPath } }));
}

/** Get all session [id, session] entries for a given project path */
function sessionsForProject(projectPath) {
  return [...sessions.entries()].filter(([, s]) => s.projectPath === projectPath && s.type !== 'settings');
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
}

/** Cycle to next or previous project in the sidebar (wraps around) */
function cycleProject(direction) {
  if (projects.length < 2) return;
  const idx = projects.findIndex(p => p.path === selectedProjectPath);
  const offset = direction === 'next' ? 1 : projects.length - 1;
  selectProject(projects[(idx + offset) % projects.length].path);
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

// ── Sidebar Auto-Hide (Dock Mode) ────────────────────────────

let sidebarMode = 'pinned'; // 'pinned' | 'autohide'
let sidebarRevealed = false;
let sidebarHideTimeout = null;
let sidebarWidth = 220; // persisted width, used to restore on reveal

// Getter/setter for auto-hide state
function getSidebarMode() { return sidebarMode; }
function setSidebarMode(mode) { sidebarMode = mode; }
function getSidebarRevealed() { return sidebarRevealed; }
function getSidebarWidth() { return sidebarWidth; }
function setSidebarWidth(width) { sidebarWidth = width; }

/** Toggle between pinned and autohide sidebar modes */
function toggleSidebar() {
  const sidebarEl = getSidebarEl();
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
    api.windowState.set('sidebarMode', sidebarMode);
  }
}

/** Reveal the sidebar in autohide mode */
function revealSidebar() {
  const sidebarEl = getSidebarEl();
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
  const sidebarEl = getSidebarEl();
  if (sidebarMode !== 'autohide' || !sidebarRevealed) return;
  sidebarRevealed = false;
  sidebarEl.style.width = '0';
  sidebarEl.classList.remove('sidebar-revealed');
}

/** Set up mouse event listeners for auto-hide trigger zone and sidebar */
function initSidebarAutoHide() {
  const sidebarEl = getSidebarEl();
  const triggerZone = document.querySelector('[data-testid="sidebar-trigger-zone"]');
  if (!triggerZone) return;

  triggerZone.addEventListener('mouseenter', () => revealSidebar());
  sidebarEl.addEventListener('mouseenter', () => revealSidebar());
  sidebarEl.addEventListener('mouseleave', () => scheduleSidebarHide());
  triggerZone.addEventListener('mouseleave', () => scheduleSidebarHide());
}

// ── Sidebar resize ───────────────────────────────────────────

function initSidebarResize() {
  const sidebarEl = getSidebarEl();
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
    refitActiveTerminal();
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
      api.windowState.set('sidebarWidth', finalWidth);
    }
  });
}

// ── App glow ─────────────────────────────────────────────────

/** Update the app-shell glow color based on the active project */
async function updateAppGlow(projectNameOrPath) {
  const appEl = document.querySelector('.app');
  if (!projectNameOrPath) {
    appEl.classList.remove('has-glow');
    return;
  }
  // Accept either a project name or path — look up name from projects array if it's a path
  const proj = projects.find(p => p.path === projectNameOrPath);
  const name = proj ? proj.name : projectNameOrPath;
  const color = getProjectColor(name);
  appEl.style.setProperty('--glow-color', `hsla(${color.hue}, ${color.s}%, ${color.l}%, 1)`);
  appEl.style.setProperty('--glow-color-dim', `hsla(${color.hue}, ${color.s}%, ${color.l}%, 0.7)`);
  appEl.classList.add('has-glow');

  // Apply glow intensity from config
  const intensity = await api.appConfig.resolve('glowIntensity', selectedProjectPath);
  appEl.style.setProperty('--glow-intensity', (intensity != null ? intensity : 100) / 100);
}

/** Live-update glow intensity (called from settings slider) */
function updateGlowIntensity(value) {
  const appEl = document.querySelector('.app');
  appEl.style.setProperty('--glow-intensity', value / 100);
}

// ── Exports ──────────────────────────────────────────────────

export {
  // State
  projects, projectMRU, projectActivity,
  // State access
  getSelectedProjectPath, setSelectedProjectPath,
  sessionsForProject, countSessionsForProject, refreshProjectList,
  // Sidebar mode
  getSidebarMode, setSidebarMode, getSidebarRevealed,
  getSidebarWidth, setSidebarWidth,
  // UI
  renderSidebar, selectProject, addProject, removeProject, cycleProject,
  updateProjectActivityBadge,
  toggleSidebar, initSidebarResize, initSidebarAutoHide,
  updateEmptyState, updateAppGlow, updateGlowIntensity,
  showProjectContextMenu,
  getEmptyStateMessage,
};
