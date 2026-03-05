/**
 * Main Window Manager
 */

const { BrowserWindow, dialog, nativeTheme } = require('electron');
const path = require('path');

let mainWindow = null;
let terminalService = null;
let forceClose = false;

const THEME_BACKGROUNDS = { dark: '#111111', light: '#f5f5f7' };

function resolveBackgroundColor(configService) {
  if (!configService) return THEME_BACKGROUNDS.dark;
  const theme = configService.resolve('theme');
  if (theme === 'dark') return THEME_BACKGROUNDS.dark;
  if (theme === 'light') return THEME_BACKGROUNDS.light;
  // 'system' — use OS preference
  return nativeTheme.shouldUseDarkColors ? THEME_BACKGROUNDS.dark : THEME_BACKGROUNDS.light;
}

function setTerminalService(service) {
  terminalService = service;
}

function createMainWindow(windowStateService, configService) {
  const isMac = process.platform === 'darwin';

  const bounds = windowStateService ? windowStateService.bounds : { width: 1200, height: 800 };

  const headless = process.env.CLAUDIU_HEADLESS === '1';

  mainWindow = new BrowserWindow({
    ...bounds,
    show: !headless,
    minWidth: 800,
    minHeight: 500,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 12, y: 12 } : undefined,
    backgroundColor: resolveBackgroundColor(configService),
    vibrancy: isMac ? 'under-window' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    transparent: isMac,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, '..', 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', '..', '..', 'index.html'));

  if (windowStateService) {
    windowStateService.track(mainWindow);
  }

  mainWindow.on('close', (e) => {
    if (forceClose) return;
    if (!terminalService || terminalService.count() === 0) return;

    const count = terminalService.count();
    const result = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['Close', 'Cancel'],
      defaultId: 1,
      title: 'Close Window',
      message: `You have ${count} active terminal session${count === 1 ? '' : 's'}.`,
      detail: 'Closing the window will terminate all running sessions.',
    });

    if (result === 1) {
      e.preventDefault();
    }
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    const { reason } = details;
    // 'clean-exit' is normal (e.g. window.close()); only recover from crashes
    if (reason === 'clean-exit') return;

    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Renderer Crashed',
      message: `The window crashed (${reason}).`,
      detail: 'The app will reload. Active terminal sessions may need to be reconnected.',
      buttons: ['Reload'],
    }).then(() => {
      mainWindow.webContents.reload();
    });
  });

  mainWindow.webContents.on('unresponsive', () => {
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Window Unresponsive',
      message: 'The window is not responding.',
      detail: 'Would you like to wait or reload?',
      buttons: ['Wait', 'Reload'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 1) mainWindow.webContents.reload();
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function getMainWindow() {
  return mainWindow;
}

function forceCloseWindow() {
  forceClose = true;
  if (mainWindow) mainWindow.close();
}

module.exports = { createMainWindow, getMainWindow, setTerminalService, forceCloseWindow };
