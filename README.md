# CopyType — delayed code entry

A lightweight Chrome/Chromium **Manifest V3** extension for manually queuing text and entering it gradually into a selected webpage editor. No backend, accounts, analytics, or external dependencies.

## Install (developer mode)

1. Download this repo as a ZIP and extract it, or clone it.
2. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked**, and select the directory containing `manifest.json`.
5. Pin **CopyType** to the toolbar.

## Use

1. Navigate to the page with the editor. Click CopyType in the toolbar.
2. Paste source code into the extension's popup.
3. Choose **Preserve formatting** (the default) or **Keyboard events**.
4. Press **Confirm**, then click in the editor where you want the code inserted. Typing starts at the current cursor position.
5. Use the floating widget to **Pause**, **Resume**, or **Cancel**. **Esc** also cancels.

The popup estimates the total time before you start. Inputs under 1,800 characters target about 7.5 characters per second. From 1,800 characters upward, the default target is **around five minutes**, unless the input would require going faster than 12 characters/sec; then it takes longer. Individual delays vary modestly, including at newlines and punctuation.

### Exact code-editor support

**New in v1.1.0:** CopyType detects Ace, CodeMirror 5/6, and Monaco when the page exposes a usable editor instance. It inserts characters into the editor's document model at the clicked caret position, avoiding automatic bracket pairs, indentation, and editor-typed formatting. When complete, it reads the editor document back and verifies the result against the exact source (normalizing CRLF). If a supported editor plugin changes the content, it repairs the document to the expected contents while keeping the original text outside the selected range. A verification error is displayed if that fails.

Native editor APIs are not exposed by every site or editor version. **If exact editor support is unavailable, CopyType falls back to browser text input; that fallback is not guaranteed to reproduce the source exactly.** Review the resulting code before submitting. Chrome may still display the debugger notice; typing rate is unchanged.

## Typing methods

- **Exact editor mode** uses native document-model edits for recognized code editors; the Chrome `Input.insertText` DevTools Protocol command is used as a fallback. This is browser-generated input, *not* physical hardware keyboard input.
- **Keyboard events** emits Chrome DevTools `Input.dispatchKeyEvent` `keyDown`/`keyUp` pairs for printable US-layout ASCII in ordinary text fields. In a detected IDE, CopyType automatically switches to exact native editing (or literal input as a fallback), because synthetic keys can trigger auto-indent and auto-closing.

### Permissions and privacy

- `activeTab` / `scripting`: install the small click detector only after you activate the extension, and only in that tab.
- `debugger`: ask Chrome to deliver text/key events at the browser input layer. Chrome **shows an "is debugging this browser" notice** while this permission is in use. Chrome DevTools can interrupt the session. The extension detaches after completion/cancellation.
- `storage`: hold one queued code sample temporarily in **session storage** until it is entered or cancelled. No data is sent to a server or persisted in `sync` / `local` storage.

**Limitations:** Only ordinary HTTP(S) pages. No `chrome://` pages, Chrome Web Store pages, PDF viewers, or browser-protected pages. Some sandboxed/cross-origin iframes and web applications with custom input handling may not work. A website can detect or block automated input; this extension does not guarantee that any page will accept the result. Code-entry accuracy should be verified before submission. Do not use it where contest or site rules prohibit automated input.

## Development

No build step or npm packages required. Run `npm test` and `npm run check` with Node.js 18+. To test the editor bridge in headless Chrome with Playwright installed, run `python tests/browser_bridge.py`.

## Security

The extension never reads code from webpages. Only the text explicitly entered in the popup is queued. It does not submit forms or read clipboard contents automatically. The code is not collected by a service, though—as with any text you enter into a website—the website itself can observe the input.
