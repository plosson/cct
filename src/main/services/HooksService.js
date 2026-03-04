/**
 * HooksService
 * Manages Claude Code CLI hooks installation in ~/.claude/settings.json
 * Installs HTTP hooks for all 17 Claude Code events, pointing to Claudiu's local hook server.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// In test mode (CLAUDIU_USER_DATA set), write to isolated dir instead of real ~/.claude/settings.json
const CLAUDE_SETTINGS_PATH = process.env.CLAUDIU_USER_DATA
  ? path.join(process.env.CLAUDIU_USER_DATA, 'claude-settings.json')
  : path.join(os.homedir(), '.claude', 'settings.json');

// Claude Code hook events — HTTP hooks work for all except SessionStart
const HTTP_HOOK_EVENTS = [
  'SessionEnd',
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'Notification',
  'SubagentStart', 'SubagentStop',
  'PreCompact', 'ConfigChange',
  'UserPromptSubmit', 'Stop',
  'TeammateIdle', 'TaskCompleted',
  'WorktreeCreate', 'WorktreeRemove',
];

// SessionStart requires a command hook (Claude Code skips HTTP hooks for it)
const COMMAND_HOOK_EVENTS = ['SessionStart'];

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
 * Build an HTTP hook entry
 * @param {number} port — hook server port
 */
function buildHttpHookEntry(port) {
  return {
    hooks: [
      {
        type: 'http',
        url: `http://localhost:${port}/hooks`,
        headers: {
          'X-Claudiu-Hook': 'true',
        },
      }
    ],
  };
}

/**
 * Build a command hook entry that forwards stdin to the HTTP server.
 * Used for events where Claude Code doesn't support HTTP hooks (e.g. SessionStart).
 * @param {number} port — hook server port
 */
function buildCommandHookEntry(port) {
  return {
    hooks: [
      {
        type: 'command',
        command: `curl -s -X POST http://localhost:${port}/hooks -H 'Content-Type: application/json' -H 'X-Claudiu-Hook: true' -H "X-Claudiu-Session-Id: $CLAUDIU_SESSION_ID" -d @-`,
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
 * Detects HTTP hooks by X-Claudiu-Hook header, command hooks by the curl + X-Claudiu-Hook pattern.
 */
function isOurHook(hookEntry) {
  if (!hookEntry || !hookEntry.hooks) return false;
  return hookEntry.hooks.some(h =>
    (h.type === 'http' && h.headers && h.headers['X-Claudiu-Hook'] === 'true') ||
    (h.type === 'command' && h.command && h.command.includes('X-Claudiu-Hook'))
  );
}

/**
 * Install Claudiu hooks into ~/.claude/settings.json
 * Non-destructive: appends alongside existing user hooks
 * @param {number} port — hook server port
 */
function installHooks(port) {
  try {
    const settings = readClaudeSettings();

    if (!settings.hooks) {
      settings.hooks = {};
    }

    const allEvents = [...HTTP_HOOK_EVENTS, ...COMMAND_HOOK_EVENTS];
    for (const event of allEvents) {
      const newEntry = COMMAND_HOOK_EVENTS.includes(event)
        ? buildCommandHookEntry(port)
        : buildHttpHookEntry(port);
      // Keep existing non-Claudiu hooks, replace any previous Claudiu hook (port may have changed)
      const filtered = asArray(settings.hooks[event]).filter(entry => !isOurHook(entry));
      filtered.push(newEntry);
      settings.hooks[event] = filtered;
    }

    writeClaudeSettings(settings);
    if (_logService) _logService.info('hooks', `Installed ${allEvents.length} hooks on port ${port}`);
    return { success: true };
  } catch (e) {
    if (_logService) _logService.error('hooks', 'Failed to install hooks: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Remove Claudiu hooks from ~/.claude/settings.json
 * Only removes our hooks (detected by X-Claudiu-Hook header)
 */
function removeHooks() {
  try {
    const settings = readClaudeSettings();

    if (!settings.hooks) {
      return { success: true };
    }

    const allEvents = [...HTTP_HOOK_EVENTS, ...COMMAND_HOOK_EVENTS];
    for (const event of allEvents) {
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
    return { success: true };
  } catch (e) {
    if (_logService) _logService.error('hooks', 'Failed to remove hooks: ' + e.message);
    return { success: false, error: e.message };
  }
}

module.exports = { installHooks, removeHooks, setLogService, HTTP_HOOK_EVENTS, COMMAND_HOOK_EVENTS };
