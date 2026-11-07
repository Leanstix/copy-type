/* Loaded by VS Code's extension test host. Does not modify the user's profile. */
'use strict';
const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {LocalBridge} = require('../local-bridge.cjs');
const {TypingController} = require('../typing.cjs');
async function until(callback) {for(let i=0;i<100;i++){const result=callback();if(result)return result;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Editor connection timed out.');}
async function run() {
  const bridge = new LocalBridge();await bridge.start();
  try {
    const extension = vscode.extensions.getExtension('copytype-local.copytype-editor');
    assert.ok(extension);await extension.activate();
    const document = await vscode.workspace.openTextDocument({language:'javascript',content:'prefixOLDsuffix'});
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(document.positionAt(6),document.positionAt(9));
    await vscode.commands.executeCommand('copytype.selectEditor');
    const adapter = await until(()=>bridge.targets()[0]);
    // Switch to another file; edits must stay in the pinned document.
    const other = await vscode.workspace.openTextDocument({content:'leave this alone'});
    await vscode.window.showTextDocument(other);
    const controller = new TypingController({wait:async()=>{}});
    await controller.start(adapter,'{\n\t🙂é\n}');if(controller.job)await controller.job.completion;
    assert.equal(controller.state.status,'done',controller.state.message);
    assert.equal(document.getText(),'prefix{\n\t🙂é\n}suffix');
    assert.equal(other.getText(),'leave this alone');
    // A manual change after selection must stop preparation, preserving the edit.
    const edit = new vscode.WorkspaceEdit();edit.insert(document.uri,document.positionAt(0),'MANUAL');await vscode.workspace.applyEdit(edit);
    await controller.start(adapter,'do not insert');if(controller.job)await controller.job.completion;
    assert.equal(controller.state.status,'error');assert.ok(document.getText().startsWith('MANUAL'));
    const crlfPath=path.join(process.env.COPYTYPE_RUNTIME_DIR,'crlf.js');
    fs.writeFileSync(crlfPath,'head\r\nOLD\r\ntail');
    const crlf=await vscode.workspace.openTextDocument(vscode.Uri.file(crlfPath));
    const crlfEditor=await vscode.window.showTextDocument(crlf);
    crlfEditor.selection=new vscode.Selection(crlf.positionAt(6),crlf.positionAt(9));
    await vscode.commands.executeCommand('copytype.selectEditor');
    const crlfTarget=await until(()=>bridge.targets()[0]?.id!==adapter.id&&bridge.targets()[0]);
    await controller.start(crlfTarget,'{\n\té🙂\n}');if(controller.job)await controller.job.completion;
    assert.equal(controller.state.status,'done',controller.state.message);
    assert.equal(crlf.getText(),'head\r\n{\r\n\té🙂\r\n}\r\ntail');
    await vscode.commands.executeCommand('copytype.disconnect');
    console.log('PASS: real VS Code background document edits, exact formatting, LF/CRLF, Unicode, and conflict protection');
    // Test documents are disposable and unsaved, so close without prompting.
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  } finally {bridge.close();}
}
module.exports={run};
