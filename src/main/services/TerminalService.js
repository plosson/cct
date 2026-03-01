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

  /** Send an IPC message to the renderer, if the window is still alive */
  _send(channel, payload) {
    if (this._window && !this._window.isDestroyed()) {
      this._window.webContents.send(channel, payload);
    }
  }

  /**
   * Spawn a new PTY process
   * @param {{ command?: string, args?: string[], cwd?: string, cols?: number, rows?: number, env?: object, onExit?: function }} options
   * @returns {{ success: boolean, id: number }}
   */
  create({ command, args = [], cwd, cols = 80, rows = 24, env: extraEnv, onExit } = {}) {
    const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh');
    const cmd = command || shell;
    const id = this._nextId++;

    // Clean env: remove CLAUDECODE to avoid nested-session detection
    const env = { ...process.env };
    delete env.CLAUDECODE;

    // Ensure UTF-8 locale for proper unicode rendering
    if (!env.LANG) env.LANG = 'en_US.UTF-8';

    // Merge caller-provided env vars
    if (extraEnv) Object.assign(env, extraEnv);

    const ptyProcess = pty.spawn(cmd, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: cwd || os.homedir(),
      env
    });

    // Adaptive batching: accumulate data and flush at intervals
    // Starts at 4ms, increases to 16ms then 32ms under heavy output
    let buffer = '';
    let batchTimeout = null;
    let batchInterval = 4;
    let bytesSinceLastFlush = 0;

    const flush = () => {
      if (buffer) {
        this._send('terminal-data', { id, data: buffer });
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

      if (onExit) onExit({ id, exitCode });
      this._send('terminal-exit', { id, exitCode });
    });

    this._terminals.set(id, { ptyProcess, onDataDisposable, onExitDisposable });
    return { success: true, id };
  }

  write(id, data) {
    const entry = this._terminals.get(id);
    if (entry) entry.ptyProcess.write(data);
  }

  resize(id, cols, rows) {
    const entry = this._terminals.get(id);
    if (!entry) return;
    try {
      entry.ptyProcess.resize(cols, rows);
    } catch {
      // PTY file descriptor may already be closed (race with exit)
    }
  }

  kill(id) {
    const entry = this._terminals.get(id);
    if (entry) entry.ptyProcess.kill();
  }

  /** Kill all terminals -- used during app shutdown */
  killAll() {
    for (const entry of this._terminals.values()) {
      entry.ptyProcess.kill();
    }
  }

  count() {
    return this._terminals.size;
  }
}

module.exports = { TerminalService };
