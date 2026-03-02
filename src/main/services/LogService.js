/**
 * LogService — structured logging with ring buffer and IPC forwarding
 * Singleton instantiated in main.js. Forwards entries to all BrowserWindows.
 */

const { BrowserWindow } = require('electron');

const MAX_ENTRIES = 500;

class LogService {
  constructor() {
    this._entries = [];
  }

  info(source, message) {
    this._add('info', source, message);
  }

  warn(source, message) {
    this._add('warn', source, message);
  }

  error(source, message) {
    this._add('error', source, message);
  }

  getHistory() {
    return [...this._entries];
  }

  clear() {
    this._entries = [];
  }

  _add(level, source, message) {
    const entry = { timestamp: Date.now(), level, source, message };
    this._entries.push(entry);
    if (this._entries.length > MAX_ENTRIES) {
      this._entries.shift();
    }
    this._broadcast(entry);
  }

  _broadcast(entry) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('log-entry', entry);
      }
    }
  }
}

module.exports = { LogService };
