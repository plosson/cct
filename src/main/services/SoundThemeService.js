/**
 * SoundThemeService — manages sound theme installation, listing, and resolution
 *
 * Themes live in {userData}/themes/{theme-name}/ and contain a theme.json + mp3 files.
 * A theme.json maps hook event names to mp3 filenames.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { execFile } = require('child_process');

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'webm'];
const AUDIO_DOT_EXTENSIONS = AUDIO_EXTENSIONS.map(e => '.' + e);

class SoundThemeService {
  constructor(logService) {
    this._logService = logService || null;
    this._themesDir = path.join(app.getPath('userData'), 'themes');
    this._ensureThemesDir();
  }

  /** Log a message if a log service is available */
  _log(level, message) {
    if (this._logService) this._logService[level]('sound-theme', message);
  }

  _ensureThemesDir() {
    if (!fs.existsSync(this._themesDir)) {
      fs.mkdirSync(this._themesDir, { recursive: true });
    }
  }

  /**
   * Copy built-in themes from app resources to userData if not already present.
   * In dev mode, falls back to the project root's themes/ directory.
   */
  installBuiltInThemes() {
    const builtInNames = ['default'];

    for (const name of builtInNames) {
      const destDir = path.join(this._themesDir, name);
      if (fs.existsSync(destDir)) continue; // already installed

      // Locate the bundled theme: packaged app uses resourcesPath, dev uses project root
      let srcDir = path.join(process.resourcesPath, 'themes', name);
      if (!fs.existsSync(srcDir)) {
        // Dev fallback: SoundThemeService.js is in src/main/services/, project root is 3 levels up
        srcDir = path.join(__dirname, '..', '..', '..', 'themes', name);
      }
      if (!fs.existsSync(srcDir)) {
        this._log('warn', `Built-in theme "${name}" not found in resources`);
        continue;
      }

      this._copyDirSync(srcDir, destDir);
      this._log('info', `Installed built-in theme "${name}"`);
    }
  }

  /** @returns {string} Absolute path to the themes directory */
  get themesDir() {
    return this._themesDir;
  }

  /**
   * List all installed themes.
   * @returns {Array<{name: string, dirName: string, version?: string, author?: string, description?: string, events: object}>}
   */
  listThemes() {
    this._ensureThemesDir();
    const result = [];
    let entries;
    try {
      entries = fs.readdirSync(this._themesDir, { withFileTypes: true });
    } catch {
      return result;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = this._readThemeJson(entry.name);
      if (meta) result.push({ dirName: entry.name, ...meta });
    }
    return result;
  }

  /**
   * Get a single theme's metadata.
   * @param {string} dirName - Theme directory name
   * @returns {object|null}
   */
  getTheme(dirName) {
    const meta = this._readThemeJson(dirName);
    return meta ? { dirName, ...meta } : null;
  }

  /**
   * Read and validate theme.json from a theme directory.
   * @param {string} dirName
   * @returns {object|null}
   */
  _readThemeJson(dirName) {
    const jsonPath = path.join(this._themesDir, dirName, 'theme.json');
    try {
      const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      if (!raw.name || !raw.events || typeof raw.events !== 'object') return null;
      return {
        name: raw.name,
        version: raw.version || '0.0.0',
        author: raw.author || '',
        description: raw.description || '',
        events: raw.events,
      };
    } catch {
      return null;
    }
  }

  /**
   * Install a theme from a zip file.
   * Extracts to a temp dir, finds theme.json, and moves to themes dir.
   * @param {string} zipPath - Absolute path to the .zip file
   * @returns {Promise<{success: boolean, dirName?: string, error?: string}>}
   */
  installFromZip(zipPath) {
    return new Promise((resolve) => {
      const tmpDir = path.join(this._themesDir, '_tmp_' + Date.now());
      fs.mkdirSync(tmpDir, { recursive: true });

      // Use system unzip (available on macOS/Linux)
      execFile('unzip', ['-o', zipPath, '-d', tmpDir], (err) => {
        if (err) {
          this._cleanup(tmpDir);
          resolve({ success: false, error: 'Failed to extract zip: ' + err.message });
          return;
        }

        // Find theme.json — might be at root or one level deep
        const themeDir = this._findThemeRoot(tmpDir);
        if (!themeDir) {
          this._cleanup(tmpDir);
          resolve({ success: false, error: 'No valid theme.json found in zip' });
          return;
        }

        const meta = this._readThemeJsonAbsolute(path.join(themeDir, 'theme.json'));
        if (!meta) {
          this._cleanup(tmpDir);
          resolve({ success: false, error: 'Invalid theme.json' });
          return;
        }

        const dirName = this._sanitizeDirName(meta.name);
        const destDir = path.join(this._themesDir, dirName);

        // Remove existing theme with same name
        if (fs.existsSync(destDir)) {
          fs.rmSync(destDir, { recursive: true, force: true });
        }

        fs.renameSync(themeDir, destDir);
        this._cleanup(tmpDir);

        this._log('info', `Installed theme "${meta.name}" from zip`);
        resolve({ success: true, dirName });
      });
    });
  }

  /**
   * Install a theme from a GitHub repo URL.
   * Clones the repo (shallow) into the themes directory.
   * @param {string} repoUrl - GitHub repo URL (e.g. https://github.com/user/my-claudiu-theme)
   * @returns {Promise<{success: boolean, dirName?: string, error?: string}>}
   */
  installFromGitHub(repoUrl) {
    return new Promise((resolve) => {
      const tmpDir = path.join(this._themesDir, '_tmp_' + Date.now());

      execFile('git', ['clone', '--depth', '1', repoUrl, tmpDir], (err) => {
        if (err) {
          this._cleanup(tmpDir);
          resolve({ success: false, error: 'Git clone failed: ' + err.message });
          return;
        }

        // Remove .git directory — we don't need repo history
        const gitDir = path.join(tmpDir, '.git');
        if (fs.existsSync(gitDir)) {
          fs.rmSync(gitDir, { recursive: true, force: true });
        }

        const themeJsonPath = path.join(tmpDir, 'theme.json');
        const meta = this._readThemeJsonAbsolute(themeJsonPath);
        if (!meta) {
          this._cleanup(tmpDir);
          resolve({ success: false, error: 'No valid theme.json found in repository' });
          return;
        }

        const dirName = this._sanitizeDirName(meta.name);
        const destDir = path.join(this._themesDir, dirName);

        if (fs.existsSync(destDir)) {
          fs.rmSync(destDir, { recursive: true, force: true });
        }

        fs.renameSync(tmpDir, destDir);

        this._log('info', `Installed theme "${meta.name}" from GitHub`);
        resolve({ success: true, dirName });
      });
    });
  }

  /**
   * Remove an installed theme.
   * @param {string} dirName
   * @returns {{success: boolean, error?: string}}
   */
  removeTheme(dirName) {
    const themeDir = path.join(this._themesDir, dirName);
    if (!fs.existsSync(themeDir)) {
      return { success: false, error: 'Theme not found' };
    }
    // Safety: ensure we're removing from themes dir only
    if (!themeDir.startsWith(this._themesDir)) {
      return { success: false, error: 'Invalid theme path' };
    }
    fs.rmSync(themeDir, { recursive: true, force: true });
    this._log('info', `Removed theme "${dirName}"`);
    return { success: true };
  }

  /**
   * Resolve the full file path for a sound event in a given theme.
   * @param {string} dirName - Theme directory name
   * @param {string} event - Hook event name (e.g. 'SessionStart')
   * @returns {string|null} Absolute file path or null
   */
  getSoundPath(dirName, event) {
    const meta = this._readThemeJson(dirName);
    if (!meta || !meta.events[event]) return null;

    const filename = meta.events[event];
    const filePath = path.join(this._themesDir, dirName, filename);

    // Security: ensure resolved path stays inside theme directory
    const realPath = path.resolve(filePath);
    const themeDir = path.resolve(path.join(this._themesDir, dirName));
    if (!realPath.startsWith(themeDir + path.sep) && realPath !== themeDir) return null;

    if (!fs.existsSync(filePath)) return null;
    return filePath;
  }

  /**
   * Get the sound URL map for a theme.
   * Normalises all event formats (string / object / array) into arrays of
   * { url, trimStart?, trimEnd? }.
   * @param {string} dirName - Theme directory name
   * @returns {object|null} Map of event -> [{ url, trimStart?, trimEnd? }]
   */
  getSoundMap(dirName) {
    const meta = this._readThemeJson(dirName);
    if (!meta) return null;

    const map = {};
    for (const [event, value] of Object.entries(meta.events)) {
      const items = Array.isArray(value) ? value : [value];
      const entries = [];
      for (const item of items) {
        const filename = typeof item === 'string' ? item : item.file;
        if (!filename) continue;
        const filePath = path.join(this._themesDir, dirName, filename);
        if (!fs.existsSync(filePath)) continue;
        const entry = { url: `claudiu-sound://${dirName}/${filename}` };
        if (typeof item === 'object') {
          if (item.trimStart != null) entry.trimStart = item.trimStart;
          if (item.trimEnd != null) entry.trimEnd = item.trimEnd;
        }
        entries.push(entry);
      }
      if (entries.length > 0) map[event] = entries;
    }
    return map;
  }

  // ── Sound Overrides ─────────────────────────────────────────

  /**
   * Get the override directory for a given scope.
   * Global: {userData}/sound-overrides/global/
   * Project: {projectPath}/.claudiu/sounds/
   */
  getOverrideDir(scope) {
    if (scope.type === 'project' && scope.projectPath) {
      return path.join(scope.projectPath, '.claudiu', 'sounds');
    }
    return path.join(app.getPath('userData'), 'sound-overrides', 'global');
  }

  /**
   * Get the override file path for a specific event.
   * Returns null if no override exists.
   */
  getOverridePath(scope, eventName) {
    const dir = this.getOverrideDir(scope);
    for (const ext of AUDIO_EXTENSIONS) {
      const filePath = path.join(dir, `${eventName}.${ext}`);
      if (fs.existsSync(filePath)) return filePath;
    }
    return null;
  }

  /**
   * Save an override from a source file path.
   * Copies the file to the override directory.
   */
  saveOverride(scope, eventName, sourceFilePath) {
    const dir = this.getOverrideDir(scope);
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(sourceFilePath) || '.mp3';
    const dest = path.join(dir, `${eventName}${ext}`);
    // Remove existing overrides for this event (any extension)
    this._removeOverrideFiles(dir, eventName);
    fs.copyFileSync(sourceFilePath, dest);
    this._log('info', `Saved override for ${eventName} (${scope.type})`);
    return { success: true, path: dest };
  }

  /**
   * Remove an override for an event.
   */
  removeOverride(scope, eventName) {
    const dir = this.getOverrideDir(scope);
    this._removeOverrideFiles(dir, eventName);
    this._log('info', `Removed override for ${eventName} (${scope.type})`);
    return { success: true };
  }

  /**
   * Get the resolved sound map: theme + global overrides + project overrides.
   * Resolution: project override > global override > theme sound > none
   */
  getResolvedSoundMap(themeDirName, projectPath) {
    const map = {};

    // Start with theme sounds
    if (themeDirName && themeDirName !== 'none') {
      const themeMap = this.getSoundMap(themeDirName);
      if (themeMap) Object.assign(map, themeMap);
    }

    // Layer global overrides
    const globalDir = this.getOverrideDir({ type: 'global' });
    this._layerOverrides(map, globalDir);

    // Layer project overrides
    if (projectPath) {
      const projectDir = this.getOverrideDir({ type: 'project', projectPath });
      this._layerOverrides(map, projectDir);
    }

    return Object.keys(map).length > 0 ? map : null;
  }

  /** Layer override files from a directory onto the map */
  _layerOverrides(map, dir) {
    if (!fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir);
      for (const file of entries) {
        const ext = path.extname(file);
        if (!AUDIO_DOT_EXTENSIONS.includes(ext)) continue;
        const eventName = path.basename(file, ext);
        const absPath = path.join(dir, file);
        const encodedPath = Buffer.from(absPath).toString('base64url');
        map[eventName] = [{ url: `claudiu-sound-override://${encodedPath}/sound${ext}` }];
      }
    } catch { /* ignore */ }
  }

  /** Remove all override files for an event name (any extension) */
  _removeOverrideFiles(dir, eventName) {
    if (!fs.existsSync(dir)) return;
    for (const ext of AUDIO_EXTENSIONS) {
      const filePath = path.join(dir, `${eventName}.${ext}`);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  }

  // ── Trim metadata ───────────────────────────────────────────

  /**
   * Read theme.json, locate a specific sound entry, apply a transform, and write back.
   * Handles array/single normalization and index validation.
   * @param {string} themeDirName - Theme directory name
   * @param {string} eventName - Hook event name
   * @param {number} fileIndex - Index within the event's sound array
   * @param {function} transform - (item, items, index) => new item value
   * @returns {{success: boolean, error?: string}}
   */
  _modifyThemeEvent(themeDirName, eventName, fileIndex, transform) {
    const jsonPath = path.join(this._themesDir, themeDirName, 'theme.json');
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch {
      return { success: false, error: 'Could not read theme.json' };
    }
    if (!raw.events || !raw.events[eventName]) {
      return { success: false, error: `Event "${eventName}" not found` };
    }

    const value = raw.events[eventName];
    const isArray = Array.isArray(value);
    const items = isArray ? value : [value];

    if (fileIndex < 0 || fileIndex >= items.length) {
      return { success: false, error: 'Invalid file index' };
    }

    items[fileIndex] = transform(items[fileIndex]);
    raw.events[eventName] = isArray ? items : items[0];
    fs.writeFileSync(jsonPath, JSON.stringify(raw, null, 2), 'utf8');
    return { success: true };
  }

  /**
   * Save trim metadata into theme.json for a specific sound.
   * @param {string} themeDirName - Theme directory name
   * @param {string} eventName - Hook event name
   * @param {number} fileIndex - Index within the event's sound array
   * @param {number} trimStart - Start time in seconds
   * @param {number} trimEnd - End time in seconds
   */
  saveTrimData(themeDirName, eventName, fileIndex, trimStart, trimEnd) {
    const result = this._modifyThemeEvent(themeDirName, eventName, fileIndex, (item) => {
      const filename = typeof item === 'string' ? item : item.file;
      return { file: filename, trimStart, trimEnd };
    });
    if (result.success) this._log('info', `Saved trim data for ${eventName}[${fileIndex}]`);
    return result;
  }

  /**
   * Remove trim metadata from theme.json, reverting entry to plain filename.
   * @param {string} themeDirName - Theme directory name
   * @param {string} eventName - Hook event name
   * @param {number} fileIndex - Index within the event's sound array
   */
  removeTrimData(themeDirName, eventName, fileIndex) {
    const result = this._modifyThemeEvent(themeDirName, eventName, fileIndex, (item) => {
      return typeof item === 'object' ? item.file : item;
    });
    if (result.success) this._log('info', `Removed trim data for ${eventName}[${fileIndex}]`);
    return result;
  }

  // ── Helpers ──────────────────────────────────────────────────

  /** Find the directory containing theme.json (root or one level deep) */
  _findThemeRoot(dir) {
    if (fs.existsSync(path.join(dir, 'theme.json'))) return dir;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.')) {
          const sub = path.join(dir, entry.name);
          if (fs.existsSync(path.join(sub, 'theme.json'))) return sub;
        }
      }
    } catch { /* ignore */ }
    return null;
  }

  /** Read theme.json from an absolute path */
  _readThemeJsonAbsolute(jsonPath) {
    try {
      const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      if (!raw.name || !raw.events || typeof raw.events !== 'object') return null;
      return raw;
    } catch {
      return null;
    }
  }

  /** Sanitize a theme name into a safe directory name */
  _sanitizeDirName(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'unnamed-theme';
  }

  /** Recursively copy a directory */
  _copyDirSync(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this._copyDirSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /** Remove a temporary directory */
  _cleanup(dir) {
    try {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

module.exports = { SoundThemeService };
