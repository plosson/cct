/**
 * Log IPC handlers
 * Bridges renderer <-> LogService via Electron IPC
 */

const { ipcMain } = require('electron');

/**
 * Register log-related IPC handlers
 * @param {import('../services/LogService').LogService} logService
 */
function registerLogIPC(logService) {
  ipcMain.handle('log-get-history', () => {
    return logService.getHistory();
  });

  ipcMain.on('log-clear', () => {
    logService.clear();
  });
}

module.exports = { registerLogIPC };
