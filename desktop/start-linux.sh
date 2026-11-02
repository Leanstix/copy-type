#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v npm >/dev/null 2>&1; then
 echo "Node.js 20+ and npm are required." >&2
 exit 1
fi
if [ ! -x node_modules/.bin/electron ]; then
 npm install --no-audit --no-fund
fi
exec npm start
