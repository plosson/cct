/**
 * UpdaterService — auto-update via electron-updater (GitHub Releases)
 * Downloads updates silently; installs on quit (Discord-style).
 * Skipped in dev mode (only works in packaged builds).
 */

const { app, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

class UpdaterService {
  constructor(mainWindow) {
    this._window = mainWindow;

    if (!app.isPackaged) return;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      this._send('update-available', { version: info.version, releaseNotes: info.releaseNotes });
    });

    autoUpdater.on('download-progress', (progress) => {
      this._send('update-download-progress', { percent: progress.percent });
    });

    autoUpdater.on('update-downloaded', (info) => {
      this._send('update-downloaded', { version: info.version });
    });

    autoUpdater.on('error', (err) => {
      this._send('update-error', { message: err?.message || String(err) });
    });

    ipcMain.handle('updater-install-now', () => {
      autoUpdater.quitAndInstall();
    });

    // Check for updates after a short delay so startup isn't blocked
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {});
    }, 3000);
  }

  _send(channel, data) {
    if (this._window && !this._window.isDestroyed()) {
      this._window.webContents.send(channel, data);
    }
  }
}

module.exports = { UpdaterService };
