/**
 * Project IPC handlers
 * Bridges renderer ↔ ProjectStore via Electron IPC
 */

const { ipcMain } = require('electron');

/**
 * Register all project-related IPC handlers
 * @param {import('../services/ProjectStore').ProjectStore} projectStore
 */
function registerProjectIPC(projectStore) {
  ipcMain.handle('project-list', () => {
    return projectStore.list();
  });

  ipcMain.handle('project-add', () => {
    return projectStore.add();
  });

  ipcMain.handle('project-add-path', (_event, { folderPath }) => {
    return projectStore.addPath(folderPath);
  });

  ipcMain.handle('project-remove', (_event, { path }) => {
    projectStore.remove(path);
  });

  ipcMain.handle('project-config-path', () => {
    return projectStore.configPath;
  });
}

module.exports = { registerProjectIPC };
