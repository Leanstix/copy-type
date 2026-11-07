# Desktop typing validation — 7 November 2026

Implemented and checked in the user's KDE Wayland environment, with live tests restricted to disposable windows, profiles, fields, and documents.

## Verified behavior

- **Actual desktop app:** opened the new typing panel, selected a browser text area, started a job, switched to another browser tab, and verified exact output in the original target. Prefix/suffix and the selected-range replacement were preserved.
- **Chromium adapter:** preserved braces, newlines, tabs, Unicode, and surrounding text in a background text area; stopped on an external edit without overwriting it. The trusted preload's typing commands and panel controls also passed a live Chromium check.
- **Real VS Code extension host:** inserted exact text into a pinned document while another file was active; verified Unicode, selected-range replacement, LF/CRLF conventions, and preservation of the unrelated document. A manual edit after selection stopped the next task. Both extension-host runs exited successfully; the final run logged `PASS: real VS Code background document edits, exact formatting, LF/CRLF, Unicode, and conflict protection` and exit code 0.
- **Native GTK/AT-SPI:** selected an editable text view and replaced its selection with code, tabs, newlines, and Unicode while a different test window was foreground. The final text matched the explicit expected string.
- **Actual KDE private launcher:** checked the real app process's KWin window properties: `excludeFromCapture`, `skipTaskbar`, `skipSwitcher`, and `skipPager` were all true. The private app started successfully with its required recovery shortcut registered. The disposable instance was closed and its temporary KWin scripts were unloaded.
- **Local connection:** authenticated Unix-socket requests worked; a wrong authentication token was rejected; the connection descriptor was mode 600.

Desktop Node checks: 29 passed, 1 skipped (the existing root-owned sandbox fixture test). The live Electron tests used its configured sandbox. All JavaScript and launcher syntax checks passed. The existing browser-extension tests and syntax checks also passed after exposing its editor adapter API for reuse in the desktop app.

## Installation and usage

The local VS Code extension `copytype-local.copytype-editor` version 0.1.0 was packaged as a VSIX and installed with the user's VS Code CLI. The packaged extension source was compared against the current source and matched. No marketplace publishing occurred.

Restart CopyType using `bash desktop/start-kde-private.sh`. For VS Code, choose a cursor/selection and run **CopyType: Use This Editor**, then choose that document in CopyType's **Type text** panel. **Ctrl+Alt+Space** shows/hides the app; **Ctrl+Alt+Backspace** cancels typing.

## Limits

Desktop-field support depends on the target app exposing an AT-SPI editable text interface. It does not cover every Linux application. Browser IDE support depends on an exposed editor model; cross-origin frames and unsupported custom editors may be rejected. Remote extension hosts on another machine cannot use this computer's local Unix socket.

Document API edits bypass keyboard-triggered indentation and bracket completion without changing global IDE settings. Format-on-save and other extensions may still change text; the job detects mismatches and stops. It never saves or submits the result automatically. Taskbar/switcher hiding does not remove processes from system tools. Capture behavior still depends on the recorder's capture path, as described in the earlier KDE validation record.
