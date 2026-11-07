# CopyType Editor Connection

Open CopyType's **Type text** panel and choose **VS Code**. Open text tabs are discovered automatically across connected VS Code windows, including inactive tabs and untitled documents. No Command Palette step is needed. One window is selected automatically; when several are connected, choose the workspace/window, then its tab. Selecting a tab opens it in VS Code without taking focus away from CopyType. Typing begins at that tab's current cursor or selection.

Expand **Create a file or tab** to create a named file in the selected workspace folder, or create a new untitled tab. The new editor opens in VS Code and becomes CopyType's destination automatically. Nested relative filenames are supported. Existing files are never overwritten, and paths escaping the selected workspace are rejected. In a multi-folder workspace, choose the destination folder. A VS Code window with no open folder can still create untitled tabs.

The selected document remains the destination when you switch files or applications. Edits use VS Code's document API and do not simulate keystrokes, trigger bracket completion, or change global indentation/formatting settings. Source line breaks follow the destination document's LF/CRLF convention. Other extensions, format-on-save, or manual edits can still change text; CopyType stops when its expected contents no longer match. Unsaved text already entered remains when cancelled. It does not save or submit files automatically.

Open/close/rename and active-tab changes update the list automatically. Closing a destination tab stops a running task. **CopyType: Disconnect Editor** pauses this window's connection, and **CopyType: Reconnect to Desktop** reconnects it if needed; these commands are optional. Local extension hosts are supported. Remote/SSH documents and non-text tabs such as notebooks and diff views are not listed in this version.

The desktop app and this extension communicate through a user-owned Unix socket, with an authenticated connection descriptor readable only by that user. There is no HTTP listener or remote service. Discovery shares workspace and tab labels, not document contents. Only the chosen document is used for typing and local verification; its contents are not sent to the desktop app.

To package and install from the repository root:

```bash
python3 desktop/vscode/package.py /tmp/copytype-editor.vsix
code --install-extension /tmp/copytype-editor.vsix --force
```
