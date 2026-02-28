/**
 * HooksService
 * Manages Claude Code CLI hooks installation in ~/.claude/settings.json
 * Installs a SessionStart hook so Claude Code reports its session_id back to CCT.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

// Identifier used to detect our hooks in the config
const HOOK_IDENTIFIER = 'cct-hook-handler';

// Path to the bundled hook handler script
function getHandlerPath() {
  return path.join(__dirname, '..', 'hooks', 'cct-hook-handler.js');
}

// Only SessionStart — we just need the session_id link
const HOOK_DEFINITIONS = [
  { key: 'SessionStart', hasMatcher: true },
];

/**
 * Read Claude settings.json safely
 */
function readClaudeSettings() {
  try {
    if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to read Claude settings:', e);
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
 */
function buildHookEntry(hookDef) {
  const handlerPath = getHandlerPath().replace(/\\/g, '/');
  const entry = {
    hooks: [
      {
        type: 'command',
        command: `node "${handlerPath}" ${hookDef.key}`
      }
    ]
  };
  if (hookDef.hasMatcher) {
    entry.matcher = '';
  }
  return entry;
}

/**
 * Check if a hook entry is one of ours
 */
function isOurHook(hookEntry) {
  if (!hookEntry || !hookEntry.hooks) return false;
  return hookEntry.hooks.some(h =>
    h.type === 'command' && h.command && h.command.includes(HOOK_IDENTIFIER)
  );
}

/**
 * Install CCT hooks into ~/.claude/settings.json
 * Non-destructive: appends alongside existing user hooks
 */
function installHooks() {
  try {
    const settings = readClaudeSettings();

    if (!settings.hooks) {
      settings.hooks = {};
    }

    for (const hookDef of HOOK_DEFINITIONS) {
      const hookKey = hookDef.key;
      const newEntry = buildHookEntry(hookDef);

      if (!settings.hooks[hookKey]) {
        settings.hooks[hookKey] = [newEntry];
      } else {
        const existing = settings.hooks[hookKey];
        const arr = Array.isArray(existing) ? existing : [existing];

        // Remove any existing hooks of ours (to update path if changed)
        const filtered = arr.filter(entry => !isOurHook(entry));
        filtered.push(newEntry);
        settings.hooks[hookKey] = filtered;
      }
    }

    writeClaudeSettings(settings);
    return { success: true };
  } catch (e) {
    console.error('Failed to install hooks:', e);
    return { success: false, error: e.message };
  }
}

/**
 * Remove CCT hooks from ~/.claude/settings.json
 * Only removes our hooks (detected by HOOK_IDENTIFIER in command string)
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
    console.error('Failed to remove hooks:', e);
    return { success: false, error: e.message };
  }
}

module.exports = { installHooks, removeHooks };
