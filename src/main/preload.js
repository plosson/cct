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
  // Placeholder — will be extended in later steps
  getVersion: () => ipcRenderer.invoke('get-version')
});
