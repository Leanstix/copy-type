'use strict';
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const {randomUUID} = require('node:crypto');
const {workspaceFile} = require('./files.cjs');
let connection, retry, session, disposed = false, connecting = false, announceTimer, pausedConnection = false;
const tabIds = new Map();
function send(message) { if (connection && !connection.destroyed) connection.write(JSON.stringify(message) + '\n'); }
function entries() {
  const result = [], live = new Set();
  for (const group of vscode.window.tabGroups.all) for (const tab of group.tabs) {
    if (!(tab.input instanceof vscode.TabInputText)) continue;
    const uri = tab.input.uri;
    if (!['file', 'untitled'].includes(uri.scheme)) continue;
    const key = `${group.viewColumn}:${uri.toString()}`;
    live.add(key);
    if (!tabIds.has(key)) tabIds.set(key, randomUUID());
    result.push({id: tabIds.get(key), tab, group, uri});
  }
  for (const key of tabIds.keys()) if (!live.has(key)) tabIds.delete(key);
  return result;
}
function catalog() {
  const tabs = entries();
  return {
    label: (vscode.workspace.name || 'VS Code — no folder') + (vscode.window.activeTextEditor ? ' · ' + path.basename(vscode.window.activeTextEditor.document.fileName) : ''), focused: vscode.window.state.focused,
    folders: (vscode.workspace.workspaceFolders || []).filter(folder => folder.uri.scheme === 'file').map(folder => ({id: folder.uri.toString(), label: folder.name})),
    tabs: tabs.map(item => ({id: item.id, label: item.uri.scheme === 'untitled' ? item.tab.label : vscode.workspace.asRelativePath(item.uri, true), active: item.tab.isActive && item.group.isActive})),
  };
}
function announce() { clearTimeout(announceTimer); announceTimer = setTimeout(() => send({op: 'catalog', catalog: catalog()}), 25); }
async function selectTab(id) {
  if (session) throw Error('Finish or cancel typing before changing the destination.');
  const entry = entries().find(item => item.id === id);
  if (!entry) throw Error('This VS Code tab was closed. Choose another tab.');
  const document = await vscode.workspace.openTextDocument(entry.uri);
  const editor = await vscode.window.showTextDocument(document, {viewColumn: entry.group.viewColumn, preserveFocus: true, preview: false});
  if (editor.selections.length !== 1) throw Error('Use a single cursor or selection in this file.');
  announce();
  return {document, editor, id: entry.id};
}
async function createTab(request) {
  if (session) throw Error('Finish or cancel typing before creating another file.');
  let document;
  if (request.untitled === true) document = await vscode.workspace.openTextDocument({content: ''});
  else {
    const folder = (vscode.workspace.workspaceFolders || []).find(item => item.uri.toString() === request.folderId && item.uri.scheme === 'file');
    if (!folder) throw Error('Choose a folder in this VS Code workspace.');
    const filename = workspaceFile(folder.uri.fsPath, request.name), uri = vscode.Uri.file(filename);
    try { fs.lstatSync(filename); throw Error('That file already exists. Choose its tab or use a different name.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await vscode.workspace.fs.stat(uri); throw Error('That file already exists. Choose its tab or use a different name.'); }
    catch (error) { if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') throw error; }
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(filename)));
    const edit = new vscode.WorkspaceEdit();
    edit.createFile(uri, {overwrite: false, ignoreIfExists: false});
    if (!await vscode.workspace.applyEdit(edit)) throw Error('VS Code could not create the file.');
    document = await vscode.workspace.openTextDocument(uri);
  }
  const editor = await vscode.window.showTextDocument(document, {preserveFocus: true, preview: false});
  const entry = entries().find(item => item.uri.toString() === document.uri.toString() && item.group.viewColumn === editor.viewColumn);
  if (!entry) throw Error('The new editor tab could not be found.');
  send({op: 'catalog', catalog: catalog()});
  return {tabId: entry.id};
}
async function apply(request) {
  if (request.op === 'list-tabs') return catalog();
  if (request.op === 'select-tab') { const item = await selectTab(request.tabId); return {tabId: item.id}; }
  if (request.op === 'create-file') return createTab(request);
  if (request.op === 'prepare') {
    const {document, editor, id} = await selectTab(request.tabId), selection = editor.selection;
    session = {id: request.session, tabId: id, document, expected: document.getText(), offset: document.offsetAt(selection.start), end: document.offsetAt(selection.end), first: true};
    return true;
  }
  if (!session || session.id !== request.session || session.tabId !== request.tabId) throw Error('No matching VS Code typing task.');
  const document = session.document;
  if (request.op === 'cancel') { session = null; return true; }
  if (!entries().some(item => item.id === session.tabId)) throw Error('The destination tab was closed.');
  if (document.isClosed) throw Error('The destination document was closed.');
  if (document.getText() !== session.expected) throw Error('The document changed outside CopyType. Typing stopped; no changes were overwritten.');
  if (request.op === 'complete') return true;
  if (request.op !== 'append' || typeof request.char !== 'string' || !request.char.length || request.char.length > 2 || request.char.includes('\0')) throw Error('Invalid editor input.');
  const char = request.char === '\n' && document.eol === vscode.EndOfLine.CRLF ? '\r\n' : request.char;
  const from = session.offset, to = session.first ? session.end : from;
  const expected = session.expected.slice(0, from) + char + session.expected.slice(to);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(from), document.positionAt(to)), char);
  if (!await vscode.workspace.applyEdit(edit)) throw Error('VS Code rejected the edit.');
  session.expected = expected; session.offset = from + char.length; session.first = false;
  if (document.getText() !== expected) throw Error('A VS Code extension or formatter changed the text. Typing stopped.');
  for (const editor of vscode.window.visibleTextEditors.filter(item => item.document === document)) editor.selection = new vscode.Selection(document.positionAt(session.offset), document.positionAt(session.offset));
  return true;
}
function connect() {
  if (disposed || pausedConnection || connecting || (connection && !connection.destroyed)) return;
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
        if (message.op === 'connected') { send({op: 'catalog', catalog: catalog()}); continue; }
        chain = chain.then(async () => {
          try { const result = await apply(message); if (connection === socket) send({id: message.id, ok: true, result}); }
          catch (error) { if (connection === socket) send({id: message.id, ok: false, error: error.message}); }
        });
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => { connecting = false; session = null; if (connection === socket) connection = null; });
  } catch { connecting = false; }
}
function activate(context) {
  disposed = false;
  context.subscriptions.push(vscode.commands.registerCommand('copytype.selectEditor', () => { pausedConnection = false; announce(); connect(); }));
  context.subscriptions.push(vscode.commands.registerCommand('copytype.disconnect', () => { pausedConnection = true; session = null; connection?.destroy(); }));
  for (const event of [vscode.window.tabGroups.onDidChangeTabs, vscode.window.tabGroups.onDidChangeTabGroups, vscode.window.onDidChangeActiveTextEditor, vscode.window.onDidChangeWindowState, vscode.workspace.onDidChangeWorkspaceFolders]) context.subscriptions.push(event(announce));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => { if (session?.document === document) session = null; announce(); }));
  retry = setInterval(connect, 2000); connect();
  context.subscriptions.push({dispose: deactivate});
}
function deactivate() { disposed = true; clearInterval(retry); clearTimeout(announceTimer); connection?.destroy(); session = null; }
module.exports = {activate, deactivate};
