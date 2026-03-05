/**
 * ConfigService — manages global and per-project configuration
 *
 * Hierarchy: per-project config → global config → defaults
 * Global config lives in userData/config.json
 * Per-project config lives in .claudiu/config.json (inside the project folder)
 *
 * Design: each setting is a flat key (e.g. 'claudeCommand', 'terminalCommand').
 * The schema is defined once in CONFIG_SCHEMA and drives validation, defaults,
 * and the UI config screen generically — new settings just need a schema entry.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const CONFIG_SCHEMA = {
  claudeCommand: {
    label: 'Claude Code command',
    type: 'string',
    default: 'claude',
    description: 'Command to spawn Claude Code sessions',
  },
  terminalCommand: {
    label: 'Terminal command',
    type: 'string',
    default: '',
    description: 'Command to spawn terminal sessions (empty = default shell)',
  },
  theme: {
    label: 'Theme',
    type: 'select',
    options: ['system', 'dark', 'light'],
    default: 'system',
    description: 'App color theme (system follows OS preference)',
  },
  soundTheme: {
    label: 'Sound theme',
    type: 'string',
    default: 'default',
    description: 'Active sound theme directory name (or "none" to disable)',
  },
};

class ConfigService {
  constructor(logService) {
    this._logService = logService || null;
    this._globalPath = path.join(app.getPath('userData'), 'config.json');
    this._global = {};
    this._projectCache = new Map(); // projectPath -> config object
    this._loadGlobal();
  }

  /** The config schema — exposed so the renderer can build the UI dynamically */
  get schema() {
    return CONFIG_SCHEMA;
  }

  // ── Global config ────────────────────────────────────────────

  _loadGlobal() {
    try {
      this._global = JSON.parse(fs.readFileSync(this._globalPath, 'utf8'));
      if (this._logService) this._logService.info('config', `Loaded global config from ${this._globalPath}`);
    } catch (e) {
      this._global = {};
      if (this._logService) this._logService.warn('config', 'Failed to load global config: ' + (e.message || e));
    }
  }

  _saveGlobal() {
    const dir = path.dirname(this._globalPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this._globalPath, JSON.stringify(this._global, null, 2));
  }

  /** Replace all schema keys on a config object from a values map.
   *  Keys present in values are set (empty/null/undefined clears); absent keys are removed. */
  _replaceAll(config, values) {
    for (const key of Object.keys(CONFIG_SCHEMA)) {
      if (key in values) {
        const value = values[key];
        if (value === undefined || value === null || value === '') {
          delete config[key];
        } else {
          config[key] = value;
        }
      } else {
        delete config[key];
      }
    }
  }

  /** Get global config — only includes explicitly set values */
  getGlobal() {
    return { ...this._global };
  }

  /** Bulk-set global config values — replaces all schema keys.
   *  Keys present in values are set; schema keys absent from values are removed. */
  setGlobalAll(values) {
    this._replaceAll(this._global, values);
    this._saveGlobal();
  }

  // ── Per-project config ───────────────────────────────────────

  _projectConfigPath(projectPath) {
    // Auto-migrate legacy .cct/ → .claudiu/
    const newDir = path.join(projectPath, '.claudiu');
    const oldDir = path.join(projectPath, '.cct');
    if (!fs.existsSync(newDir) && fs.existsSync(oldDir)) {
      fs.renameSync(oldDir, newDir);
    }
    return path.join(projectPath, '.claudiu', 'config.json');
  }

  _loadProject(projectPath) {
    if (this._projectCache.has(projectPath)) {
      return this._projectCache.get(projectPath);
    }
    let config = {};
    try {
      config = JSON.parse(fs.readFileSync(this._projectConfigPath(projectPath), 'utf8'));
    } catch {
      // Missing or invalid config file — use empty defaults
    }
    this._projectCache.set(projectPath, config);
    return config;
  }

  _saveProject(projectPath, config) {
    const filePath = this._projectConfigPath(projectPath);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
    this._projectCache.set(projectPath, config);
  }

  /** Get per-project overrides — only includes explicitly set values */
  getProject(projectPath) {
    return { ...this._loadProject(projectPath) };
  }

  /** Bulk-set per-project config values — replaces all schema keys.
   *  Keys present in values are set; schema keys absent from values are removed. */
  setProjectAll(projectPath, values) {
    const config = this._loadProject(projectPath);
    this._replaceAll(config, values);
    this._saveProject(projectPath, config);
  }

  // ── Resolved config (project → global → default) ────────────

  /**
   * Get the effective value for a setting, resolving the hierarchy:
   *   project override → global override → schema default
   */
  resolve(key, projectPath) {
    if (!(key in CONFIG_SCHEMA)) return undefined;

    // 1. Project-level override
    if (projectPath) {
      const projectConfig = this._loadProject(projectPath);
      if (key in projectConfig) return projectConfig[key];
    }

    // 2. Global override
    if (key in this._global) return this._global[key];

    // 3. Schema default
    return CONFIG_SCHEMA[key].default;
  }

  /** Get all resolved values for a project (or global if no project) */
  resolveAll(projectPath) {
    const result = {};
    for (const key of Object.keys(CONFIG_SCHEMA)) {
      result[key] = this.resolve(key, projectPath);
    }
    return result;
  }
}

module.exports = { ConfigService, CONFIG_SCHEMA };
