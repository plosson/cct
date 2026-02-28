#!/usr/bin/env node
/**
 * cct-hook-handler.js
 * Standalone script invoked by Claude Code SessionStart hook.
 * Reads session_id from stdin JSON, writes it as claudeSessionId
 * into the matching session entry in .cct/sessions.json.
 *
 * Usage (by Claude Code):
 *   echo '{"session_id":"..."}' | node cct-hook-handler.js SessionStart
 */

const fs = require('fs');
const path = require('path');

const CCT_SESSION_ID = process.env.CCT_SESSION_ID;
const CCT_PROJECT_ID = process.env.CCT_PROJECT_ID;

// Not a CCT-spawned session — exit silently
if (!CCT_SESSION_ID || !CCT_PROJECT_ID) {
  process.exit(0);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const sessionId = data.session_id;
    if (!sessionId) process.exit(0);

    // Derive sessions.json path from cwd (where Claude Code is running)
    const cwd = data.cwd || process.cwd();
    const sessionsPath = path.join(cwd, '.cct', 'sessions.json');

    if (!fs.existsSync(sessionsPath)) process.exit(0);

    const config = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
    if (!Array.isArray(config.sessions)) process.exit(0);

    const entry = config.sessions.find(s => s.id === CCT_SESSION_ID);
    if (!entry) process.exit(0);

    entry.claudeSessionId = sessionId;
    fs.writeFileSync(sessionsPath, JSON.stringify(config, null, 2));
  } catch {
    // Fail silently — don't break Claude Code
    process.exit(0);
  }
});
