/**
 * Preload Script
 * Exposes IPC API to renderer with context isolation
 */

const { contextBridge, ipcRenderer } = require('electron');

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
  }
});
