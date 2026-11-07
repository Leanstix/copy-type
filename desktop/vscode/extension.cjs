'use strict';
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const {randomUUID} = require('node:crypto');
let connection, retry, target, session, disposed = false, connecting = false;
function send(message) { if (connection && !connection.destroyed) connection.write(JSON.stringify(message) + '\n'); }
function announce() { send({op: 'target', target: target ? {revision: target.revision, label: target.label} : null}); }
async function apply(request) {
  if (!target || request.revision !== target.revision || target.document.isClosed) throw Error('Select the VS Code destination again.');
  const document = target.document;
  if (request.op === 'prepare') {
    if (session) throw Error('This editor already has a typing task.');
    if (document.version !== target.version) throw Error('Document changed after selection. Use CopyType: Use This Editor again.');
    session = {id: request.session, expected: document.getText(), offset: target.from, end: target.to, first: true};
    return true;
  }
  if (!session || session.id !== request.session) throw Error('No matching VS Code typing task.');
  if (request.op === 'cancel') {
    if (document.getText() === session.expected) {
      if (!session.first) target.from = target.to = session.offset;
      target.version = document.version;
    }
    session = null; return true;
  }
  if (document.getText() !== session.expected) throw Error('The document changed outside CopyType. Typing stopped; no changes were overwritten.');
  if (request.op === 'complete') {
    target.from = target.to = session.offset;
    target.version = document.version;
    return true;
  }
  if (request.op !== 'append' || typeof request.char !== 'string' || !request.char.length || request.char.length > 2 || request.char.includes('\0')) throw Error('Invalid editor input.');
  const char = request.char === '\n' && document.eol === vscode.EndOfLine.CRLF ? '\r\n' : request.char;
  const from = session.offset, to = session.first ? session.end : from;
  const expected = session.expected.slice(0, from) + char + session.expected.slice(to);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(from), document.positionAt(to)), char);
  if (!await vscode.workspace.applyEdit(edit)) throw Error('VS Code rejected the edit.');
  session.expected = expected; session.offset = from + char.length; session.first = false;
  if (document.getText() !== expected) throw Error('A VS Code extension or formatter changed the text. Typing stopped.');
  const editor = vscode.window.visibleTextEditors.find(item => item.document === document);
  if (editor) editor.selection = new vscode.Selection(document.positionAt(session.offset), document.positionAt(session.offset));
  return true;
}
function connect() {
  if (disposed || connecting || (connection && !connection.destroyed)) return;
  const directory = process.env.COPYTYPE_RUNTIME_DIR || path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), `copytype-${process.getuid()}`);
  try {
    const stat = fs.lstatSync(path.join(directory, 'desktop.json'));
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077)) return;
    const info = JSON.parse(fs.readFileSync(path.join(directory, 'desktop.json'), 'utf8'));
    if (typeof info.socket !== 'string' || path.dirname(info.socket) !== directory || typeof info.token !== 'string') return;
    connecting = true;
    const socket = net.createConnection(info.socket); connection = socket;
    let buffer = '', chain = Promise.resolve();
    socket.setEncoding('utf8');
    socket.on('connect', () => { connecting = false; send({op: 'hello', token: info.token}); });
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) { socket.destroy(); return; }
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        let message;
        try { message = JSON.parse(line); } catch { socket.destroy(); return; }
        if (message.op === 'connected') { announce(); continue; }
        chain = chain.then(async () => {
          try { const result = await apply(message); send({id: message.id, ok: true, result}); }
          catch (error) { send({id: message.id, ok: false, error: error.message}); }
        });
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => { connecting = false; session = null; if (connection === socket) connection = null; });
  } catch { connecting = false; }
}
function selectEditor() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.isClosed) throw Error('Open a text document and place its cursor first.');
  if (editor.selections.length !== 1) throw Error('Use a single cursor or selection.');
  if (session) throw Error('Cancel the current typing task before selecting another editor.');
  const document = editor.document;
  const selection = editor.selection;
  target = {document, revision: randomUUID(), version: document.version, from: document.offsetAt(selection.start), to: document.offsetAt(selection.end), label: `${vscode.workspace.name || 'VS Code'} · ${path.basename(document.fileName)}`};
  connect(); announce();
  return {label: target.label};
}
function activate(context) {
  disposed = false;
  context.subscriptions.push(vscode.commands.registerCommand('copytype.selectEditor', () => {
    try { return selectEditor(); } catch (error) { vscode.window.showErrorMessage(error.message); throw error; }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('copytype.disconnect', () => { target = null; session = null; announce(); }));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => {
    if (target?.document === document) { target = null; session = null; announce(); }
  }));
  retry = setInterval(connect, 2000); connect();
  context.subscriptions.push({dispose: deactivate});
  return {selectEditor};
}
function deactivate() { disposed = true; clearInterval(retry); connection?.destroy(); target = null; session = null; }
module.exports = {activate, deactivate};
