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
  const { ProjectConfigService } = require('./src/main/services/ProjectConfigService');
  const { registerProjectIPC } = require('./src/main/ipc/project.ipc');
  const { WindowStateService } = require('./src/main/services/WindowStateService');
  const { installHooks, removeHooks } = require('./src/main/services/HooksService');

  let terminalService;
  let windowStateService;

  app.on('second-instance', () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    windowStateService = new WindowStateService();
    const win = createMainWindow(windowStateService);
    terminalService = new TerminalService(win);
    const projectConfigService = new ProjectConfigService();
    registerTerminalIPC(terminalService, projectConfigService);

    const projectStore = new ProjectStore();
    registerProjectIPC(projectStore, projectConfigService);

    // IPC for window state
    const { ipcMain, BrowserWindow } = require('electron');
    ipcMain.handle('get-sidebar-width', () => windowStateService.sidebarWidth);
    ipcMain.on('set-sidebar-width', (_event, width) => { windowStateService.sidebarWidth = width; });
    ipcMain.handle('get-window-state-path', () => windowStateService.configPath);

    // Generic context menu IPC
    ipcMain.handle('show-context-menu', (event, { items }) => {
      return new Promise((resolve) => {
        const menu = Menu.buildFromTemplate(
          items.map(item => {
            if (item.type === 'separator') return { type: 'separator' };
            return {
              label: item.label,
              enabled: item.enabled !== false,
              click: () => resolve(item.action),
            };
          })
        );
        menu.popup({
          window: BrowserWindow.fromWebContents(event.sender),
          callback: () => resolve(null),
        });
      });
    });

    installHooks();

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
    removeHooks();
    if (terminalService) terminalService.killAll();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
