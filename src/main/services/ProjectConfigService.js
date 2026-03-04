/**
 * ProjectConfigService — manages per-project .cct/sessions.json
 * Each project folder gets a .cct/ directory with a sessions.json
 * containing a stable projectId (UUID) and session tracking.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_DIR = '.cct';
const CONFIG_FILE = 'sessions.json';

class ProjectConfigService {
  constructor() {
    this._cache = new Map(); // projectPath -> config
  }

  /**
   * Read or create .cct/sessions.json for a project
   * @param {string} projectPath
   * @returns {{ projectId: string, sessions: Array }}
   */
  getConfig(projectPath) {
    if (this._cache.has(projectPath)) {
      return this._cache.get(projectPath);
    }

    const filePath = path.join(projectPath, CONFIG_DIR, CONFIG_FILE);
    let config;

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      config = {
        projectId: data.projectId || crypto.randomUUID(),
        sessions: Array.isArray(data.sessions) ? data.sessions : []
      };
    } catch {
      config = {
        projectId: crypto.randomUUID(),
        sessions: []
      };
    }

    this._cache.set(projectPath, config);
    this._save(projectPath, config);
    return config;
  }

  /**
   * Get the stable UUID for a project (creates config if needed)
   * @param {string} projectPath
   * @returns {string}
   */
  getProjectId(projectPath) {
    return this.getConfig(projectPath).projectId;
  }

  /**
   * Record a new session in the project's config
   * @param {string} projectPath
   * @param {string} sessionId
   * @param {number} terminalId
   * @param {'claude'|'terminal'} [type='claude']
   * @param {string} [claudeSessionId] — Claude Code's session ID for --resume
   */
  recordSession(projectPath, sessionId, terminalId, type = 'claude', claudeSessionId) {
    const config = this.getConfig(projectPath);
    const entry = {
      id: sessionId,
      terminalId,
      type,
      createdAt: new Date().toISOString()
    };
    if (claudeSessionId) entry.claudeSessionId = claudeSessionId;
    config.sessions.push(entry);
    this._save(projectPath, config);
  }

  /**
   * Clear all sessions for a project (keeps projectId intact)
   * @param {string} projectPath
   */
  clearSessions(projectPath) {
    const config = this.getConfig(projectPath);
    config.sessions = [];
    this._save(projectPath, config);
  }

  /**
   * Remove a session by terminalId
   * @param {string} projectPath
   * @param {number} terminalId
   */
  removeSession(projectPath, terminalId) {
    const config = this.getConfig(projectPath);
    config.sessions = config.sessions.filter(s => s.terminalId !== terminalId);
    this._save(projectPath, config);
  }

  /**
   * Update claudeSessionId for a CCT session (searched across all cached projects)
   * @param {string} cctSessionId — the CCT-assigned session UUID
   * @param {string} claudeSessionId — Claude Code's own session ID
   * @returns {boolean} true if the session was found and updated
   */
  updateClaudeSessionId(cctSessionId, claudeSessionId) {
    for (const [projectPath, config] of this._cache) {
      const entry = config.sessions.find(s => s.id === cctSessionId);
      if (entry) {
        entry.claudeSessionId = claudeSessionId;
        this._save(projectPath, config);
        return true;
      }
    }
    return false;
  }

  /**
   * Write config to .cct/sessions.json
   * @param {string} projectPath
   * @param {object} config
   */
  _save(projectPath, config) {
    const dir = path.join(projectPath, CONFIG_DIR);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, CONFIG_FILE),
      JSON.stringify(config, null, 2)
    );
  }
}

module.exports = { ProjectConfigService };
