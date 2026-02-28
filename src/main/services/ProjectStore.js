/**
 * ProjectStore — manages project list with JSON persistence
 * Stores projects in userData/projects.json
 */

const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');

class ProjectStore {
  constructor() {
    this._filePath = path.join(app.getPath('userData'), 'projects.json');
    this._projects = [];
    this._load();
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this._filePath, 'utf8'));
      this._projects = Array.isArray(data.projects) ? data.projects : [];
    } catch {
      this._projects = [];
    }
  }

  _save() {
    const dir = path.dirname(this._filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this._filePath, JSON.stringify({ projects: this._projects }, null, 2));
  }

  list() {
    return [...this._projects];
  }

  async add() {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Add Project Folder'
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const folderPath = result.filePaths[0];
    return this.addPath(folderPath);
  }

  addPath(folderPath) {
    if (this._projects.some(p => p.path === folderPath)) {
      return this._projects.find(p => p.path === folderPath);
    }
    const project = {
      path: folderPath,
      name: path.basename(folderPath)
    };
    this._projects.push(project);
    this._save();
    return project;
  }

  remove(folderPath) {
    this._projects = this._projects.filter(p => p.path !== folderPath);
    this._save();
  }

  get configPath() {
    return this._filePath;
  }
}

module.exports = { ProjectStore };
