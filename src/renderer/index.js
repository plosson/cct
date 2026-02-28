/**
 * Renderer — tabbed terminal manager
 * Creates and manages multiple xterm.js sessions connected to PTYs via IPC
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const api = window.electron_api;

const sessions = new Map(); // id -> { terminal, fitAddon, panelEl, tabEl, cleanup }
let activeId = null;
let sessionCounter = 0;

// Static DOM elements (populated in init)
let terminalsContainer;
let tabBarTabs;

const TERMINAL_OPTIONS = {
  cursorBlink: true,
  fontSize: 14,
  fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
  theme: {
    background: '#1a1a2e',
    foreground: '#e0e0e0',
    cursor: '#e0e0e0',
    selectionBackground: 'rgba(255, 255, 255, 0.2)'
  }
};

async function createSession() {
  sessionCounter++;
  const label = `Session ${sessionCounter}`;

  const panelEl = document.createElement('div');
  panelEl.className = 'terminal-panel';
  terminalsContainer.appendChild(panelEl);

  const terminal = new Terminal(TERMINAL_OPTIONS);
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(panelEl);

  const { id } = await api.terminal.create({
    command: api.config?.spawnCommand,
    cols: terminal.cols,
    rows: terminal.rows
  });

  const tabEl = document.createElement('div');
  tabEl.className = 'tab-item';
  tabEl.dataset.testid = 'tab';
  tabEl.dataset.tabId = String(id);
  tabEl.innerHTML = `<span class="tab-label">${label}</span><button class="tab-close" data-testid="tab-close">&times;</button>`;
  tabBarTabs.appendChild(tabEl);

  tabEl.addEventListener('click', (e) => {
    if (!e.target.closest('.tab-close')) activateTab(id);
  });

  tabEl.querySelector('.tab-close').addEventListener('click', () => closeTab(id));

  const onDataDisposable = terminal.onData((data) => api.terminal.input({ id, data }));

  const unsubData = api.terminal.onData(({ id: termId, data }) => {
    if (termId === id) terminal.write(data);
  });

  const unsubExit = api.terminal.onExit(({ id: termId }) => {
    if (termId === id) panelEl.setAttribute('data-terminal-exited', 'true');
  });

  const resizeObserver = new ResizeObserver(() => {
    if (activeId === id) {
      fitAddon.fit();
      api.terminal.resize({ id, cols: terminal.cols, rows: terminal.rows });
    }
  });
  resizeObserver.observe(panelEl);

  const cleanup = () => {
    onDataDisposable.dispose();
    unsubData();
    unsubExit();
    resizeObserver.disconnect();
    terminal.dispose();
  };

  sessions.set(id, { terminal, fitAddon, panelEl, tabEl, cleanup });
  activateTab(id);
}

/** Switch the visible tab and focus its terminal */
function activateTab(id) {
  const session = sessions.get(id);
  if (!session) return;

  for (const s of sessions.values()) {
    s.panelEl.classList.remove('active');
    s.tabEl.classList.remove('active');
  }

  session.panelEl.classList.add('active');
  session.tabEl.classList.add('active');
  activeId = id;

  session.fitAddon.fit();
  api.terminal.resize({ id, cols: session.terminal.cols, rows: session.terminal.rows });
  session.terminal.focus();
}

/** Close a tab, activating a neighbor or creating a fresh session if none remain */
function closeTab(id) {
  const session = sessions.get(id);
  if (!session) return;

  api.terminal.kill({ id });
  session.cleanup();
  session.panelEl.remove();
  session.tabEl.remove();
  sessions.delete(id);

  if (activeId === id) {
    activeId = null;
    const remaining = [...sessions.keys()];
    if (remaining.length > 0) {
      activateTab(remaining[remaining.length - 1]);
    }
  }

  if (sessions.size === 0) {
    createSession();
  }
}

/** Cycle to next or previous tab */
function cycleTab(direction) {
  const ids = [...sessions.keys()];
  if (ids.length < 2) return;
  const idx = ids.indexOf(activeId);
  const offset = direction === 'next' ? 1 : ids.length - 1;
  activateTab(ids[(idx + offset) % ids.length]);
}

// Test helpers
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

async function init() {
  terminalsContainer = document.getElementById('terminals');
  tabBarTabs = document.querySelector('.tab-bar-tabs');

  document.addEventListener('keydown', (e) => {
    if (!e.metaKey && !e.ctrlKey) return;

    switch (e.key) {
      case 't':
        e.preventDefault();
        createSession();
        break;
      case 'w':
        e.preventDefault();
        if (activeId !== null) closeTab(activeId);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        cycleTab('prev');
        break;
      case 'ArrowRight':
        e.preventDefault();
        cycleTab('next');
        break;
    }
  });

  document.querySelector('[data-testid="new-tab-btn"]').addEventListener('click', () => createSession());

  await createSession();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
