/**
 * Notes panel — right-side markdown editor with autosave
 * Saves to {projectPath}/.claudiu/notes.md
 */

import { getSelectedProjectPath } from './sidebar.js';
import { refitActiveTerminal, getActiveSession } from './terminal.js';

const api = window.electron_api;

const MIN_WIDTH = 200;
const MAX_WIDTH = 600;

let notesOpen = false;
let notesPanelEl = null;
let notesTextareaEl = null;
let notesResizeHandle = null;
let panelWidth = 320;
let saveTimer = null;
let currentProjectPath = null;
let dirty = false;

function getNotesPanel() {
  if (!notesPanelEl) {
    notesPanelEl = document.querySelector('[data-testid="notes-panel"]');
    notesTextareaEl = notesPanelEl?.querySelector('[data-testid="notes-textarea"]');
    notesResizeHandle = document.querySelector('[data-testid="notes-resize-handle"]');

    if (notesTextareaEl) {
      notesTextareaEl.addEventListener('input', () => {
        dirty = true;
        scheduleSave();
      });
    }

    // Close button
    notesPanelEl?.querySelector('[data-testid="notes-close-btn"]')
      ?.addEventListener('click', toggleNotes);
  }
  return notesPanelEl;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (dirty && currentProjectPath && notesTextareaEl) {
      dirty = false;
      api.notes.write(currentProjectPath, notesTextareaEl.value).catch(() => {});
    }
  }, 1000);
}

async function loadNotes() {
  const projectPath = getSelectedProjectPath();
  if (!projectPath) return;

  // Save pending changes for previous project before switching
  if (dirty && currentProjectPath && notesTextareaEl) {
    if (saveTimer) clearTimeout(saveTimer);
    dirty = false;
    await api.notes.write(currentProjectPath, notesTextareaEl.value).catch(() => {});
  }

  currentProjectPath = projectPath;
  if (notesTextareaEl) {
    notesTextareaEl.value = await api.notes.read(projectPath);
  }
}

async function toggleNotes() {
  const panel = getNotesPanel();
  if (!panel) return;

  notesOpen = !notesOpen;

  if (notesOpen) {
    panel.classList.add('open');
    panel.style.width = panelWidth + 'px';
    notesResizeHandle?.classList.add('visible');
    await loadNotes();
    notesTextareaEl?.focus();
  } else {
    // Save before closing
    if (dirty && currentProjectPath && notesTextareaEl) {
      if (saveTimer) clearTimeout(saveTimer);
      dirty = false;
      api.notes.write(currentProjectPath, notesTextareaEl.value).catch(() => {});
    }
    panel.classList.remove('open');
    panel.style.width = '';
    notesResizeHandle?.classList.remove('visible');
    // Return focus to terminal
    const session = getActiveSession();
    if (session) session.terminal.focus();
  }

  // Refit terminal after panel toggle
  requestAnimationFrame(() => refitActiveTerminal());
}

/** Reload notes when project changes (if panel is open) */
async function onProjectChanged() {
  if (notesOpen) {
    await loadNotes();
  }
}

function isNotesOpen() {
  return notesOpen;
}

function initNotesResize() {
  const handle = document.querySelector('[data-testid="notes-resize-handle"]');
  if (!handle) return;

  let isDragging = false;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('mousedown', (e) => {
    if (!notesOpen) return;
    isDragging = true;
    startX = e.clientX;
    startWidth = notesPanelEl.getBoundingClientRect().width;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    // Dragging left increases width (handle is to the left of panel)
    const delta = startX - e.clientX;
    const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta));
    notesPanelEl.style.width = newWidth + 'px';
    refitActiveTerminal();
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    panelWidth = Math.round(notesPanelEl.getBoundingClientRect().width);
    if (api.windowState) {
      api.windowState.set('notesPanelWidth', panelWidth);
    }
  });
}

async function initNotes() {
  // Restore persisted width
  if (api.windowState) {
    const savedWidth = await api.windowState.get('notesPanelWidth');
    if (savedWidth && savedWidth >= MIN_WIDTH && savedWidth <= MAX_WIDTH) {
      panelWidth = savedWidth;
    }
  }

  initNotesResize();
  document.addEventListener('claudiu-project-changed', () => onProjectChanged());
}

/** Read notes content for a project path */
async function readNotes(projectPath) {
  if (!projectPath) return '';
  return api.notes.read(projectPath);
}

/** Write notes content for a project path */
async function writeNotes(projectPath, content) {
  if (!projectPath) return;
  return api.notes.write(projectPath, content).catch(() => {});
}

export { toggleNotes, onProjectChanged, isNotesOpen, initNotes, readNotes, writeNotes };
