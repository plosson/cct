/**
 * HooksService
 * Manages Claude Code CLI hooks installation in ~/.claude/settings.json
 * Installs command hooks for all 17 Claude Code events via emit.sh,
 * which forwards to Claudiu's local hook server and silently swallows errors.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// In test mode (CLAUDIU_USER_DATA set), write to isolated dir instead of real ~/.claude/settings.json
const CLAUDE_SETTINGS_PATH = process.env.CLAUDIU_USER_DATA
  ? path.join(process.env.CLAUDIU_USER_DATA, 'claude-settings.json')
  : path.join(os.homedir(), '.claude', 'settings.json');

// Path to the installed emit.sh script
const EMIT_SCRIPT_SOURCE = path.join(__dirname, 'emit.sh');
const EMIT_SCRIPT_DEST = process.env.CLAUDIU_USER_DATA
  ? path.join(process.env.CLAUDIU_USER_DATA, 'claudiu-emit.sh')
  : path.join(os.homedir(), '.claude', 'claudiu-emit.sh');

// All Claude Code hook events — all use command hooks via emit.sh
const HOOK_EVENTS = [
  'SessionStart', 'SessionEnd',
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'Notification',
  'SubagentStart', 'SubagentStop',
  'PreCompact', 'ConfigChange',
  'UserPromptSubmit', 'Stop',
  'TeammateIdle', 'TaskCompleted',
  'WorktreeCreate', 'WorktreeRemove',
];

let _logService = null;

function setLogService(logService) {
  _logService = logService;
}

/**
 * Read Claude settings.json safely
 */
function readClaudeSettings() {
  try {
    if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8'));
    }
  } catch (e) {
    if (_logService) _logService.warn('hooks', 'Failed to read Claude settings: ' + e.message);
  }
  return {};
}

/**
 * Write Claude settings.json
 */
function writeClaudeSettings(settings) {
  const dir = path.dirname(CLAUDE_SETTINGS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

/**
 * Install the emit.sh script to ~/.claude/claudiu-emit.sh
 * Copies from source and ensures it's executable.
 */
function installEmitScript() {
  const dir = path.dirname(EMIT_SCRIPT_DEST);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.copyFileSync(EMIT_SCRIPT_SOURCE, EMIT_SCRIPT_DEST);
  fs.chmodSync(EMIT_SCRIPT_DEST, 0o755);
}

/**
 * Remove the emit.sh script from ~/.claude/
 */
function removeEmitScript() {
  try {
    if (fs.existsSync(EMIT_SCRIPT_DEST)) {
      fs.unlinkSync(EMIT_SCRIPT_DEST);
    }
  } catch {
    // best-effort cleanup
  }
}

/**
 * Build a command hook entry that forwards stdin via emit.sh
 * @param {number} port — hook server port
 */
function buildCommandHookEntry(port) {
  return {
    hooks: [
      {
        type: 'command',
        command: `${EMIT_SCRIPT_DEST} ${port}`,
      }
    ],
    allowedEnvVars: ['CLAUDIU_SESSION_ID'],
  };
}

/**
 * Normalize a hook value to an array (Claude settings may store a single object or an array)
 */
function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Check if a hook entry is one of ours.
 * Detects command hooks by claudiu-emit.sh, and legacy HTTP hooks by X-Claudiu-Hook/X-CCT-Hook headers.
 */
function isOurHook(hookEntry) {
  if (!hookEntry || !hookEntry.hooks) return false;
  return hookEntry.hooks.some(h =>
    (h.type === 'command' && h.command && (h.command.includes('claudiu-emit.sh') || h.command.includes('X-Claudiu-Hook') || h.command.includes('X-CCT-Hook'))) ||
    (h.type === 'http' && h.headers && (h.headers['X-Claudiu-Hook'] === 'true' || h.headers['X-CCT-Hook'] === 'true'))
  );
}

/**
 * Install Claudiu hooks into ~/.claude/settings.json
 * Non-destructive: appends alongside existing user hooks.
 * Also installs emit.sh to ~/.claude/claudiu-emit.sh.
 * @param {number} port — hook server port
 */
function installHooks(port) {
  try {
    // Remove stale hooks first (e.g. from a previous crash where before-quit didn't fire)
    removeHooks();

    // Install the emit.sh script
    installEmitScript();

    const settings = readClaudeSettings();

    if (!settings.hooks) {
      settings.hooks = {};
    }

    for (const event of HOOK_EVENTS) {
      const newEntry = buildCommandHookEntry(port);
      // Keep existing non-Claudiu hooks, replace any previous Claudiu hook (port may have changed)
      const filtered = asArray(settings.hooks[event]).filter(entry => !isOurHook(entry));
      filtered.push(newEntry);
      settings.hooks[event] = filtered;
    }

    writeClaudeSettings(settings);
    if (_logService) _logService.info('hooks', `Installed ${HOOK_EVENTS.length} command hooks on port ${port}`);
    return { success: true };
  } catch (e) {
    if (_logService) _logService.error('hooks', 'Failed to install hooks: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Remove Claudiu hooks from ~/.claude/settings.json
 * Removes our hooks (detected by claudiu-emit.sh or legacy X-Claudiu-Hook markers)
 * and cleans up the emit.sh script.
 */
function removeHooks() {
  try {
    const settings = readClaudeSettings();

    if (!settings.hooks) {
      removeEmitScript();
      return { success: true };
    }

    for (const event of HOOK_EVENTS) {
      const filtered = asArray(settings.hooks[event]).filter(entry => !isOurHook(entry));
      if (filtered.length === 0) {
        delete settings.hooks[event];
      } else {
        settings.hooks[event] = filtered;
      }
    }

    // Remove empty hooks object
    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }

    writeClaudeSettings(settings);
    removeEmitScript();
    return { success: true };
  } catch (e) {
    if (_logService) _logService.error('hooks', 'Failed to remove hooks: ' + e.message);
    return { success: false, error: e.message };
  }
}

module.exports = { installHooks, removeHooks, setLogService, HOOK_EVENTS };
