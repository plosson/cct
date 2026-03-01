/**
 * WindowStateService — persists window bounds and state across app restarts
 * Stores data in userData/window-state.json
 */

const fs = require('fs');
const path = require('path');
const { app, screen } = require('electron');

const DEFAULTS = {
  width: 1200,
  height: 800,
  x: undefined,
  y: undefined,
  isMaximized: false,
  sidebarWidth: 220,
  sidebarMode: 'autohide',
  fontSize: 14,
};

class WindowStateService {
  constructor() {
    this._filePath = path.join(app.getPath('userData'), 'window-state.json');
    this._state = { ...DEFAULTS };
    this._window = null;
    this._saveTimeout = null;
    this._load();
  }

  _load() {
    let fileExists = false;
    try {
      const data = JSON.parse(fs.readFileSync(this._filePath, 'utf8'));
      this._state = { ...DEFAULTS, ...data };
      fileExists = true;
    } catch {
      this._state = { ...DEFAULTS };
    }
    this._validateBounds();
    // Create file with defaults if it doesn't exist
    if (!fileExists) this._save();
  }

  /** Ensure the saved position is still within a visible display */
  _validateBounds() {
    const { x, y, width, height } = this._state;
    if (x === undefined || y === undefined) return;

    const displays = screen.getAllDisplays();
    const visible = displays.some(d => {
      const { x: dx, y: dy, width: dw, height: dh } = d.bounds;
      // Window center must be within a display
      const cx = x + width / 2;
      const cy = y + height / 2;
      return cx >= dx && cx < dx + dw && cy >= dy && cy < dy + dh;
    });

    if (!visible) {
      this._state.x = undefined;
      this._state.y = undefined;
    }
  }

  _save() {
    try {
      const dir = path.dirname(this._filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this._filePath, JSON.stringify(this._state, null, 2));
    } catch {
      // Ignore write errors (e.g. during shutdown)
    }
  }

  /** Debounced save — avoids writing on every resize event */
  _debouncedSave() {
    if (this._saveTimeout) clearTimeout(this._saveTimeout);
    this._saveTimeout = setTimeout(() => {
      this._saveTimeout = null;
      this._save();
    }, 300);
  }

  /** Capture current window bounds into state */
  _updateBounds() {
    if (!this._window || this._window.isDestroyed()) return;
    if (this._window.isMaximized()) return; // Don't save bounds when maximized

    const bounds = this._window.getBounds();
    this._state.x = bounds.x;
    this._state.y = bounds.y;
    this._state.width = bounds.width;
    this._state.height = bounds.height;
  }

  /** Get the stored state for creating a BrowserWindow */
  get bounds() {
    const { width, height, x, y } = this._state;
    const result = { width, height };
    if (x !== undefined) result.x = x;
    if (y !== undefined) result.y = y;
    return result;
  }

  get isMaximized() {
    return this._state.isMaximized;
  }

  get sidebarWidth() {
    return this._state.sidebarWidth;
  }

  set sidebarWidth(value) {
    this._state.sidebarWidth = value;
    this._debouncedSave();
  }

  get sidebarMode() {
    return this._state.sidebarMode;
  }

  set sidebarMode(value) {
    this._state.sidebarMode = value;
    this._debouncedSave();
  }

  get fontSize() {
    return this._state.fontSize;
  }

  set fontSize(value) {
    this._state.fontSize = value;
    this._debouncedSave();
  }

  get configPath() {
    return this._filePath;
  }

  /** Attach listeners to track window state changes */
  track(win) {
    this._window = win;

    if (this._state.isMaximized) {
      win.maximize();
    }

    const onResize = () => {
      this._updateBounds();
      this._debouncedSave();
    };

    const onMove = () => {
      this._updateBounds();
      this._debouncedSave();
    };

    const onMaximize = () => {
      this._state.isMaximized = true;
      this._debouncedSave();
    };

    const onUnmaximize = () => {
      this._state.isMaximized = false;
      this._updateBounds();
      this._debouncedSave();
    };

    const onClose = () => {
      // Final save on close — flush immediately
      if (this._saveTimeout) {
        clearTimeout(this._saveTimeout);
        this._saveTimeout = null;
      }
      this._updateBounds();
      this._state.isMaximized = win.isMaximized();
      this._save();
    };

    win.on('resize', onResize);
    win.on('move', onMove);
    win.on('maximize', onMaximize);
    win.on('unmaximize', onUnmaximize);
    win.on('close', onClose);
  }
}

module.exports = { WindowStateService };
