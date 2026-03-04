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
    if (!themeName || themeName === 'none') return null;
    return soundThemeService.getSoundMap(themeName);
  });
}

module.exports = { registerSoundThemeIPC };
