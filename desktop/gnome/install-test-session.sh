#!/usr/bin/env bash
# Register a separate GDM session using an already tested Mutter runtime.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 022

check_only=false
update=false
if [[ ${1:-} == --check ]]; then
  check_only=true
  shift
elif [[ ${1:-} == --update ]]; then
  update=true
  shift
fi
if [[ "$check_only" == false ]] && (( EUID != 0 )); then
  echo 'Run this installer with sudo or pkexec.' >&2
  exit 1
fi

session=copytypegnometest
runtime=/usr/local/lib/copytype-gnome-test
session_file="/usr/share/gnome-session/sessions/$session.session"
entry="/usr/share/wayland-sessions/$session.desktop"
target_dropin="/etc/systemd/user/gnome-session@$session.target.d/copytype.conf"
shell_dropin="/etc/systemd/user/org.gnome.Shell@$session.service.d/copytype.conf"
libraries=(libmutter-18 libmutter-clutter-18 libmutter-cogl-18 libmutter-mtk-18)
typelibs=(Meta-18 Clutter-18 Cogl-18 Mtk-18)
versions() { dpkg-query -W -f='${Package} ${Version}\n' gnome-shell libmutter-18-0; }

remove_runtime() {
  rm -f -- "$runtime/start-shell" "$runtime/versions" "$runtime/shell-runtime.so"
  for library in "${libraries[@]}"; do rm -f -- "$runtime/$library.so.0" "$runtime/$library.so.0.0.0"; done
  for typelib in "${typelibs[@]}"; do rm -f -- "$runtime/$typelib.typelib"; done
  rmdir -- "$runtime" 2>/dev/null || true
}

