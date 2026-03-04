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

class SoundThemeService {
  constructor(logService) {
    this._logService = logService || null;
    this._themesDir = path.join(app.getPath('userData'), 'themes');
    this._ensureThemesDir();
  }

  _ensureThemesDir() {
    if (!fs.existsSync(this._themesDir)) {
      fs.mkdirSync(this._themesDir, { recursive: true });
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

        if (this._logService) this._logService.info('sound-theme', `Installed theme "${meta.name}" from zip`);
        resolve({ success: true, dirName });
      });
    });
  }

  /**
   * Install a theme from a GitHub repo URL.
   * Clones the repo (shallow) into the themes directory.
   * @param {string} repoUrl - GitHub repo URL (e.g. https://github.com/user/my-cct-theme)
   * @returns {Promise<{success: boolean, dirName?: string, error?: string}>}
   */
  installFromGitHub(repoUrl) {
    return new Promise((resolve) => {
      // Extract repo name from URL for the directory name
      const urlParts = repoUrl.replace(/\.git$/, '').split('/');
      const repoName = urlParts[urlParts.length - 1] || 'unknown-theme';
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

        if (this._logService) this._logService.info('sound-theme', `Installed theme "${meta.name}" from GitHub`);
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
    if (this._logService) this._logService.info('sound-theme', `Removed theme "${dirName}"`);
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
   * Get the sound URL map for a theme (event -> cct-sound:// URL).
   * @param {string} dirName - Theme directory name
   * @returns {object|null} Map of event -> URL, or null if theme not found
   */
  getSoundMap(dirName) {
    const meta = this._readThemeJson(dirName);
    if (!meta) return null;

    const map = {};
    for (const [event, filename] of Object.entries(meta.events)) {
      const filePath = path.join(this._themesDir, dirName, filename);
      if (fs.existsSync(filePath)) {
        map[event] = `cct-sound://${dirName}/${filename}`;
      }
    }
    return map;
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

  /** Remove a temporary directory */
  _cleanup(dir) {
    try {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

module.exports = { SoundThemeService };
