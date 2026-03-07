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
    get: (key) => ipcRenderer.invoke('window-state-get', key),
    set: (key, value) => ipcRenderer.send('window-state-set', { key, value }),
    getConfigPath: () => ipcRenderer.invoke('get-window-state-path'),
  },

  contextMenu: {
    show: (items) => ipcRenderer.invoke('show-context-menu', { items }),
  },

  clipboard: {
    writeText: (text) => clipboard.writeText(text),
    readText: () => clipboard.readText(),
  },

  shell: {
    showItemInFolder: (fullPath) => ipcRenderer.invoke('shell-show-item-in-folder', fullPath),
    openExternal: (url) => ipcRenderer.invoke('shell-open-external', url),
  },

  updater: {
    onUpdateAvailable: createListener('update-available'),
    onUpdateDownloaded: createListener('update-downloaded'),
    onUpdateNotAvailable: createListener('update-not-available'),
    onUpdateError: createListener('update-error'),
    checkForUpdates: () => ipcRenderer.invoke('updater-check'),
    installNow: () => ipcRenderer.invoke('updater-install-now'),
  },

  projects: {
    list: () => ipcRenderer.invoke('project-list'),
    add: () => ipcRenderer.invoke('project-add'),
    addPath: (folderPath) => ipcRenderer.invoke('project-add-path', { folderPath }),
    remove: (path) => ipcRenderer.invoke('project-remove', { path }),
    configPath: () => ipcRenderer.invoke('project-config-path'),
    getSessions: (projectPath) => ipcRenderer.invoke('get-project-sessions', projectPath),
    clearSessions: (projectPath) => ipcRenderer.invoke('clear-project-sessions', projectPath),
    onOpen: createListener('open-project'),
  },

  appConfig: {
    getSchema: () => ipcRenderer.invoke('config-get-schema'),
    getGlobal: () => ipcRenderer.invoke('config-get-global'),
    setGlobal: (values) => ipcRenderer.invoke('config-set-global', values),
    getProject: (projectPath) => ipcRenderer.invoke('config-get-project', projectPath),
    setProject: (projectPath, values) => ipcRenderer.invoke('config-set-project', { projectPath, values }),
    resolve: (key, projectPath) => ipcRenderer.invoke('config-resolve', { key, projectPath }),
    resolveAll: (projectPath) => ipcRenderer.invoke('config-resolve-all', projectPath),
    pickFile: (opts) => ipcRenderer.invoke('config-pick-file', opts),
  },

  log: {
    getHistory: () => ipcRenderer.invoke('log-get-history'),
    clear: () => ipcRenderer.send('log-clear'),
    onEntry: createListener('log-entry'),
  },

  hooks: {
    onEvent: createListener('hook-event'),
  },

  notes: {
    read: (projectPath) => ipcRenderer.invoke('notes-read', { projectPath }),
    write: (projectPath, content) => ipcRenderer.invoke('notes-write', { projectPath, content }),
  },

  soundThemes: {
    list: () => ipcRenderer.invoke('sound-theme-list'),
    installFromZip: () => ipcRenderer.invoke('sound-theme-install-zip'),
    installFromGitHub: (repoUrl) => ipcRenderer.invoke('sound-theme-install-github', repoUrl),
    remove: (dirName) => ipcRenderer.invoke('sound-theme-remove', dirName),
    fork: (dirName) => ipcRenderer.invoke('sound-theme-fork', dirName),
    getSounds: (projectPath) => ipcRenderer.invoke('sound-theme-get-sounds', projectPath),
    getSoundMap: (dirName) => ipcRenderer.invoke('sound-theme-get-sound-map', dirName),
    saveTrim: (eventName, trimStart, trimEnd, projectPath) =>
      ipcRenderer.invoke('sound-theme-save-trim', { eventName, trimStart, trimEnd, projectPath }),
    uploadSound: (eventName, projectPath) =>
      ipcRenderer.invoke('sound-theme-upload-sound', { eventName, projectPath }),
    removeSound: (dirName, eventName) =>
      ipcRenderer.invoke('sound-theme-remove-sound', { dirName, eventName }),
    saveRecording: (eventName, base64Data, projectPath) =>
      ipcRenderer.invoke('sound-theme-save-recording', { eventName, base64Data, projectPath }),
    export: (dirName) => ipcRenderer.invoke('sound-theme-export', dirName),
    duplicate: (dirName, newName) => ipcRenderer.invoke('sound-theme-duplicate', { dirName, newName }),
    rename: (dirName, newName) => ipcRenderer.invoke('sound-theme-rename', { dirName, newName }),
  },

});
