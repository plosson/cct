/**
 * Preload Script
 * Exposes IPC API to renderer with context isolation
 */

const { contextBridge, ipcRenderer } = require('electron');

// Helper to create safe IPC listener that returns unsubscribe function
function createListener(channel) {
  return (callback) => {
    const subscription = (event, ...args) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  };
}

// Expose protected API to renderer
contextBridge.exposeInMainWorld('electron_api', {
  getVersion: () => ipcRenderer.invoke('get-version'),

  // Config from environment — allows tests to control spawn behavior
  config: {
    spawnCommand: process.env.CCT_COMMAND || undefined
  },

  terminal: {
    // Request/response — returns { success, id }
    create: (params) => ipcRenderer.invoke('terminal-create', params),
    // Fire-and-forget — high-frequency, no response needed
    input: ({ id, data }) => ipcRenderer.send('terminal-input', { id, data }),
    resize: ({ id, cols, rows }) => ipcRenderer.send('terminal-resize', { id, cols, rows }),
    kill: ({ id }) => ipcRenderer.send('terminal-kill', { id }),
    // Listeners — return unsubscribe functions
    onData: createListener('terminal-data'),
    onExit: createListener('terminal-exit'),
    // For test assertions
    count: () => ipcRenderer.invoke('terminal-count')
  }
});
