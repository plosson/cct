/**
 * CCT - Main Process Entry Point
 */

const { app, Menu } = require('electron');

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
  const { ProjectStore } = require('./src/main/services/ProjectStore');
  const { registerProjectIPC } = require('./src/main/ipc/project.ipc');

  let terminalService;

  app.on('second-instance', () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    const win = createMainWindow();
    terminalService = new TerminalService(win);
    registerTerminalIPC(terminalService);

    const projectStore = new ProjectStore();
    registerProjectIPC(projectStore);

    // Disable Cmd+W in the native menu so the renderer handles it as tab-close
    const menu = Menu.getApplicationMenu();
    const closeItem = menu?.items
      .find(i => i.role === 'fileMenu' || i.label === 'File')
      ?.submenu?.items.find(i => i.role === 'close');
    if (closeItem) {
      closeItem.enabled = false;
      Menu.setApplicationMenu(menu);
    }
  });

  app.on('before-quit', () => {
    if (terminalService) terminalService.killAll();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
