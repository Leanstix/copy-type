/* Real VS Code test host; only run in a disposable /tmp workspace. */
'use strict';
const vscode=require('vscode'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {LocalBridge}=require('../local-bridge.cjs');
const {TypingController}=require('../typing.cjs');
async function until(check,timeout=10000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('VS Code state timed out');}
async function run(){
 const runtime=process.env.COPYTYPE_RUNTIME_DIR,root=vscode.workspace.workspaceFolders?.[0];
 assert.ok(root&&root.uri.fsPath.startsWith(os.tmpdir()+path.sep),'Use a temporary test workspace');
 const bridge=new LocalBridge();await bridge.start();
 let second;
 try{
  await vscode.extensions.getExtension('copytype-local.copytype-editor').activate();
  await until(()=>bridge.windows().length===1);
  const firstWindow=bridge.windows()[0].id;
  const document=await vscode.workspace.openTextDocument({language:'javascript',content:'prefixOLDsuffix'});
  const editor=await vscode.window.showTextDocument(document,{preview:false});
  editor.selection=new vscode.Selection(document.positionAt(6),document.positionAt(9));
  const adapter=await until(()=>bridge.targets().find(item=>item.id===bridge.windows()[0].activeTarget));
  const other=await vscode.workspace.openTextDocument({content:'leave this alone'});
  await vscode.window.showTextDocument(other,{preview:false});
  await until(()=>bridge.targets().filter(item=>item.windowId===firstWindow).length>=2);
  assert.ok(bridge.targets().some(item=>item.id===adapter.id),'Inactive tabs must be discovered without commands');
  const controller=new TypingController({wait:()=>new Promise(resolve=>setTimeout(resolve,30))});
  await controller.start(adapter,'{\n\tconst x = "🙂é";\n}');
  await until(()=>controller.state.done>=1);
  await vscode.window.showTextDocument(other);
  if(controller.job)await controller.job.completion;
  assert.equal(controller.state.status,'done',controller.state.message);
  assert.equal(document.getText(),'prefix{\n\tconst x = "🙂é";\n}suffix');
  assert.equal(vscode.window.activeTextEditor.document,other);
  assert.equal(other.getText(),'leave this alone');
  // Conflicting edits during a task must be retained.
  await controller.start(adapter,'more text'.repeat(10));await until(()=>controller.state.done>=1);controller.control('pause');
  await new Promise(resolve=>setTimeout(resolve,200));
  const change=new vscode.WorkspaceEdit();change.insert(document.uri,document.positionAt(0),'MANUAL');assert.equal(await vscode.workspace.applyEdit(change),true);
  controller.control('resume');
  if(controller.job)await controller.job.completion;
  assert.equal(controller.state.status,'error');assert.ok(document.getText().startsWith('MANUAL'));
  const name='generated-'+Date.now()+'/example.js';
  const created=await bridge.command(firstWindow,'create-file',{folderId:root.uri.toString(),name});
  const createdTarget=await until(()=>bridge.targets().find(item=>item.id===`vscode:${firstWindow}:${created.tabId}`));
  assert.ok(createdTarget);assert.ok(fs.existsSync(path.join(root.uri.fsPath,name)));
  assert.ok(vscode.window.tabGroups.all.flatMap(group=>group.tabs).some(tab=>tab.input instanceof vscode.TabInputText&&tab.input.uri.fsPath===path.join(root.uri.fsPath,name)));
  await assert.rejects(()=>bridge.command(firstWindow,'create-file',{folderId:root.uri.toString(),name}),/already exists/);
  assert.equal(fs.readFileSync(path.join(root.uri.fsPath,name),'utf8'),'');
  await assert.rejects(()=>bridge.command(firstWindow,'create-file',{folderId:root.uri.toString(),name:'../escape.js'}),/inside/);
  const untitled=await bridge.command(firstWindow,'create-file',{untitled:true});
  await until(()=>bridge.targets().some(item=>item.id===`vscode:${firstWindow}:${untitled.tabId}`));
  assert.equal(vscode.window.activeTextEditor.document.uri.scheme,'untitled');
  const crlfPath=path.join(root.uri.fsPath,'crlf-'+Date.now()+'.js');fs.writeFileSync(crlfPath,'head\r\nOLD\r\ntail');
  const crlf=await vscode.workspace.openTextDocument(vscode.Uri.file(crlfPath)),crlfEditor=await vscode.window.showTextDocument(crlf,{preview:false});
  crlfEditor.selection=new vscode.Selection(crlf.positionAt(6),crlf.positionAt(9));
  const crlfTarget=await until(()=>bridge.targets().find(item=>item.id===bridge.windows()[0].activeTarget&&item.id!==`vscode:${firstWindow}:${untitled.tabId}`));
  await controller.start(crlfTarget,'{\n\té🙂\n}');if(controller.job)await controller.job.completion;
  assert.equal(controller.state.status,'done',controller.state.message);assert.equal(crlf.getText(),'head\r\n{\r\n\té🙂\r\n}\r\ntail');
  const secondRoot=path.join(runtime,'second-workspace');fs.mkdirSync(secondRoot,{recursive:true});
  const environment={...process.env};delete environment.ELECTRON_RUN_AS_NODE;
  second=spawn('/usr/bin/code',['--user-data-dir='+path.join(runtime,'second-profile'),'--extensions-dir='+path.join(runtime,'second-extensions'),'--extensionDevelopmentPath='+__dirname,'--extensionTestsPath='+path.join(__dirname,'window-peer.cjs'),'--disable-extensions','--disable-workspace-trust','--skip-welcome','--skip-release-notes','--new-window',secondRoot],{env:environment,stdio:'ignore'});
  await until(()=>bridge.windows().length===2,60000);
  const secondWindow=bridge.windows().find(item=>item.id!==firstWindow);
  await until(()=>bridge.targets().some(item=>item.windowId===secondWindow.id));
  const secondCreated=await bridge.command(secondWindow.id,'create-file',{folderId:secondWindow.folders[0].id,name:'second-only.js'});
  await until(()=>bridge.targets().some(item=>item.id===`vscode:${secondWindow.id}:${secondCreated.tabId}`));
  assert.ok(fs.existsSync(path.join(secondRoot,'second-only.js')));
  assert.equal(fs.existsSync(path.join(root.uri.fsPath,'second-only.js')),false);
  fs.writeFileSync(path.join(runtime,'finish-second'),'done');
  await until(()=>fs.existsSync(path.join(runtime,'second-finished')));
  fs.writeFileSync(path.join(runtime,'integration-result.json'),JSON.stringify({passed:true,automaticTabs:true,backgroundTyping:true,workspaceCreation:true,untitled:true,multipleWindows:true,unicodeAndCRLF:true}));
  console.log('PASS: automatic VS Code discovery, inactive tabs, exact background typing, workspace files, untitled tabs, two real windows, no-overwrite and CRLF');
 }finally{fs.writeFileSync(path.join(runtime,'finish-second'),'done');bridge.close();}
}
module.exports={run};
