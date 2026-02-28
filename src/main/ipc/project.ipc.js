/**
 * Project IPC handlers
 * Bridges renderer ↔ ProjectStore via Electron IPC
 */

const { ipcMain } = require('electron');

/**
 * Register all project-related IPC handlers
 * @param {import('../services/ProjectStore').ProjectStore} projectStore
 * @param {import('../services/ProjectConfigService').ProjectConfigService} projectConfigService
 */
function registerProjectIPC(projectStore, projectConfigService) {
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

  ipcMain.handle('get-project-sessions', (_event, projectPath) => {
    return projectConfigService.getConfig(projectPath).sessions;
  });

  ipcMain.handle('clear-project-sessions', (_event, projectPath) => {
    projectConfigService.clearSessions(projectPath);
  });
}

module.exports = { registerProjectIPC };
