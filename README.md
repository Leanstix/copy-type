# CopyType — delayed code entry

## CopyType Mini Browser — standalone companion

A separate mini-browser now lives in [`desktop/`](desktop/README.md). Unlike the browser preview in this Brave extension, it opens websites **inside its own application window** (not a hidden or extra Brave tab). Its independent browser profile keeps sign-ins after you restart it.

On Linux, with Node.js 20+ and npm installed:

```bash
bash desktop/start-linux.sh
```

The first run installs Electron, so internet access is needed. The mini-browser uses Chromium and is not a tiny executable; embedded site authentication (especially Google OAuth) is not universally supported. It is visible during whole-screen recording and sharing by default. An optional KDE Plasma Wayland launcher can exclude its native windows from supported screencasts; see [desktop documentation](desktop/README.md#kde-plasma-capture-exclusion) for setup and limitations.

---

A private, local-first Brave/Chromium **Manifest V3** extension for manually queuing text and entering it gradually into a selected webpage editor. No backend, accounts, analytics, or external dependencies.

## Install (developer mode)

1. Download this repo as a ZIP and extract it, or clone it.
2. In **Brave**, open `brave://extensions` (or `chrome://extensions` in Chrome / `edge://extensions` in Edge).
3. Turn on **Developer mode**.
4. Click **Load unpacked**, and select the directory containing `manifest.json`.
5. Pin **CopyType** to the toolbar.

## Use

1. Navigate to the page with the editor. Click CopyType in the toolbar.
2. Paste source code into the extension's popup.
3. Choose **Preserve formatting** (the default) or **Keyboard events**.
4. Press **Confirm**, then click in the editor where you want the code inserted. Typing starts at the current cursor position.
5. Use the floating widget to **Pause**, **Resume**, or **Cancel**. **Esc** also cancels.

After selecting the editor and starting, you can switch to another tab; CopyType continues targeting the original tab. Return to that tab to pause or cancel. Keep the target page open: navigating or closing it stops the task. Moving focus to another field within the target page cancels typing to avoid entering text into the wrong field. Background pages and some editors may throttle or reject input, so verify the result on your actual site.

The popup estimates the total time before you start. Inputs under 1,800 characters target about 7.5 characters per second. From 1,800 characters upward, the default target is **around five minutes**, unless the input would require going faster than 12 characters/sec; then it takes longer. Individual delays vary modestly, including at newlines and punctuation.

### Supported editors

CopyType detects **Monaco, CodeMirror 5, CodeMirror 6, and Ace**. When the page exposes its editor instance, CopyType edits the document model at the caret or replaces the selection. It preserves the model's line endings and verifies the resulting text.

CopyType uses browser text input for **HTML textareas, contenteditable fields, and rich-text editors** such as Tiptap. It also uses this path when a code editor's model is unavailable. The page's own formatting rules apply, so check the result in the editor when the widget reports that it finished sending browser input.

You can click into editors in same-origin iframes, including nested frames and dynamically loaded frames. CopyType stops when the selected editor loses focus to another field or is removed.

For diagnostics, open the page's **DevTools → Console**, enable **Verbose**, and filter for `[CopyType]`. The log shows the detected editor, input method, frame, focus changes, and verification status. It excludes the queued text and editor contents.

## In-extension browser preview (v1.3.0)

1. Click the CopyType icon, then choose **Browser**.
2. Enter a website or search query, or use the ChatGPT/GitHub/Google/Docs shortcuts.
3. The webpage **appears inside the CopyType popup**, with click, scroll, back, forward, reload and basic text-entry controls.
4. Click an input field in the preview, use **Type** below the preview to send text, and use **↵** to submit.
5. **Close browser** detaches the debugger and removes CopyType's background tab.

**Implementation:** This is a tab-backed browser preview, *not* an iframe. Brave/Chromium creates **one inactive tab in the current browser window** and renders that page inside the extension via the Chrome DevTools `Page.captureScreenshot` command. The same tab is reused for navigation; **no new browser window is opened**. Your browser will show the background tab in the tab strip, and may show a browser debugging notice while it is attached. Refreshing is approximately every 1.8 seconds, so animations may look choppy. Some sites, DRM surfaces, authentication redirects, unusual frame layouts, and background tab rendering may not display or interact correctly.

**Sessions:** Since the actual destination is a regular page in your existing Brave/Chromium profile, the browser handles cookies and sign-ins directly. The extension neither reads nor exports sign-in cookies, passwords, or tokens. The preview may display sensitive account information on screen; it remains inside the local browser interface and is never transmitted to a CopyType service. Different browser profiles and incognito contexts remain separate.

**Screen capture:** The extension **does not hide itself or its preview from full-screen recordings or sharing**. Chrome extensions do not have a supported API to exclude a chosen popup from other applications' whole-display capture. A tab/window-specific share is a privacy-respecting option when you want to keep unrelated activity out of the shared view. There is no recorder evasion or monitoring bypass mechanism here.

## Typing methods

- **Exact editor mode** uses native document-model edits for recognized code editors; the Chrome `Input.insertText` DevTools Protocol command is used as a fallback. This is browser-generated input, *not* physical hardware keyboard input.
- **Keyboard events** emits Chrome DevTools `Input.dispatchKeyEvent` `keyDown`/`keyUp` pairs for printable US-layout ASCII in ordinary text fields. In a detected IDE, CopyType automatically switches to exact native editing (or literal input as a fallback), because synthetic keys can trigger auto-indent and auto-closing.

### Permissions and privacy

- `activeTab` / `scripting`: install the small click detector only after you activate the extension, and only in that tab.
- `debugger`: ask Chrome to deliver text/key events at the browser input layer. Brave/Chromium **may show an "is debugging this browser" notice** while this permission is in use. Chrome DevTools can interrupt the session. The extension detaches after completion/cancellation.
- `storage`: hold one queued code sample temporarily in **session storage** until it is entered or cancelled, and store browser preview state only in memory. No data is sent to a server or persisted in `sync` / `local` storage.
- No `cookies`, `history`, `<all_urls>`, screen capture, or extra host permissions are requested. The background tab uses your browser's existing cookies natively.

**Code-entry limitations:** Only ordinary HTTP(S) pages. No browser-internal pages (such as `brave://` or `chrome://`), Chrome Web Store pages, PDF viewers, or browser-protected pages. Some sandboxed/cross-origin iframes and web applications with custom input handling may not work. A website can detect or block automated input; this extension does not guarantee that any page will accept the result. Code-entry accuracy should be verified before submission. Do not use it where contest or site rules prohibit automated input.

## Development

No build step or npm packages are required. Run `npm test` and `npm run check` with Node.js 18+. With Playwright and Chromium installed, run `python tests/browser_workspace.py` for the popup smoke test or `python tests/browser_bridge.py` for the cross-world editor bridge in an iframe. Set `COPYTYPE_CHROMIUM` to use a different Chromium binary for the bridge test.

## Security

CopyType reads the selected code editor's document model locally when verifying a model edit. The queue contains only text entered in the popup. CopyType does not submit forms, read the clipboard automatically, or transmit the text to a service. The destination website can observe the input it receives.
