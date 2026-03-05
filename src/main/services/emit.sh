#!/usr/bin/env bash
# Claudiu hook emitter — forwards Claude Code hook events to Claudiu's local HTTP server.
# Called as a command hook: reads JSON from stdin, POSTs to the hook server, swallows all errors.
# Usage: emit.sh <port>

PORT="$1"
if [ -z "$PORT" ]; then
  exit 0
fi

# Read stdin (hook JSON payload)
PAYLOAD="$(cat)"

# POST to Claudiu's hook server — silently ignore connection failures
curl -s -o /dev/null \
  -X POST "http://localhost:${PORT}/hooks" \
  -H 'Content-Type: application/json' \
  -H 'X-Claudiu-Hook: true' \
  -H "X-Claudiu-Session-Id: ${CLAUDIU_SESSION_ID}" \
  -d "$PAYLOAD" \
  --connect-timeout 2 \
  2>/dev/null || true

exit 0
