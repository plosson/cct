/**
 * Terminal IPC handlers
 * Bridges renderer ↔ TerminalService via Electron IPC
 * Orchestrates session tracking: generates IDs, sets env vars, records sessions.
 */

const { ipcMain, app } = require('electron');
const crypto = require('crypto');

/**
 * Register all terminal-related IPC handlers
 * @param {import('../services/TerminalService').TerminalService} terminalService
 * @param {import('../services/ProjectConfigService').ProjectConfigService} projectConfigService
 */
function registerTerminalIPC(terminalService, projectConfigService) {
  // Map<terminalId, { projectPath, sessionId }> for cleanup on kill/exit
  const sessionMap = new Map();

  // During shutdown, PTYs are killed but we want sessions to persist for restore
  let shuttingDown = false;
  app.on('before-quit', () => { shuttingDown = true; });

  // Request/response — renderer needs the terminal ID back
  ipcMain.handle('terminal-create', (_event, params = {}) => {
    const { cwd, type } = params;
    let projectId;
    const sessionId = crypto.randomUUID();

    // Build extra env vars
    const env = {};
    if (cwd && projectConfigService) {
      projectId = projectConfigService.getProjectId(cwd);
      env.CCT_PROJECT_ID = projectId;
    }
    env.CCT_SESSION_ID = sessionId;

    const onExit = ({ id }) => {
      const entry = sessionMap.get(id);
      if (!shuttingDown && entry && projectConfigService) {
        projectConfigService.removeSession(entry.projectPath, id);
      }
      sessionMap.delete(id);
    };

    const result = terminalService.create({ ...params, env, onExit });

    // Record session in .cct/sessions.json
    if (cwd && projectConfigService) {
      projectConfigService.recordSession(cwd, sessionId, result.id, type);
      sessionMap.set(result.id, { projectPath: cwd, sessionId });
    }

    return { ...result, sessionId };
  });

  // Fire-and-forget — high-frequency input, no response needed
  ipcMain.on('terminal-input', (_event, { id, data }) => {
    terminalService.write(id, data);
  });

  ipcMain.on('terminal-resize', (_event, { id, cols, rows }) => {
    terminalService.resize(id, cols, rows);
  });

  ipcMain.on('terminal-kill', (_event, { id }) => {
    // Clean up session tracking before killing
    const entry = sessionMap.get(id);
    if (entry && projectConfigService) {
      projectConfigService.removeSession(entry.projectPath, id);
    }
    sessionMap.delete(id);

    terminalService.kill(id);
  });

  // Request/response — used by tests to check for orphan PTYs
  ipcMain.handle('terminal-count', () => {
    return terminalService.count();
  });
}

module.exports = { registerTerminalIPC };
