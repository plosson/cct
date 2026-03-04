/**
 * HooksService
 * Manages Claude Code CLI hooks installation in ~/.claude/settings.json
 * Installs HTTP hooks for all 17 Claude Code events, pointing to CCT's local hook server.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// In test mode (CCT_USER_DATA set), write to isolated dir instead of real ~/.claude/settings.json
const CLAUDE_SETTINGS_PATH = process.env.CCT_USER_DATA
  ? path.join(process.env.CCT_USER_DATA, 'claude-settings.json')
  : path.join(os.homedir(), '.claude', 'settings.json');

// All 17 Claude Code hook events
const HOOK_DEFINITIONS = [
  // Events with matcher support
  { key: 'SessionStart', hasMatcher: true },
  { key: 'SessionEnd', hasMatcher: true },
  { key: 'PreToolUse', hasMatcher: true },
  { key: 'PostToolUse', hasMatcher: true },
  { key: 'PostToolUseFailure', hasMatcher: true },
  { key: 'PermissionRequest', hasMatcher: true },
  { key: 'Notification', hasMatcher: true },
  { key: 'SubagentStart', hasMatcher: true },
  { key: 'SubagentStop', hasMatcher: true },
  { key: 'PreCompact', hasMatcher: true },
  { key: 'ConfigChange', hasMatcher: true },
  // Events without matcher support
  { key: 'UserPromptSubmit', hasMatcher: false },
  { key: 'Stop', hasMatcher: false },
  { key: 'TeammateIdle', hasMatcher: false },
  { key: 'TaskCompleted', hasMatcher: false },
  { key: 'WorktreeCreate', hasMatcher: false },
  { key: 'WorktreeRemove', hasMatcher: false },
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
 * Build a hook entry for a given hook definition
 * @param {object} hookDef
 * @param {number} port — hook server port
 */
function buildHookEntry(hookDef, port) {
  const entry = {
    hooks: [
      {
        type: 'http',
        url: `http://localhost:${port}/hooks`,
        headers: {
          'X-CCT-Hook': 'true',
          'X-CCT-Session-Id': '$CCT_SESSION_ID',
          'X-CCT-Project-Id': '$CCT_PROJECT_ID',
        },
      }
    ],
    allowedEnvVars: ['CCT_SESSION_ID', 'CCT_PROJECT_ID'],
  };
  if (hookDef.hasMatcher) {
    entry.matcher = '';
  }
  return entry;
}

/**
 * Check if a hook entry is one of ours (detected by X-CCT-Hook header)
 */
function isOurHook(hookEntry) {
  if (!hookEntry || !hookEntry.hooks) return false;
  return hookEntry.hooks.some(h =>
    h.type === 'http' && h.headers && h.headers['X-CCT-Hook'] === 'true'
  );
}

/**
 * Install CCT hooks into ~/.claude/settings.json
 * Non-destructive: appends alongside existing user hooks
 * @param {number} port — hook server port
 */
function installHooks(port) {
  try {
    const settings = readClaudeSettings();

    if (!settings.hooks) {
      settings.hooks = {};
    }

    for (const hookDef of HOOK_DEFINITIONS) {
      const hookKey = hookDef.key;
      const newEntry = buildHookEntry(hookDef, port);

      if (!settings.hooks[hookKey]) {
        settings.hooks[hookKey] = [newEntry];
      } else {
        const existing = settings.hooks[hookKey];
        const arr = Array.isArray(existing) ? existing : [existing];

        // Remove any existing hooks of ours (to update port if changed)
        const filtered = arr.filter(entry => !isOurHook(entry));
        filtered.push(newEntry);
        settings.hooks[hookKey] = filtered;
      }
    }

    writeClaudeSettings(settings);
    if (_logService) _logService.info('hooks', `Installed ${HOOK_DEFINITIONS.length} HTTP hooks on port ${port}`);
    return { success: true };
  } catch (e) {
    if (_logService) _logService.error('hooks', 'Failed to install hooks: ' + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Remove CCT hooks from ~/.claude/settings.json
 * Only removes our hooks (detected by X-CCT-Hook header)
 */
function removeHooks() {
  try {
    const settings = readClaudeSettings();

    if (!settings.hooks) {
      return { success: true };
    }

    for (const hookDef of HOOK_DEFINITIONS) {
      const hookKey = hookDef.key;
      if (!settings.hooks[hookKey]) continue;

      const existing = settings.hooks[hookKey];
      const arr = Array.isArray(existing) ? existing : [existing];

      const filtered = arr.filter(entry => !isOurHook(entry));

      if (filtered.length === 0) {
        delete settings.hooks[hookKey];
      } else {
        settings.hooks[hookKey] = filtered;
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

module.exports = { installHooks, removeHooks, setLogService, HOOK_DEFINITIONS };
