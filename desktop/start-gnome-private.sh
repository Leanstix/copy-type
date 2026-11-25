#!/usr/bin/env bash
# Launch against a Mutter session that advertises CopyType monitor exclusion.
set -euo pipefail
unset ELECTRON_RUN_AS_NODE
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if [[ "${XDG_SESSION_TYPE:-}" != wayland || ":${XDG_CURRENT_DESKTOP:-}:" != *:GNOME:* ]]; then
  echo 'CopyType monitor exclusion requires the patched GNOME Wayland session.' >&2
  exit 1
fi

filter=$(gdbus call --session --timeout 3 --dest org.gnome.Mutter.ScreenCast \
  --object-path /org/gnome/Mutter/ScreenCast \
  --method org.freedesktop.DBus.Properties.Get org.gnome.Mutter.ScreenCast ExcludedAppId 2>/dev/null) || filter=''
if [[ "$filter" != "(<'org.copytype.CopyType'>,)" ]]; then
  echo 'This GNOME session does not advertise CopyType monitor exclusion. See desktop/gnome/README.md.' >&2
  exit 1
fi

export COPYTYPE_GNOME_MONITOR_EXCLUSION=1
exec bash ./start-linux.sh --ozone-platform=wayland "$@"
