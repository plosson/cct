/**
 * Preload Script
 * Exposes IPC API to renderer with context isolation
 */

const { contextBridge, ipcRenderer, clipboard } = require('electron');

/** Create an IPC listener that returns an unsubscribe function */
function createListener(channel) {
  return (callback) => {
    const subscription = (event, ...args) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  };
}

contextBridge.exposeInMainWorld('electron_api', {
  getVersion: () => ipcRenderer.invoke('get-version'),

  config: {
    spawnCommand: process.env.CCT_COMMAND || undefined
  },

  terminal: {
    create: (params) => ipcRenderer.invoke('terminal-create', params),
    input: ({ id, data }) => ipcRenderer.send('terminal-input', { id, data }),
    resize: ({ id, cols, rows }) => ipcRenderer.send('terminal-resize', { id, cols, rows }),
    kill: ({ id }) => ipcRenderer.send('terminal-kill', { id }),
    onData: createListener('terminal-data'),
    onExit: createListener('terminal-exit'),
    count: () => ipcRenderer.invoke('terminal-count')
  },

  windowState: {
    getSidebarWidth: () => ipcRenderer.invoke('get-sidebar-width'),
    setSidebarWidth: (width) => ipcRenderer.send('set-sidebar-width', width),
    getFontSize: () => ipcRenderer.invoke('get-font-size'),
    setFontSize: (size) => ipcRenderer.send('set-font-size', size),
    getConfigPath: () => ipcRenderer.invoke('get-window-state-path'),
  },

  contextMenu: {
    show: (items) => ipcRenderer.invoke('show-context-menu', { items }),
  },

  clipboard: {
    writeText: (text) => clipboard.writeText(text),
    readText: () => clipboard.readText(),
  },

  projects: {
    list: () => ipcRenderer.invoke('project-list'),
    add: () => ipcRenderer.invoke('project-add'),
    addPath: (folderPath) => ipcRenderer.invoke('project-add-path', { folderPath }),
    remove: (path) => ipcRenderer.invoke('project-remove', { path }),
    configPath: () => ipcRenderer.invoke('project-config-path'),
    getSessions: (projectPath) => ipcRenderer.invoke('get-project-sessions', projectPath),
    clearSessions: (projectPath) => ipcRenderer.invoke('clear-project-sessions', projectPath)
  }
});