if [[ "$check_only" == false && ${1:-} == --remove && $# == 1 ]]; then
  rm -f -- "$entry" "$session_file" "$target_dropin" "$shell_dropin"
  remove_runtime
  rmdir -- "$(dirname "$target_dropin")" "$(dirname "$shell_dropin")" 2>/dev/null || true
  exit
fi

if [[ $# != 1 || ! -d "$1" ]]; then
  echo "Usage: $0 [--check | --update] PREPARED_RUNTIME_DIRECTORY" >&2
  exit 2
fi
prepared=$(realpath -- "$1")
if ! cmp -s "$prepared/versions" <(versions); then
  echo 'The runtime was prepared for a different installed GNOME Shell or Mutter version.' >&2
  exit 1
fi

if [[ "$update" == true ]]; then
  if [[ ! -d "$runtime" || ! -f "$entry" || ! -f "$shell_dropin" || ! -f "$runtime/start-shell" ]]; then
    echo 'Install the test session before updating it.' >&2
    exit 1
  fi
elif [[ "$check_only" == false ]]; then
  for destination in "$runtime" "$session_file" "$entry" "$target_dropin" "$shell_dropin"; do
    if [[ -e "$destination" || -L "$destination" ]]; then
      echo "A test session file already exists at $destination" >&2
      exit 1
    fi
  done
fi

if [[ "$check_only" == true ]]; then
  stage=$(mktemp -d /tmp/copytype-session-check.XXXXXXXX)
else
  stage=$(mktemp -d /usr/local/lib/.copytype-gnome-test.XXXXXXXX)
fi
bundle="$stage/runtime"
mkdir -m 0755 -- "$bundle"
installed=false
published=false
cleanup() {
  if [[ "$check_only" == false && "$update" == false && "$installed" == false ]]; then
    rm -f -- "$entry" "$session_file" "$target_dropin" "$shell_dropin"
    if [[ "$published" == true ]]; then remove_runtime; fi
  fi
  rm -rf -- "$stage"
}
trap cleanup EXIT

install -m 0644 -- "$prepared/versions" "$bundle/versions"
install -m 0644 -- "$prepared/shell-runtime.so" "$bundle/shell-runtime.so"
for i in "${!libraries[@]}"; do
  library=${libraries[i]}
  typelib=${typelibs[i]}
  library_file="$prepared/$library.so.0.0.0"
  dynamic=$(readelf -d "$library_file")
  if [[ "$dynamic" == *'(RPATH)'* || "$dynamic" == *'(RUNPATH)'* ]]; then
    echo "$library_file still contains build-time library paths." >&2
    exit 1
  fi
  install -m 0644 -- "$library_file" "$bundle/$library.so.0.0.0"
  install -m 0644 -- "$prepared/$typelib.typelib" "$bundle/$typelib.typelib"
  ln -s -- "$library.so.0.0.0" "$bundle/$library.so.0"
done

cat > "$bundle/start-shell" <<'EOF'
#!/usr/bin/bash
set -euo pipefail
runtime=/usr/local/lib/copytype-gnome-test
if ! /usr/bin/cmp -s "$runtime/versions" <(/usr/bin/dpkg-query -W -f='${Package} ${Version}\n' gnome-shell libmutter-18-0); then
  echo 'CopyType test session needs a rebuild for the installed GNOME version. Select Ubuntu at sign-in.' >&2
  exit 78
fi
export LD_LIBRARY_PATH="$runtime"
export LD_PRELOAD="$runtime/shell-runtime.so"
export COPYTYPE_MUTTER_EXCLUDED_APP_ID=org.copytype.CopyType
exec /usr/bin/gnome-shell --mode=ubuntu
EOF
chmod 0755 "$bundle/start-shell"

cat > "$stage/session" <<'EOF'
[GNOME Session]
Name=Ubuntu (CopyType Test)
EOF
cat > "$stage/$session.desktop" <<'EOF'
[Desktop Entry]
Name=Ubuntu (CopyType Test)
Comment=Ubuntu GNOME with experimental CopyType monitor capture exclusion
Exec=/usr/bin/gnome-session --session=copytypegnometest
TryExec=/usr/bin/gnome-session
Type=Application
DesktopNames=ubuntu;GNOME;
X-GDM-SessionRegisters=true
EOF
cat > "$stage/target" <<'EOF'
[Unit]
Requires=gnome-session-services.target
Requires=org.gnome.Shell@copytypegnometest.service
EOF
cat > "$stage/shell" <<'EOF'
[Unit]
OnFailure=
OnFailure=gnome-session-shutdown.target

[Service]
ExecStart=
ExecStart=/usr/local/lib/copytype-gnome-test/start-shell
EOF
bash -n "$bundle/start-shell"
# GDM's DesktopNames key also appears in Ubuntu's packaged session entry.
sed '/^DesktopNames=/d' "$stage/$session.desktop" > "$stage/validation.desktop"
desktop-file-validate "$stage/validation.desktop"

if [[ "$check_only" == true ]]; then
  printf 'Session entry, wrapper and runtime files passed the staging checks.\n'
  exit
fi

if [[ "$update" == true ]]; then
  for file in versions "${libraries[@]/%/.so.0.0.0}" "${typelibs[@]/%/.typelib}"; do
    if ! cmp -s "$bundle/$file" "$runtime/$file"; then
      echo "Installed runtime differs from the tested build at $file." >&2
      exit 1
    fi
  done
  for library in "${libraries[@]}"; do
    if [[ ! -L "$runtime/$library.so.0" ]]; then
      ln -s -- "$library.so.0.0.0" "$runtime/$library.so.0"
    elif [[ $(readlink -- "$runtime/$library.so.0") != "$library.so.0.0.0" ]]; then
      echo "Unexpected runtime link at $runtime/$library.so.0." >&2
      exit 1
    fi
  done
  mv -T -- "$bundle/shell-runtime.so" "$runtime/shell-runtime.so"
  mv -T -- "$bundle/start-shell" "$runtime/start-shell"
  printf 'Updated Ubuntu (CopyType Test) launcher.\n'
  exit
fi

install -Dm 0644 -- "$stage/session" "$session_file"
install -Dm 0644 -- "$stage/target" "$target_dropin"
install -Dm 0644 -- "$stage/shell" "$shell_dropin"
mv -T -- "$bundle" "$runtime"
published=true
install -Dm 0644 -- "$stage/$session.desktop" "$entry"
installed=true
printf 'Registered Ubuntu (CopyType Test) at %s\n' "$entry"
