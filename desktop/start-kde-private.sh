#!/usr/bin/env bash
# Exclude this instance's native windows from KDE's supported screencasts.
set -euo pipefail
unset ELECTRON_RUN_AS_NODE
export COPYTYPE_PRIVATE=1
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if [[ "${XDG_SESSION_TYPE:-}" != wayland || ":${XDG_CURRENT_DESKTOP:-}:" != *:KDE:* ]]; then
  echo 'This launcher requires a KDE Plasma Wayland session (6.6 or newer).' >&2
  echo 'Log into Plasma (Wayland), then run this launcher again.' >&2
  echo 'A nested KDE window cannot exclude content from GNOME whole-screen capture.' >&2
  exit 1
fi
if ! command -v qdbus6 >/dev/null 2>&1; then
  echo 'Install qdbus-qt6 first.' >&2
  exit 1
fi
if [[ ! -x node_modules/electron/dist/electron ]]; then
  echo 'Install desktop dependencies first: cd desktop && npm install' >&2
  exit 1
fi
if [[ "$(stat -c '%u:%g:%a' node_modules/electron/dist/chrome-sandbox)" != '0:0:4755' ]]; then
  echo 'Configure the Electron sandbox first using desktop/start-linux.sh.' >&2
  exit 1
fi
qdbus6 org.kde.KWin /Scripting org.freedesktop.DBus.Introspectable.Introspect >/dev/null

probe_dir=$(mktemp -d "${TMPDIR:-/tmp}/copytype-kde.XXXXXXXX")
script_name="copytype-private-$$"
app_pid=''
script_loaded=false
cleanup() {
  if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then
    kill "$app_pid" 2>/dev/null || true
  fi
  if [[ "$script_loaded" == true ]]; then
    qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript "$script_name" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$probe_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkfifo "$probe_dir/start"

# Keep the PID stable through exec, and install the window rule before Electron
# can create its first window. Each launch only matches its own process.
bash -c 'gate=$1; shift; read -r < "$gate"; exec ./node_modules/electron/dist/electron . --ozone-platform=wayland "$@"' _ "$probe_dir/start" "$@" &
app_pid=$!
sed "s/__COPYTYPE_PID__/$app_pid/g" kde-exclude.js > "$probe_dir/exclude.js"
script_id=$(qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.loadScript "$probe_dir/exclude.js" "$script_name")
if [[ ! "$script_id" =~ ^[0-9]+$ ]]; then
  echo 'KWin could not load the CopyType capture-exclusion rule.' >&2
  exit 1
fi
script_loaded=true
qdbus6 org.kde.KWin "/Scripting/Script$script_id" org.kde.kwin.Script.run
echo 'KDE capture exclusion rule installed for this CopyType instance.'
echo 'Verify your recorder preview. Direct GPU/KMS capture can still include this window.'
printf 'start\n' > "$probe_dir/start"
wait "$app_pid"
app_pid=''
