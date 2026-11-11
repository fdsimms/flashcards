#!/bin/bash
# Installs dependencies so tests and the typechecker work in Claude Code on the web, then warms
# the caches the verification loop uses. node_modules isn't checked in, so a fresh cloud
# container has none and `npm run verify` fails before it starts.
set -euo pipefail

echo '{"async": true, "asyncTimeout": 300000}'

# Local machines already have a working checkout; only the web sandbox needs this.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# npm install (not ci) so a cached container reuses the existing node_modules.
npm install --no-audit --no-fund

# Warm tsc's incremental cache and vitest's transform. Neither may fail the hook: a red tree is
# the session's problem to look at, not a reason to have no dependencies installed.
npx tsc --noEmit >/dev/null 2>&1 || true
npx vitest run >/dev/null 2>&1 || true
