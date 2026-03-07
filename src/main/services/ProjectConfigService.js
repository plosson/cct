/**
 * ProjectConfigService — manages per-project .claudiu/sessions.json
 * Each project folder gets a .claudiu/ directory with a sessions.json
 * containing a stable projectId (UUID) and session tracking.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_DIR = '.claudiu';
const LEGACY_CONFIG_DIR = '.cct';
const CONFIG_FILE = 'sessions.json';

class ProjectConfigService {
  constructor() {
    this._cache = new Map(); // projectPath -> config
    this._linkedClaudeSessions = new Set(); // Claude Code session IDs linked via hooks
  }

  /**
   * Read or create .claudiu/sessions.json for a project
   * @param {string} projectPath
   * @returns {{ projectId: string, sessions: Array }}
   */
  getConfig(projectPath) {
    this._migrateIfNeeded(projectPath);

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
    const removed = config.sessions.find(s => s.terminalId === terminalId);
    if (removed && removed.claudeSessionId) {
      this._linkedClaudeSessions.delete(removed.claudeSessionId);
    }
    config.sessions = config.sessions.filter(s => s.terminalId !== terminalId);
    this._save(projectPath, config);
  }

  /**
   * Check if a Claude Code session ID is linked to a Claudiu session (O(1) via index)
   * @param {string} claudeSessionId
   * @returns {boolean}
   */
  hasClaudeSession(claudeSessionId) {
    return this._linkedClaudeSessions.has(claudeSessionId);
  }

  /**
   * Update claudeSessionId for a Claudiu session (searched across all cached projects)
   * @param {string} claudiuSessionId — the Claudiu-assigned session UUID
   * @param {string} claudeSessionId — Claude Code's own session ID
   * @returns {boolean} true if the session was found and updated
   */
  updateClaudeSessionId(claudiuSessionId, claudeSessionId) {
    for (const [projectPath, config] of this._cache) {
      const entry = config.sessions.find(s => s.id === claudiuSessionId);
      if (entry) {
        entry.claudeSessionId = claudeSessionId;
        this._linkedClaudeSessions.add(claudeSessionId);
        this._save(projectPath, config);
        return true;
      }
    }
    return false;
  }


  /**
   * Look up project name and tab label for a Claude Code session ID.
   * @param {string} claudeSessionId
   * @returns {{ projectName: string, tabLabel: string }|null}
   */
  getSessionContext(claudeSessionId) {
    for (const [projectPath, config] of this._cache) {
      const entry = config.sessions.find(s => s.claudeSessionId === claudeSessionId);
      if (entry) {
        const projectName = path.basename(projectPath);
        const type = entry.type || 'claude';
        const sameType = config.sessions.filter(s => (s.type || 'claude') === type);
        const idx = sameType.indexOf(entry) + 1;
        const tabLabel = type === 'claude' ? `Claude ${idx}` : `Terminal ${idx}`;
        return { projectName, tabLabel };
      }
    }
    return null;
  }

  /**
   * Auto-migrate legacy .cct/ directory to .claudiu/ if needed.
   * Only migrates if .claudiu/ doesn't exist but .cct/ does.
   * @param {string} projectPath
   */
  _migrateIfNeeded(projectPath) {
    const newDir = path.join(projectPath, CONFIG_DIR);
    const oldDir = path.join(projectPath, LEGACY_CONFIG_DIR);
    if (!fs.existsSync(newDir) && fs.existsSync(oldDir)) {
      fs.renameSync(oldDir, newDir);
    }
  }

  /**
   * Write config to .claudiu/sessions.json
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
