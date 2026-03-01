/**
 * CCT - Main Process Entry Point
 */

const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');

// Fix PATH on macOS — apps launched from Finder have a minimal PATH
if (process.platform === 'darwin') {
  const { execFile } = require('child_process');
  const userShell = process.env.SHELL || '/bin/zsh';
  execFile(userShell, ['-lc', 'echo $PATH'], {
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
  const { createMainWindow, getMainWindow, setTerminalService, forceCloseWindow } = require('./src/main/windows/MainWindow');
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
    setTerminalService(terminalService);
    const projectConfigService = new ProjectConfigService();
    registerTerminalIPC(terminalService, projectConfigService);

    const projectStore = new ProjectStore();
    registerProjectIPC(projectStore, projectConfigService);

    // Window state IPC
    ipcMain.handle('get-version', () => app.getVersion());
    ipcMain.handle('get-sidebar-width', () => windowStateService.sidebarWidth);
    ipcMain.on('set-sidebar-width', (_event, width) => { windowStateService.sidebarWidth = width; });
    ipcMain.handle('get-window-state-path', () => windowStateService.configPath);
    ipcMain.handle('get-font-size', () => windowStateService.fontSize);
    ipcMain.on('set-font-size', (_event, size) => { windowStateService.fontSize = size; });

    // Shell IPC
    ipcMain.handle('shell-show-item-in-folder', (_event, fullPath) => shell.showItemInFolder(fullPath));
    ipcMain.handle('shell-open-external', (_event, url) => shell.openExternal(url));

    // Context menu IPC
    ipcMain.handle('show-context-menu', (event, { items }) => {
      return new Promise((resolve) => {
        const contextMenu = Menu.buildFromTemplate(
          items.map(item => {
            if (item.type === 'separator') return { type: 'separator' };
            return {
              label: item.label,
              enabled: item.enabled !== false,
              click: () => resolve(item.action),
            };
          })
        );
        contextMenu.popup({
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
    // Force close skips the confirmation dialog (triggered by app.quit(), Cmd+Q, etc.)
    forceCloseWindow();
    removeHooks();
    if (terminalService) terminalService.killAll();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
