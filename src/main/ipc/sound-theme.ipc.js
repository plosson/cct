/**
 * Sound Theme IPC handlers
 * Bridges renderer ↔ SoundThemeService via Electron IPC
 */

const { ipcMain, dialog } = require('electron');

/**
 * Register all sound-theme-related IPC handlers
 * @param {import('../services/SoundThemeService').SoundThemeService} soundThemeService
 * @param {import('../services/ConfigService').ConfigService} configService
 */
function registerSoundThemeIPC(soundThemeService, configService) {
  /** After a COW fork, update config to point to the new theme directory */
  function updateConfigAfterFork(projectPath, newDirName) {
    if (projectPath) {
      configService.setProjectAll(projectPath, {
        ...configService.getProject(projectPath), soundTheme: newDirName,
      });
    } else {
      configService.setGlobalAll({ ...configService.getGlobal(), soundTheme: newDirName });
    }
  }
  ipcMain.handle('sound-theme-list', () => {
    return soundThemeService.listThemes();
  });

  ipcMain.handle('sound-theme-install-zip', async (event) => {
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: 'Install Sound Theme',
      filters: [{ name: 'Zip files', extensions: ['zip'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) {
      return { success: false, error: 'Cancelled' };
    }
    return soundThemeService.installFromZip(result.filePaths[0]);
  });

  ipcMain.handle('sound-theme-install-github', (_event, repoUrl) => {
    return soundThemeService.installFromGitHub(repoUrl);
  });

  ipcMain.handle('sound-theme-remove', (_event, dirName) => {
    return soundThemeService.removeTheme(dirName);
  });

  ipcMain.handle('sound-theme-fork', (_event, dirName) => {
    return soundThemeService.forkTheme(dirName);
  });

  ipcMain.handle('sound-theme-get-sounds', (_event, projectPath) => {
    const themeName = configService.resolve('soundTheme', projectPath);
    return soundThemeService.getResolvedSoundMap(themeName);
  });

  ipcMain.handle('sound-theme-remove-sound', (_event, { dirName, eventName }) => {
    return soundThemeService.removeSoundFromTheme(dirName, eventName);
  });

  ipcMain.handle('sound-theme-export', async (event, dirName) => {
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win, {
      title: 'Export Sound Theme',
      defaultPath: `${dirName}.zip`,
      filters: [{ name: 'Zip files', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) {
      return { success: false, error: 'Cancelled' };
    }
    return soundThemeService.exportThemeAsZip(dirName, result.filePath);
  });

  // ── Upload sound to theme (copy-on-write) ──────────────────

  ipcMain.handle('sound-theme-upload-sound', async (event, { eventName, projectPath }) => {
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: `Upload sound for ${eventName}`,
      filters: [{ name: 'Audio files', extensions: ['mp3', 'wav', 'ogg', 'webm'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) {
      return { success: false, error: 'Cancelled' };
    }
    const themeName = configService.resolve('soundTheme', projectPath);
    if (!themeName || themeName === 'none') {
      return { success: false, error: 'No theme active' };
    }
    const uploadResult = soundThemeService.uploadSoundToTheme(themeName, eventName, result.filePaths[0]);
    if (uploadResult.forked) updateConfigAfterFork(projectPath, uploadResult.dirName);
    return uploadResult;
  });

  ipcMain.handle('sound-theme-save-trim', (_event, { eventName, trimStart, trimEnd, projectPath }) => {
    const themeName = configService.resolve('soundTheme', projectPath);
    if (!themeName || themeName === 'none') {
      return { success: false, error: 'No theme active' };
    }
    const result = soundThemeService.saveTrimData(themeName, eventName, trimStart, trimEnd);
    if (result.forked) updateConfigAfterFork(projectPath, result.dirName);
    return result;
  });

}

module.exports = { registerSoundThemeIPC };
