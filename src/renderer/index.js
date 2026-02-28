/**
 * Renderer — xterm.js terminal
 * Creates a terminal instance connected to a PTY via IPC
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const api = window.electron_api;

async function init() {
  const container = document.getElementById('terminal-container');

  // Create terminal with dark theme matching app colors
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
  terminal.open(container);
  fitAddon.fit();

  // Expose buffer text for test assertions (before async calls)
  window._cctGetBufferText = () => {
    const buf = terminal.buffer.active;
    let text = '';
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i);
      if (line) text += line.translateToString(true) + '\n';
    }
    return text;
  };

  // Spawn PTY
  const { id } = await api.terminal.create({
    cols: terminal.cols,
    rows: terminal.rows
  });

  // Wire terminal input → PTY
  terminal.onData((data) => {
    api.terminal.input({ id, data });
  });

  // Wire PTY output → terminal
  api.terminal.onData(({ id: termId, data }) => {
    if (termId === id) {
      terminal.write(data);
    }
  });

  // Handle PTY exit
  api.terminal.onExit(({ id: termId }) => {
    if (termId === id) {
      container.setAttribute('data-terminal-exited', 'true');
    }
  });

  // Resize handling
  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
    api.terminal.resize({ id, cols: terminal.cols, rows: terminal.rows });
  });
  resizeObserver.observe(container);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
