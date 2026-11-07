# CopyType Editor Connection

Connect the local CopyType desktop app to a VS Code text document. Open CopyType first. In VS Code, place the cursor or select the range to replace, open the Command Palette, and run **CopyType: Use This Editor**. Choose that document in CopyType's destination list and start typing.

The selected document remains the destination when you switch files or applications. Edits use VS Code's document API and do not simulate keystrokes, trigger bracket completion, or change global indentation/formatting settings. Source line breaks follow the destination document's LF/CRLF convention. Other extensions, format-on-save, or manual edits can still change text; CopyType stops when its expected contents no longer match. Unsaved text already entered remains when cancelled. It does not save or submit files automatically.

Run **CopyType: Disconnect Editor** to remove the destination. Closing the document also disconnects it. Local extension hosts are supported; a VS Code Remote/SSH extension host cannot use a different computer's local connection socket.

The desktop app and this extension communicate through a user-owned Unix socket, with an authenticated connection descriptor readable only by that user. There is no HTTP listener or remote service. Only the explicitly selected document is used for typing and local verification; its contents are not sent to the desktop app.

To package and install from the repository root:

```bash
python3 desktop/vscode/package.py /tmp/copytype-editor.vsix
code --install-extension /tmp/copytype-editor.vsix --force
```
