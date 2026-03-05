/**
 * Terminal IPC handlers
 * Bridges renderer ↔ TerminalService via Electron IPC
 * Orchestrates session tracking: generates IDs, sets env vars, records sessions.
 */

const { ipcMain, app } = require('electron');
const crypto = require('crypto');

// Allowed command basenames the renderer may request.
// Anything not in this set is rejected to prevent arbitrary command injection.
const ALLOWED_COMMANDS = new Set(['claude', 'bash', 'zsh', 'sh', 'fish']);

/**
 * Register all terminal-related IPC handlers
 * @param {import('../services/TerminalService').TerminalService} terminalService
 * @param {import('../services/ProjectConfigService').ProjectConfigService} projectConfigService
 * @param {import('../services/ConfigService').ConfigService} [configService]
 */
function registerTerminalIPC(terminalService, projectConfigService, configService) {
  // Map<terminalId, { projectPath, sessionId }> for cleanup on kill/exit
  const sessionMap = new Map();

  // During shutdown, PTYs are killed but we want sessions to persist for restore
  let shuttingDown = false;
  app.on('before-quit', () => { shuttingDown = true; });

  // Request/response — renderer needs the terminal ID back
  ipcMain.handle('terminal-create', (_event, params = {}) => {
    const { cwd, type, claudeSessionId: resumeId } = params;
    let projectId;
    const sessionId = crypto.randomUUID();

    const isClaude = type === 'claude';

    // Resolve command from config hierarchy (project → global → default)
    // CLAUDIU_COMMAND env var overrides in test mode only (when CLAUDIU_USER_DATA is set)
    let command = params.command || (process.env.CLAUDIU_USER_DATA && process.env.CLAUDIU_COMMAND);
    if (!command && configService) {
      const key = isClaude ? 'claudeCommand' : 'terminalCommand';
      command = configService.resolve(key, cwd) || undefined;
    }

    // Split command string into binary + extra args (e.g. "claude --dangerously-skip-permissions")
    let commandArgs = [];
    if (command) {
      const parts = command.split(/\s+/).filter(Boolean);
      command = parts[0];
      commandArgs = parts.slice(1);
    }

    // Security: only allow known command basenames to prevent arbitrary execution
    if (command) {
      const basename = require('path').basename(command);
      if (!ALLOWED_COMMANDS.has(basename)) {
        return { success: false, error: `Command not allowed: ${basename}` };
      }
    }

    // Build extra env vars
    const env = {};
    if (cwd && projectConfigService) {
      projectId = projectConfigService.getProjectId(cwd);
      env.CLAUDIU_PROJECT_ID = projectId;
    }
    env.CLAUDIU_SESSION_ID = sessionId;

    let args = params.args || [];
    if (isClaude && resumeId) {
      args = ['--resume', resumeId, ...args];
    }

    const onExit = ({ id }) => {
      const entry = sessionMap.get(id);
      if (!shuttingDown && entry && projectConfigService) {
        projectConfigService.removeSession(entry.projectPath, id);
      }
      sessionMap.delete(id);
    };

    const result = terminalService.create({ ...params, command, args: [...commandArgs, ...args], env, onExit });

    // If PTY spawn failed, return the error without recording a session
    if (!result.success) {
      return result;
    }

    // Record session in .claudiu/sessions.json
    if (cwd && projectConfigService) {
      projectConfigService.recordSession(cwd, sessionId, result.id, type, resumeId);
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
