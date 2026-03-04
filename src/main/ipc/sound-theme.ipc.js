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

  ipcMain.handle('sound-theme-get-sounds', (_event, projectPath) => {
    const themeName = configService.resolve('soundTheme', projectPath);
    if (!themeName || themeName === 'none') {
      // Still check for overrides even with no theme
      return soundThemeService.getResolvedSoundMap(null, projectPath);
    }
    return soundThemeService.getResolvedSoundMap(themeName, projectPath);
  });

  // ── Sound Override IPC handlers ────────────────────────────

  ipcMain.handle('sound-override-upload', async (event, { eventName, scope }) => {
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
    return soundThemeService.saveOverride(scope, eventName, result.filePaths[0]);
  });

  ipcMain.handle('sound-override-save-base64', (_event, { eventName, base64, scope }) => {
    return soundThemeService.saveOverrideFromBase64(scope, eventName, base64);
  });

  ipcMain.handle('sound-override-remove', (_event, { eventName, scope }) => {
    return soundThemeService.removeOverride(scope, eventName);
  });
}

module.exports = { registerSoundThemeIPC };
