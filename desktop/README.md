# CopyType Mini Browser

A standalone one-window browser workspace alongside the existing Brave extension. Websites are rendered inside this application, **not in a Brave tab**.

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
- Sites use a sandboxed Electron `WebContentsView`; Node integration is disabled and permission requests are denied by default.
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

## Tests

`npm test` for Node unit tests; `npm run check` for JS syntax; `python tests/browser-ui.py` for optional Playwright UI smoke checks.
