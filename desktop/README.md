# CopyType Mini Browser

A standalone one-window browser workspace alongside the existing Brave extension. Websites are rendered inside this application, **not in a Brave tab**.

## Type into VS Code, browser editors, and desktop fields

Open **Type text** in the browser toolbar. Choose a destination, paste the source, choose a pace, and press **Start typing**. The selected document or field stays pinned when you change windows or browser tabs. Pause, resume, and cancel are available in the panel. Cancel preserves text already entered. Paste another sample after completion to continue at the inserted text's end.

For **VS Code**, install the bundled [editor connection](vscode/README.md), then choose **VS Code** in the panel. Open text tabs appear automatically, including inactive and untitled tabs. A single connected window is selected for you; with several windows, select the workspace/window first. Choose the destination tab and start at its current cursor or selection—no VS Code command is needed. The selected document remains the destination when you switch files. LF/CRLF follows the document's line-ending convention.

Use **Create a file or tab** to create a named file inside the selected workspace folder, or open a new untitled tab. It opens automatically in VS Code and is selected as the typing destination. Existing files are not overwritten. In multi-folder workspaces, choose the folder. Creating a named file writes an empty file; text entered afterwards is not automatically saved or submitted. With no folder open, use an untitled tab.

For the **mini browser**, open the target page, click **Select browser editor**, and click the destination field. Supported destinations include text inputs, text areas, and exposed Ace, CodeMirror, and Monaco editor models. Cross-origin iframe editors and editors with no accessible model are not guaranteed. Password fields are excluded. The desktop app rejects an unsupported exact editor instead of claiming that synthetic keystrokes preserve formatting.

For **other desktop applications**, click **Desktop fields** and choose the application/window/field from the list. This uses Linux's AT-SPI editable-text interface; applications that do not expose an editable field require a dedicated integration. This is not universal input injection into every window. Install `python3-gi` and `gir1.2-atspi-2.0` if accessibility support is missing. Browser accessibility settings and individual toolkit versions affect which fields are available.

All three paths edit a pinned destination directly. They avoid keyboard-triggered bracket pairing and indentation without changing your IDE's global settings. Other plugins, manual edits, or format-on-save can still change a document: CopyType checks its expected text and stops on a mismatch, keeping those changes rather than overwriting the document to repair it. Destination text is verified at completion; check the final result before using it.

Source text is held in memory. The VS Code connection uses a user-owned Unix socket and a mode-600 authentication descriptor, with no network listener. Desktop discovery lists accessible application/field labels; only a selected field's text is read locally to preserve the surrounding contents and verify edits.

## Linux launch

Install Node.js 20+ and npm, then run from the repository root:

```bash
bash desktop/start-linux.sh
```

Or run `cd desktop && npm install && npm start` manually. The first installation downloads Electron, so internet is required. A lightweight interface does not make Electron a tiny binary: Chromium can use significant memory on demanding sites.

### Linux sandbox setup

The launcher detects a missing or misconfigured Electron `chrome-sandbox` helper and asks for a one-time sudo approval in an interactive terminal. It changes **only** `desktop/node_modules/electron/dist/chrome-sandbox` to root ownership and mode `4755`, and keeps Chromium sandboxing enabled.

