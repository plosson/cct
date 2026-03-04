/**
 * HookServerService
 * Local HTTP server that receives Claude Code hook events.
 * Binds to 127.0.0.1:0 (dynamic port, localhost only).
 */

const http = require('http');

class HookServerService {
  /**
   * @param {import('./ProjectConfigService').ProjectConfigService} projectConfigService
   * @param {import('electron').BrowserWindow} mainWindow
   * @param {import('./LogService').LogService} logService
   */
  constructor(projectConfigService, mainWindow, logService) {
    this._projectConfigService = projectConfigService;
    this._mainWindow = mainWindow;
    this._logService = logService;
    this._server = null;
    this._port = null;
  }

  /** @returns {number|null} The port the server is listening on */
  get port() {
    return this._port;
  }

  /**
   * Start the HTTP server. Resolves when listening.
   * @returns {Promise<void>}
   */
  start() {
    return new Promise((resolve, reject) => {
      this._server = http.createServer((req, res) => this._handleRequest(req, res));
      this._server.listen(0, '127.0.0.1', () => {
        this._port = this._server.address().port;
        this._logService.info('hooks', `Hook server listening on 127.0.0.1:${this._port}`);
        resolve();
      });
      this._server.on('error', (err) => {
        this._logService.error('hooks', 'Hook server error: ' + err.message);
        reject(err);
      });
    });
  }

  /**
   * Stop the HTTP server.
   * @returns {Promise<void>}
   */
  stop() {
    return new Promise((resolve) => {
      if (!this._server) return resolve();
      this._server.close(() => {
        this._logService.info('hooks', 'Hook server stopped');
        resolve();
      });
    });
  }

  /**
   * Handle incoming HTTP requests.
   */
  _handleRequest(req, res) {
    if (req.method !== 'POST' || req.url !== '/hooks') {
      res.writeHead(404);
      res.end('{}');
      return;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');

      this._processEvent(req.headers, body);
    });
  }

  /**
   * Process a hook event after responding 200.
   */
  _processEvent(headers, body) {
    const cctSessionId = headers['x-cct-session-id'];
    const cctProjectId = headers['x-cct-project-id'];

    // Ignore non-CCT sessions (missing headers or unexpanded env vars)
    if (!cctSessionId || !cctProjectId ||
        cctSessionId.startsWith('$') || cctProjectId.startsWith('$')) {
      return;
    }

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return;
    }

    const hookEvent = payload.hook_event_name || headers['x-hook-event'] || 'unknown';

    this._logService.info('hooks', `${hookEvent} — session=${cctSessionId.slice(0, 8)}`);

    // Special handling: SessionStart — capture Claude's session ID
    if (hookEvent === 'SessionStart' && payload.session_id) {
      const updated = this._projectConfigService.updateClaudeSessionId(
        cctSessionId, payload.session_id
      );
      if (updated) {
        this._logService.info('hooks', `Linked Claude session ${payload.session_id} to CCT session ${cctSessionId}`);
      }
    }

    // Broadcast to renderer
    if (this._mainWindow && !this._mainWindow.isDestroyed()) {
      this._mainWindow.webContents.send('hook-event', {
        event: hookEvent,
        cctSessionId,
        cctProjectId,
        payload,
      });
    }
  }
}

module.exports = { HookServerService };
