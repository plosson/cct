/**
 * CCT - Main Process Entry Point
 */

const { app, BrowserWindow, ipcMain, Menu, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');


// Fix env on macOS — apps launched from Finder have a minimal environment.
// Capture the full login-shell environment so PTYs inherit the right PATH, etc.
// Must be synchronous so process.env is set before any PTY spawns.
if (process.platform === 'darwin') {
  try {
    const { execFileSync } = require('child_process');
    const userShell = process.env.SHELL || '/bin/zsh';
    const output = execFileSync(userShell, ['-lc', 'env -0'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    for (const entry of output.split('\0')) {
      const idx = entry.indexOf('=');
      if (idx > 0) {
        const key = entry.slice(0, idx);
        // Preserve Electron-set vars (like ELECTRON_RUN_AS_NODE)
        if (!key.startsWith('ELECTRON') && key !== '_') {
          process.env[key] = entry.slice(idx + 1);
        }
      }
    }
  } catch {
    // Fall back to minimal env if shell execution fails
  }
}

/**
 * Extract a project folder path from argv.
 * Skips Electron/Chromium flags and the app entry point.
 * Returns the first valid directory path, resolved to absolute, or null.
 */
function parseProjectPath(argv) {
  // In packaged app, argv[0] is the binary; in dev, argv[0]=electron, argv[1]=main.js
  // Skip all args that start with '-' (flags) and the electron binary / main script
  const candidates = argv.slice(app.isPackaged ? 1 : 2).filter(a => !a.startsWith('-'));
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    try {
      if (fs.statSync(resolved).isDirectory()) return resolved;
    } catch {
      // Not a valid path, skip
    }
  }
  return null;
}

// Allow tests to isolate userData (enables parallel workers)
if (process.env.CCT_USER_DATA) {
  app.setPath('userData', process.env.CCT_USER_DATA);
}

// Single instance lock (skip in test mode so parallel workers can run)
// Pass the initial project path as additionalData so the running instance receives it
const initialProjectPath = parseProjectPath(process.argv);
const gotTheLock = process.env.CCT_USER_DATA || app.requestSingleInstanceLock({ projectPath: initialProjectPath });
if (!gotTheLock) {
  app.quit();
} else {
  const { createMainWindow, getMainWindow, setTerminalService, forceCloseWindow } = require('./src/main/windows/MainWindow');
  const { TerminalService } = require('./src/main/services/TerminalService');
  const { registerTerminalIPC } = require('./src/main/ipc/terminal.ipc');
  const { ProjectStore } = require('./src/main/services/ProjectStore');
  const { ProjectConfigService } = require('./src/main/services/ProjectConfigService');
  const { registerProjectIPC } = require('./src/main/ipc/project.ipc');
  const { ConfigService } = require('./src/main/services/ConfigService');
  const { registerConfigIPC } = require('./src/main/ipc/config.ipc');
  const { WindowStateService } = require('./src/main/services/WindowStateService');
  const { installHooks, removeHooks, setLogService } = require('./src/main/services/HooksService');
  const { HookServerService } = require('./src/main/services/HookServerService');
  const { UpdaterService } = require('./src/main/services/UpdaterService');
  const { LogService } = require('./src/main/services/LogService');
  const { registerLogIPC } = require('./src/main/ipc/log.ipc');
  const { SoundThemeService } = require('./src/main/services/SoundThemeService');
  const { registerSoundThemeIPC } = require('./src/main/ipc/sound-theme.ipc');

  let terminalService;
  let windowStateService;
  let projectStore;
  let hookServerService;

  /**
   * Open a project in the renderer: add it if new, then tell the renderer to select it.
   */
  function openProjectFromCLI(projectPath) {
    if (!projectPath) return;
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    if (projectStore) projectStore.addPath(projectPath);
    win.webContents.send('open-project', projectPath);
  }

  app.on('second-instance', (_event, argv, _workingDirectory, additionalData) => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const projectPath = additionalData?.projectPath || parseProjectPath(argv);
    openProjectFromCLI(projectPath);
  });

  // Register custom protocol for serving theme sound files
  protocol.registerSchemesAsPrivileged([
    { scheme: 'cct-sound', privileges: { standard: false, supportFetchAPI: true, stream: true } },
  ]);

  app.whenReady().then(async () => {
    const logService = new LogService();
    registerLogIPC(logService);

    const soundThemeService = new SoundThemeService(logService);

    // Handle cct-sound:// protocol — serves mp3 files from themes directory
    protocol.handle('cct-sound', (request) => {
      // URL format: cct-sound://theme-dir-name/filename.mp3
      const url = new URL(request.url);
      const themeDirName = url.hostname;
      const fileName = url.pathname.slice(1); // remove leading /
      const filePath = path.join(soundThemeService.themesDir, themeDirName, fileName);

      // Security: ensure path stays inside themes directory
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(soundThemeService.themesDir) + path.sep)) {
        return new Response('Forbidden', { status: 403 });
      }

      if (!fs.existsSync(resolved)) {
        return new Response('Not found', { status: 404 });
      }

      return net.fetch('file://' + resolved);
    });

    const projectConfigService = new ProjectConfigService();

    // Hook server + hooks installation — must complete before window creation
    // so that restored Claude sessions pick up the hooks
    setLogService(logService);
    hookServerService = new HookServerService(projectConfigService, logService);
    await hookServerService.start();
    installHooks(hookServerService.port);

    windowStateService = new WindowStateService(logService);
    const configService = new ConfigService(logService);
    const win = createMainWindow(windowStateService, configService);
    hookServerService.setWindow(win);
    terminalService = new TerminalService(win, logService);
    setTerminalService(terminalService);
    registerTerminalIPC(terminalService, projectConfigService, configService);

    projectStore = new ProjectStore(logService);
    registerProjectIPC(projectStore, projectConfigService);
    registerConfigIPC(configService);
    registerSoundThemeIPC(soundThemeService, configService);

    // Window state IPC
    ipcMain.handle('get-version', () => app.getVersion());
    ipcMain.handle('get-sidebar-width', () => windowStateService.sidebarWidth);
    ipcMain.on('set-sidebar-width', (_event, width) => { windowStateService.sidebarWidth = width; });
    ipcMain.handle('get-sidebar-mode', () => windowStateService.sidebarMode);
    ipcMain.on('set-sidebar-mode', (_event, mode) => { windowStateService.sidebarMode = mode; });
    ipcMain.handle('get-window-state-path', () => windowStateService.configPath);
    ipcMain.handle('get-font-size', () => windowStateService.fontSize);
    ipcMain.on('set-font-size', (_event, size) => { windowStateService.fontSize = size; });
    ipcMain.handle('get-debug-pane-height', () => windowStateService.debugPaneHeight);
    ipcMain.on('set-debug-pane-height', (_event, h) => { windowStateService.debugPaneHeight = h; });
    ipcMain.handle('get-debug-pane-open', () => windowStateService.debugPaneOpen);
    ipcMain.on('set-debug-pane-open', (_event, open) => { windowStateService.debugPaneOpen = open; });

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

    // Auto-updater (skips initialization in dev mode)
    new UpdaterService(win, logService);

    logService.info('app', 'CCT started — v' + app.getVersion());

    // Customize native application menu
    const menu = Menu.getApplicationMenu();

    // Disable native Cmd+W and Cmd+N — renderer handles them as tab-close and new-session
    const fileMenu = menu?.items.find(i => i.role === 'fileMenu' || i.label === 'File');
    if (fileMenu) {
      const closeItem = fileMenu.submenu?.items.find(i => i.role === 'close');
      if (closeItem) closeItem.enabled = false;
      const newWindowItem = fileMenu.submenu?.items.find(i => i.accelerator === 'CmdOrCtrl+N' || i.label === 'New Window');
      if (newWindowItem) newWindowItem.enabled = false;
    }

    // Add "Check for Updates…" to the app menu (after About)
    if (app.isPackaged) {
      const { autoUpdater } = require('electron-updater');
      const appMenu = menu?.items[0];
      if (appMenu?.submenu) {
        const aboutIdx = appMenu.submenu.items.findIndex(i => i.role === 'about');
        const checkForUpdates = new (require('electron').MenuItem)({
          label: 'Check for Updates…',
          click: () => autoUpdater.checkForUpdates().catch(() => {}),
        });
        appMenu.submenu.insert(aboutIdx + 1, checkForUpdates);
      }
    }

    Menu.setApplicationMenu(menu);

    // If launched with a project path argument, open it once the renderer is ready
    if (initialProjectPath) {
      win.webContents.once('did-finish-load', () => {
        // Small delay to let the renderer init() complete
        setTimeout(() => openProjectFromCLI(initialProjectPath), 300);
      });
    }
  });

  app.on('before-quit', () => {
    // Force close skips the confirmation dialog (triggered by app.quit(), Cmd+Q, etc.)
    forceCloseWindow();
    removeHooks();
    if (hookServerService) hookServerService.stop();
    if (terminalService) terminalService.killAll();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
