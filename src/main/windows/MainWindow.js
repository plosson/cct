/**
 * Main Window Manager
 */

const { BrowserWindow } = require('electron');
const path = require('path');

let mainWindow = null;

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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function getMainWindow() {
  return mainWindow;
}

module.exports = { createMainWindow, getMainWindow };
