/**
 * Main Window Manager
 */

const { BrowserWindow, dialog } = require('electron');
const path = require('path');

let mainWindow = null;
let terminalService = null;
let forceClose = false;

function setTerminalService(service) {
  terminalService = service;
}

function createMainWindow(windowStateService) {
  const isMac = process.platform === 'darwin';

  const bounds = windowStateService ? windowStateService.bounds : { width: 1200, height: 800 };

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 800,
    minHeight: 500,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 12, y: 10 } : undefined,
    backgroundColor: '#1a1a2e',
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
