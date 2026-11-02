#!/usr/bin/env bash
# Launch the standalone browser with Chromium's Linux sandbox enabled.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if ! command -v npm >/dev/null 2>&1; then
  echo 'Node.js 20+ and npm are required.' >&2
  exit 1
fi

if [[ ! -x node_modules/.bin/electron ]]; then
  npm install --no-audit --no-fund
fi

helper='node_modules/electron/dist/chrome-sandbox'
if [[ -L "$helper" || ! -f "$helper" || ! -x "$helper" ]]; then
  echo "Electron sandbox helper is missing, not executable, or is a symlink: $helper" >&2
  echo 'Try reinstalling Electron using: cd desktop && npm install' >&2
  exit 1
fi

sandbox_is_configured() {
  [[ "$(stat -c '%u:%g:%a' -- "$helper")" == '0:0:4755' ]]
}

if ! sandbox_is_configured; then
  echo 'Electron needs a root-owned sandbox helper (mode 4755) on this Linux system.' >&2
  echo 'CopyType will not disable the Chromium sandbox.' >&2
  echo 'The one-time setup changes ONLY node_modules/electron/dist/chrome-sandbox.' >&2
  if [[ ! -t 0 ]]; then
    echo 'Run this launcher in an interactive terminal to approve the one-time sudo setup.' >&2
    echo 'Or, from the desktop directory, run:' >&2
    echo "  sudo chown root:root '$helper' && sudo chmod 4755 '$helper'" >&2
    exit 1
  fi

  read -r -p 'Configure Electron sandbox with sudo? [y/N] ' reply || reply=''
  case "$reply" in
    y|Y|yes|YES)
      sudo chown root:root -- "$helper"
      sudo chmod 4755 -- "$helper"
      ;;
    *)
      echo 'Sandbox setup cancelled. The browser was not launched.' >&2
      exit 1
      ;;
  esac
  if ! sandbox_is_configured; then
    echo 'Sandbox setup did not yield root:root and mode 4755. Aborting.' >&2
    exit 1
  fi
fi

exec npm start