If you prefer to do it manually, run from the `desktop` directory:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
npm start
```

Only approve this after installing Electron from a source you trust. Reinstalling Electron may reset these permissions. On a `nosuid` filesystem or a Linux system with additional security restrictions, mode changes might not be sufficient. **Do not use `--no-sandbox` for a browser displaying external websites.**

## Browser features

- An address bar, Google search, back/forward/reload and up to six internal tabs.
- One-click ChatGPT, Google, GitHub, and MDN shortcuts.
- Sites use a sandboxed Electron `WebContentsView`; Node integration is disabled. The focused active website may write to the clipboard so its copy buttons work; clipboard reads and other permission requests remain denied. Clicking the embedded page restores its input focus.
- Cookies, history and authenticated sessions persist in **this application's own local browser profile** (`persist:copytype-mini-browser`). No Brave cookie extraction or password copying.
- Popup links attempt to open as another internal tab; some OAuth flows require real browser popup windows and may not work.

## Limitations and privacy

Google OAuth and some other providers reject embedded Chromium authentication (`disallowed_useragent`). ChatGPT sign-in compatibility must be tested on your device; it cannot be guaranteed.

By default, the application is an ordinary visible desktop window and appears in whole-screen recording or sharing. KDE Plasma Wayland offers an optional capture-exclusion path, described below. Inspect your recorder's live preview before relying on it.

There are no analytics, remote backends, or auto-read clipboard operations. Websites still receive the ordinary browser requests you send. The original CopyType typing extension remains in the project root.

## KDE Plasma capture exclusion

On KDE Plasma **6.6 or newer**, in a **Wayland session**, launch with:

```bash
bash desktop/start-kde-private.sh
```

Install desktop dependencies and configure the Electron sandbox using the normal launcher first. This optional launcher installs a temporary KWin script before starting Electron. The script marks this process's native windows with `excludeFromCapture`; it is unloaded when the application closes. It does not change other applications' capture settings.

On this machine, Plasma 6.6.6 was installed alongside GNOME. Save your work, log out, select your account, use the login screen's session selector to choose **Plasma (Wayland)**, and sign in. GNOME remains available as **Ubuntu**. Changing sessions requires logging out; the installer does not switch your current session.

The nested-KWin tests showed both a synthetic private window and the actual CopyType Mini Browser locally while the PipeWire screencast showed the desktop underneath, without a black rectangle. The new launcher's automatic exclusion also passed. See the [validation record and captured frames](validation/kde-2026-11-07/README.md). This applies to KWin's supported capture path. It does **not** protect an app inside a nested KDE window from the outer GNOME session's whole-screen capture. Direct GPU/KMS capture and other capture paths can still include the app. Plasma 6.6 screenshot behavior is separate from its screencast behavior. The browser extension's in-page widget is part of the browser window and is not independently excluded by this launcher.

The browser's typed output remains part of the destination page and can appear in recordings of that page.

The private launcher also excludes its native window from the taskbar, Alt+Tab switcher, and pager. Press **Ctrl+Alt+Space** to show or hide CopyType, and **Ctrl+Alt+Backspace** to cancel typing from another application. These private-mode bindings use KWin's native global shortcut service through a local Python/GI D-Bus connection, rather than Electron's shortcut registration. Startup verifies that KDE assigned both advertised key combinations before opening the private window. Shortcuts are registered after the single-instance lock is acquired and are removed when the app exits. Restoring also unminimizes the window. If another application owns either combination, startup explains which binding needs attention in KDE's shortcut settings.

If CopyType is hidden and you need a recovery option, run the same launcher again: the existing instance is shown and focused. These desktop presentation settings do not remove the running process from system tools or guarantee exclusion from every overview/thumbnail/capture path.

## Tests

`npm test` for Node unit tests; `npm run check` for JS syntax; `npm run check:linux` for launcher syntax. The Unix-socket test requires permission to bind a local socket.

Optional live checks use disposable profiles and fixtures:

- Run `tests/electron-typing.cjs` or `tests/main-integration.cjs` with the installed Electron executable, with `ELECTRON_RUN_AS_NODE` unset and a separate `--user-data-dir`.
- Run `/usr/bin/python3 tests/accessibility-integration.py` for a native GTK background-field check.
- Run `/usr/bin/python3 tests/kde-window-integration.py` in a KDE Wayland session to inspect a disposable private instance's window properties.
- Load `vscode/integration.cjs` with VS Code's `--extensionTestsPath` and `vscode/` as `--extensionDevelopmentPath`, using a separate user profile, extension directory, and `COPYTYPE_RUNTIME_DIR`.
