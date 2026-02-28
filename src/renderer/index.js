/**
 * Renderer — tabbed terminal manager
 * Creates and manages multiple xterm.js sessions connected to PTYs via IPC
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const api = window.electron_api;

// State
const sessions = new Map(); // id → { terminal, fitAddon, panelEl, tabEl, cleanup }
let activeId = null;
let sessionCounter = 0;

/**
 * Create a new terminal session: PTY + xterm + tab + panel
 */
async function createSession() {
  const terminalsContainer = document.getElementById('terminals');
  const tabBarTabs = document.querySelector('.tab-bar-tabs');

  sessionCounter++;
  const label = `Session ${sessionCounter}`;

  // Create terminal panel
  const panelEl = document.createElement('div');
  panelEl.className = 'terminal-panel';
  terminalsContainer.appendChild(panelEl);

  // Create xterm instance
  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
    theme: {
      background: '#1a1a2e',
      foreground: '#e0e0e0',
      cursor: '#e0e0e0',
      selectionBackground: 'rgba(255, 255, 255, 0.2)'
    }
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(panelEl);

  // Create PTY
  const { id } = await api.terminal.create({
    command: api.config?.spawnCommand,
    cols: terminal.cols,
    rows: terminal.rows
  });

  // Create tab element
  const tabEl = document.createElement('div');
  tabEl.className = 'tab-item';
  tabEl.dataset.testid = 'tab';
  tabEl.dataset.tabId = String(id);
  tabEl.innerHTML = `<span class="tab-label">${label}</span><button class="tab-close" data-testid="tab-close">&times;</button>`;
  tabBarTabs.appendChild(tabEl);

  // Tab click → activate
  tabEl.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close')) return;
    activateTab(id);
  });

  // Close button
  tabEl.querySelector('.tab-close').addEventListener('click', () => {
    closeTab(id);
  });

  // Wire terminal input → PTY
  const onDataDisposable = terminal.onData((data) => {
    api.terminal.input({ id, data });
  });

  // Wire PTY output → terminal
  const unsubData = api.terminal.onData(({ id: termId, data }) => {
    if (termId === id) terminal.write(data);
  });

  // Handle PTY exit
  const unsubExit = api.terminal.onExit(({ id: termId }) => {
    if (termId === id) {
      panelEl.setAttribute('data-terminal-exited', 'true');
    }
  });

  // Resize handling
  const resizeObserver = new ResizeObserver(() => {
    if (activeId === id) {
      fitAddon.fit();
      api.terminal.resize({ id, cols: terminal.cols, rows: terminal.rows });
    }
  });
  resizeObserver.observe(panelEl);

  // Cleanup function
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

/**
 * Switch visible tab
 */
function activateTab(id) {
  const session = sessions.get(id);
  if (!session) return;

  // Deactivate all
  for (const s of sessions.values()) {
    s.panelEl.classList.remove('active');
    s.tabEl.classList.remove('active');
  }

  // Activate target
  session.panelEl.classList.add('active');
  session.tabEl.classList.add('active');
  activeId = id;

  // Re-fit after becoming visible
  session.fitAddon.fit();
  api.terminal.resize({ id, cols: session.terminal.cols, rows: session.terminal.rows });
  session.terminal.focus();
}

/**
 * Close a tab: kill PTY, dispose xterm, remove DOM, handle last-tab
 */
function closeTab(id) {
  const session = sessions.get(id);
  if (!session) return;

  // Kill PTY
  api.terminal.kill({ id });

  // Cleanup resources
  session.cleanup();

  // Remove DOM
  session.panelEl.remove();
  session.tabEl.remove();

  // Remove from state
  sessions.delete(id);

  // If this was the active tab, activate a neighbor
  if (activeId === id) {
    activeId = null;
    const remaining = [...sessions.keys()];
    if (remaining.length > 0) {
      activateTab(remaining[remaining.length - 1]);
    }
  }

  // Always keep at least one tab
  if (sessions.size === 0) {
    createSession();
  }
}

// Expose buffer text for test assertions
window._cctGetBufferText = (targetId) => {
  const id = targetId || activeId;
  const session = sessions.get(id);
  if (!session) return '';
  const buf = session.terminal.buffer.active;
  let text = '';
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (line) text += line.translateToString(true) + '\n';
  }
  return text;
};

// Expose active tab ID for tests
window._cctActiveTabId = () => activeId;

/**
 * Init: create first session + wire keyboard shortcuts
 */
async function init() {
  // Keyboard shortcut: Cmd+T → new tab
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 't') {
      e.preventDefault();
      createSession();
    }
  });

  // + button
  document.querySelector('[data-testid="new-tab-btn"]').addEventListener('click', () => {
    createSession();
  });

  // Create first session
  await createSession();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
