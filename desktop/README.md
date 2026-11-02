# CopyType Mini Browser

A standalone one-window browser workspace alongside the existing Brave extension. Websites are rendered inside this application, **not in a Brave tab**.

## Linux launch

Install Node.js 20+ and npm, then run from the repository root:

```bash
bash desktop/start-linux.sh
```

Or run `cd desktop && npm install && npm start` manually. The first installation downloads Electron, so internet is required. A lightweight interface does not make Electron a tiny binary: Chromium can use significant memory on demanding sites.

## Browser features

- An address bar, Google search, back/forward/reload and up to six internal tabs.
- One-click ChatGPT, Google, GitHub, and MDN shortcuts.
- Sites use a sandboxed Electron `WebContentsView`; Node integration is disabled and permission requests are denied by default.
- Cookies, history and authenticated sessions persist in **this application's own local browser profile** (`persist:copytype-mini-browser`). No Brave cookie extraction or password copying.
- Popup links attempt to open as another internal tab; some OAuth flows require real browser popup windows and may not work.

## Limitations and privacy

Google OAuth and some other providers reject embedded Chromium authentication (`disallowed_useragent`). ChatGPT sign-in compatibility must be tested on your device; it cannot be guaranteed.

The application is an ordinary visible desktop window. It is **not invisible** to whole-screen recording or sharing; it does not evade proctoring or contest monitoring. Share only the intended window/tab in a presentation and inspect the live preview.

There are no analytics, remote backends, or auto-read clipboard operations. Websites still receive the ordinary browser requests you send. The original CopyType typing extension remains in the project root.

## Tests

`npm test` for Node unit tests; `npm run check` for JS syntax; `python tests/browser-ui.py` for optional Playwright UI smoke checks.
