/**
 * Notes IPC handlers
 * Read/write per-project .claudiu/notes.md
 */

const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const CONFIG_DIR = '.claudiu';
const NOTES_FILE = 'notes.md';

function registerNotesIPC() {
  ipcMain.handle('notes-read', async (_event, { projectPath }) => {
    const filePath = path.join(projectPath, CONFIG_DIR, NOTES_FILE);
    try {
      return await fs.promises.readFile(filePath, 'utf-8');
    } catch {
      return '';
    }
  });

  ipcMain.handle('notes-write', async (_event, { projectPath, content }) => {
    const dirPath = path.join(projectPath, CONFIG_DIR);
    await fs.promises.mkdir(dirPath, { recursive: true });
    await fs.promises.writeFile(path.join(dirPath, NOTES_FILE), content, 'utf-8');
  });
}

module.exports = { registerNotesIPC };
