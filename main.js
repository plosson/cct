/**
 * CCT - Main Process Entry Point
 */

const { app } = require('electron');

// Fix PATH on macOS — apps launched from Finder have a minimal PATH
if (process.platform === 'darwin') {
  const { execFile } = require('child_process');
  const shell = process.env.SHELL || '/bin/zsh';
  execFile(shell, ['-lc', 'echo $PATH'], {
    encoding: 'utf8',
    timeout: 5000,
  }, (err, stdout) => {
    if (!err && stdout) {
      const shellPath = stdout.trim();
      if (shellPath) process.env.PATH = shellPath;
    }
  });
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  const { createMainWindow, getMainWindow } = require('./src/main/windows/MainWindow');

  const { TerminalService } = require('./src/main/services/TerminalService');
  const { registerTerminalIPC } = require('./src/main/ipc/terminal.ipc');

  let terminalService = null;

  app.on('second-instance', () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    const win = createMainWindow();
    terminalService = new TerminalService(win);
    registerTerminalIPC(terminalService);
  });

  app.on('before-quit', () => {
    if (terminalService) terminalService.killAll();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('activate', () => {
    if (getMainWindow() === null) {
      createMainWindow();
    }
  });
}
