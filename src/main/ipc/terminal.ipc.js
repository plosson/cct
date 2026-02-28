/**
 * Terminal IPC handlers
 * Bridges renderer ↔ TerminalService via Electron IPC
 */

const { ipcMain } = require('electron');

/**
 * Register all terminal-related IPC handlers
 * @param {import('../services/TerminalService').TerminalService} terminalService
 */
function registerTerminalIPC(terminalService) {
  // Request/response — renderer needs the terminal ID back
  ipcMain.handle('terminal-create', (_event, params = {}) => {
    return terminalService.create(params);
  });

  // Fire-and-forget — high-frequency input, no response needed
  ipcMain.on('terminal-input', (_event, { id, data }) => {
    terminalService.write(id, data);
  });

  ipcMain.on('terminal-resize', (_event, { id, cols, rows }) => {
    terminalService.resize(id, cols, rows);
  });

  ipcMain.on('terminal-kill', (_event, { id }) => {
    terminalService.kill(id);
  });

  // Request/response — used by tests to check for orphan PTYs
  ipcMain.handle('terminal-count', () => {
    return terminalService.count();
  });
}

module.exports = { registerTerminalIPC };
