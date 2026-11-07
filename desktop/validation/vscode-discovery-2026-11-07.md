# Automatic VS Code discovery and browser copying — 7 November 2026

Implemented automatic VS Code window/workspace and text-tab catalogs, destination selection from CopyType, workspace file creation, and untitled-tab creation. The local VS Code connection was upgraded and installed as **0.2.0**. Its packaged extension, helper, and manifest were compared against the current source and matched.

## Live validation

The real VS Code extension-host integration passed in two separate disposable VS Code profiles and workspaces, without invoking a destination-selection command:

- Listed open text tabs, including inactive and untitled tabs.
- Typed exact code into the chosen document while another file was active, preserving the unrelated document.
- Preserved tabs, braces, Unicode, LF/CRLF, and the text around a selection.
- Retained a manual edit and stopped typing after a detected conflict.
- Created an empty named file in the chosen workspace, opened its editor tab, and discovered it automatically.
- Refused an existing filename and a path outside the chosen workspace.
- Opened and discovered a new untitled tab.
- Connected a second real VS Code window, selected that window's workspace for a new file, and verified that the file existed only in the second workspace.

The test returned `passed: true` and the extension host exited with code 0. The result marker was `/tmp/copytype-vscode-discovery-tests3/runtime/integration-result.json` during this run.

The actual Electron UI was also checked against synthetic VS Code peers: one window was automatically selected; adding a second required an explicit choice; inactive-tab selection and named-file/untitled creation routed to the chosen window; new destinations became selected automatically. Browser typing into an inactive tab still passed.

## Clipboard repair and its limits

The website session previously denied every permission, including clipboard writes. It now permits sanitized clipboard writes only for the focused active website's main frame in a focused visible window, with a matching origin. Clipboard reads and other permissions remain denied. Clicking the embedded page explicitly focuses its web contents; activating browser tabs also restores their focus.

A local browser fixture reproduced a website Copy button through `navigator.clipboard.writeText`, starting with focus in the app shell. Native input successfully copied the expected text, and `navigator.clipboard.readText` was rejected. The clipboard was restored after the successful check. A disposable KDE window was explicitly activated for the test so concurrent test applications could not steal focus. This verifies the relevant browser API and focus path; it does not claim a signed-in ChatGPT conversation was tested end-to-end.

Desktop checks: **34 passed, 1 skipped**, with no failures. The skipped check is the pre-existing root-owned sandbox fixture. JavaScript and Linux launcher syntax checks passed. New unit checks cover clipboard read/write boundaries and workspace path/symlink containment.

## Activation

Restart CopyType and reload/reopen existing VS Code windows once to activate the updated desktop and connection code. Afterwards, use **VS Code → window/workspace → open tab** in CopyType; no Command Palette step is needed for selecting a destination. Use **Create a file or tab** for new workspace files and untitled tabs. Discovery lists local text tabs; notebooks, diff views, and remote documents are not included in this version.
