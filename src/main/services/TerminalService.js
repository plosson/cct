/**
 * TerminalService — manages PTY processes
 * Singleton with Map<id, ptyProcess> for multi-terminal support.
 */

const pty = require('node-pty');
const os = require('os');

class TerminalService {
  constructor(mainWindow) {
    this._window = mainWindow;
    this._terminals = new Map();
    this._nextId = 1;
  }

  /**
   * Spawn a new PTY process
   * @param {{ cwd?: string, cols?: number, rows?: number }} options
   * @returns {{ success: boolean, id: number }}
   */
  create({ cwd, cols = 80, rows = 24 } = {}) {
    const shell = process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : '/bin/zsh');
    const id = this._nextId++;

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: cwd || os.homedir(),
      env: { ...process.env }
    });

    // Adaptive batching: accumulate data and flush at intervals
    // Starts at 4ms, increases to 16ms then 32ms under heavy output
    let buffer = '';
    let batchTimeout = null;
    let batchInterval = 4;
    let bytesSinceLastFlush = 0;

    const flush = () => {
      if (buffer && this._window && !this._window.isDestroyed()) {
        this._window.webContents.send('terminal-data', { id, data: buffer });
        buffer = '';
      }
      batchTimeout = null;

      // Adapt interval based on throughput
      if (bytesSinceLastFlush > 32768) {
        batchInterval = Math.min(32, batchInterval * 2);
      } else if (bytesSinceLastFlush < 1024) {
        batchInterval = 4;
      }
      bytesSinceLastFlush = 0;
    };

    const onDataDisposable = ptyProcess.onData((data) => {
      buffer += data;
      bytesSinceLastFlush += data.length;
      if (!batchTimeout) {
        batchTimeout = setTimeout(flush, batchInterval);
      }
    });

    const onExitDisposable = ptyProcess.onExit(({ exitCode }) => {
      // Flush any remaining buffered data
      if (batchTimeout) {
        clearTimeout(batchTimeout);
        batchTimeout = null;
      }
      if (buffer) flush();

      // Cleanup
      onDataDisposable.dispose();
      onExitDisposable.dispose();
      this._terminals.delete(id);

      if (this._window && !this._window.isDestroyed()) {
        this._window.webContents.send('terminal-exit', { id, exitCode });
      }
    });

    this._terminals.set(id, { ptyProcess, onDataDisposable, onExitDisposable });
    return { success: true, id };
  }

  /**
   * Write data to a terminal
   */
  write(id, data) {
    const entry = this._terminals.get(id);
    if (entry) entry.ptyProcess.write(data);
  }

  /**
   * Resize a terminal
   */
  resize(id, cols, rows) {
    const entry = this._terminals.get(id);
    if (entry) entry.ptyProcess.resize(cols, rows);
  }

  /**
   * Kill a specific terminal
   */
  kill(id) {
    const entry = this._terminals.get(id);
    if (entry) {
      entry.ptyProcess.kill();
    }
  }

  /**
   * Kill all terminals — used during app shutdown
   */
  killAll() {
    for (const [id, entry] of this._terminals) {
      entry.ptyProcess.kill();
    }
  }

  /**
   * Get count of active terminals
   */
  count() {
    return this._terminals.size;
  }
}

module.exports = { TerminalService };
