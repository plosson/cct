/**
 * HookServerService
 * Local HTTP server that receives Claude Code hook events.
 * Binds to 127.0.0.1:0 (dynamic port, localhost only).
 */

const http = require('http');

class HookServerService {
  /**
   * @param {import('./ProjectConfigService').ProjectConfigService} projectConfigService
   * @param {import('./LogService').LogService} logService
   */
  constructor(projectConfigService, logService) {
    this._projectConfigService = projectConfigService;
    this._logService = logService;
    this._mainWindow = null;
    this._server = null;
    this._port = null;
  }

  /**
   * Set the main window for IPC broadcasts (can be called after start)
   * @param {import('electron').BrowserWindow} win
   */
  setWindow(win) {
    this._mainWindow = win;
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
   * For SessionStart (command hook): CLAUDIU_SESSION_ID arrives via header, Claude's session_id in body.
   * For all other events (HTTP hooks): only payload.session_id is available.
   */
  _processEvent(headers, body) {
    // Only process hooks sent by Claudiu (ignore other tools' hooks)
    if (headers['x-claudiu-hook'] !== 'true') return;

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return;
    }

    const hookEvent = payload.hook_event_name || 'unknown';
    const claudeSessionId = payload.session_id;

    if (!claudeSessionId) return;

    const shortId = claudeSessionId.slice(0, 8);

    // Gate: only process hooks from Claude Code sessions started by Claudiu
    if (hookEvent === 'SessionStart') {
      const claudiuSessionId = headers['x-claudiu-session-id'];
      const linked = claudiuSessionId && this._projectConfigService.updateClaudeSessionId(claudiuSessionId, claudeSessionId);
      if (!linked) {
        this._logService.info('hooks', `${hookEvent} — claude=${shortId} (ignored: not a Claudiu session)`);
        return;
      }
      const ctx = this._projectConfigService.getSessionContext(claudeSessionId);
      const ctxLabel = ctx ? ` [${ctx.projectName} / ${ctx.tabLabel}]` : '';
      this._logService.info('hooks', `Linked claude=${shortId} → claudiu=${claudiuSessionId.slice(0, 8)}${ctxLabel}`);
    } else if (!this._projectConfigService.hasClaudeSession(claudeSessionId)) {
      this._logService.info('hooks', `${hookEvent} — claude=${shortId} (ignored: not a Claudiu session)`);
      return;
    }

    const ctx = this._projectConfigService.getSessionContext(claudeSessionId);
    const ctxLabel = ctx ? ` [${ctx.projectName} / ${ctx.tabLabel}]` : '';
    this._logService.info('hooks', `${hookEvent} — claude=${shortId}${ctxLabel}`);

    // Broadcast to renderer
    if (this._mainWindow && !this._mainWindow.isDestroyed()) {
      this._mainWindow.webContents.send('hook-event', {
        event: hookEvent,
        claudeSessionId,
        payload,
      });
    }
  }
}

module.exports = { HookServerService };
