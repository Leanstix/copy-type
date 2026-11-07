'use strict';
const path=require('node:path');
const fs=require('node:fs');
const {app,BrowserWindow,WebContentsView,ipcMain,session,Menu,globalShortcut}=require('electron');
const {resolveInput,validateURL}=require('./navigation.cjs');
const {makeTabState}=require('./tab-state.cjs');
const {TypingController}=require('./typing.cjs');
const {LocalBridge,AccessibilityBridge}=require('./local-bridge.cjs');
const {KdeShortcuts,toggleWindow}=require('./window-shortcuts.cjs');
const {configurePermissions}=require('./browser-permissions.cjs');
const HOME=process.env.COPYTYPE_START_URL||'https://chatgpt.com/',BAR_HEIGHT=126,PARTITION='persist:copytype-mini-browser';
const tabs=new Map(),model=makeTabState();
const typing=new TypingController(),accessibility=new AccessibilityBridge(),browserTargets=new Map();
let kdeShortcuts=null;
let win=null,visibleId=null,siteSession=null,localBridge=null,panelOpen=false,selecting=false,selectionContents=null,preferredTarget=null;
function destinations(){return [...browserTargets.values(),...(localBridge?.targets()||[]),...accessibility.targets()];}
function snapshot(){return {activeId:model.activeId,panelOpen,selecting,preferredTarget,vscodeWindows:localBridge?.windows()||[],typing:{...typing.state,busy:!!typing.job},targets:destinations().map(({id,label,kind,windowId,active})=>({id,label,kind,windowId,active})),tabs:model.ids.map(id=>{const t=tabs.get(id),w=t.view.webContents;return {id,title:t.title||'New tab',url:w.getURL()||t.url,loading:w.isLoading(),canGoBack:w.navigationHistory.canGoBack(),canGoForward:w.navigationHistory.canGoForward()};})};}
function publish(){if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send('mini:state',snapshot());}
function sizeView(){if(!win||win.isDestroyed())return;const [width,height]=win.getContentSize();const t=tabs.get(model.activeId);if(t)t.view.setBounds({x:0,y:BAR_HEIGHT,width:Math.max(0,width-(panelOpen?360:0)),height:Math.max(0,height-BAR_HEIGHT)});}
typing.on('state',publish);
function activate(id){
 if(!tabs.has(id))throw Error('Unknown tab.');
 if(visibleId!==null&&tabs.has(visibleId))try{win.contentView.removeChildView(tabs.get(visibleId).view);}catch{}
 model.activate(id);win.contentView.addChildView(tabs.get(id).view);visibleId=id;sizeView();tabs.get(id).view.webContents.focus();publish();
}
function openTab(input=HOME){
 const url=resolveInput(input),id=model.add();
 const view=new WebContentsView({webPreferences:{session:siteSession,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,allowRunningInsecureContent:false}});
 const tab={id,view,title:'New tab',url};tabs.set(id,tab);
 const w=view.webContents;
 w.on('before-mouse-event',(_event,mouse)=>{if(mouse.type==='mouseDown'&&model.activeId===id)w.focus();});
 w.setWindowOpenHandler(({url:target})=>{
  try{const safe=validateURL(target);setImmediate(()=>{if(win&&!win.isDestroyed())try{openTab(safe);}catch{}});}catch{}
  return {action:'deny'};
 });
 w.on('will-navigate',(event,target)=>{try{validateURL(target);}catch{event.preventDefault();}});
 w.on('page-title-updated',(_event,title)=>{tab.title=String(title).slice(0,90);publish();});
 w.on('did-navigate',(_event,target)=>{tab.url=target;publish();});
 w.on('did-navigate-in-page',(_event,target)=>{tab.url=target;publish();});
 w.on('did-start-loading',publish);w.on('did-stop-loading',publish);
 w.on('did-start-navigation',(_event,_url,isInPlace,isMainFrame)=>{
  if(isMainFrame&&!isInPlace){
   const target=browserTargets.get(id);
   if(target&&typing.job?.adapter.id===target.id)typing.control('cancel');
   browserTargets.delete(id);publish();
  }
 });
 w.on('did-fail-load',(_e,code,description,_url,isMainFrame)=>{if(isMainFrame&&code!==-3){tab.title='Failed: '+description;publish();}});
 w.on('before-input-event',(event,input)=>{
  if(input.type!=='keyDown')return;
  if(input.key==='Escape'&&typing.job){event.preventDefault();typing.control('cancel');return;}
  if(!input.control&&!input.meta)return;
  const k=input.key?.toLowerCase();
  if(k==='l'){event.preventDefault();win.webContents.send('mini:focus-address');}
  else if(k==='t'){event.preventDefault();try{openTab(HOME);}catch{}}
  else if(k==='w'){event.preventDefault();closeTab(id);}
  else if(k==='r'){event.preventDefault();w.reload();}
 });
 activate(id);w.loadURL(url).catch(()=>{});return id;
}
function closeTab(id){
 if(!tabs.has(id))throw Error('Unknown tab.');
 const t=tabs.get(id),wasActive=id===model.activeId;
 const target=browserTargets.get(id);
 if(target&&typing.job?.adapter.id===target.id)typing.control('cancel');
 browserTargets.delete(id);
 if(wasActive){win.contentView.removeChildView(t.view);visibleId=null;}
 tabs.delete(id);model.close(id);t.view.webContents.close();
 if(wasActive&&model.activeId!==null){win.contentView.addChildView(tabs.get(model.activeId).view);visibleId=model.activeId;sizeView();}
 if(model.activeId===null)openTab(HOME);
 publish();
}
async function typingCommand({type,payload}){
 if(type==='panel'){panelOpen=!!payload;sizeView();publish();return;}
 if(type==='cancel'&&selecting){await selectionContents?.executeJavaScript('window.__copyTypeDesktopEditor?.cancelSelection()');return;}
 if(['pause','resume','cancel'].includes(type))return typing.control(type);
 if(type==='start'){
  if(!payload||typeof payload.target!=='string')throw Error('Choose a destination.');
  return typing.start(destinations().find(item=>item.id===payload.target),payload.text,payload.rate);
 }
 if(typing.job)throw Error('Cancel or finish typing before changing destinations.');
 if(type==='vscode-refresh'){await localBridge.refresh();publish();return;}
 if(type==='vscode-select'){
  const target=localBridge.targets().find(item=>item.id===payload?.target);
  if(!target?.select)throw Error('Choose an open VS Code tab.');
  await target.select();preferredTarget=target.id;publish();return;
 }
 if(type==='vscode-create'){
  if(!payload||typeof payload.window!=='string')throw Error('Choose a VS Code window first.');
  const result=await localBridge.command(payload.window,'create-file',{name:payload.name,folderId:payload.folderId,untitled:payload.untitled===true});
  await localBridge.refresh();preferredTarget=`vscode:${payload.window}:${result.tabId}`;publish();return {id:preferredTarget};
 }
 if(type==='desktop-fields'){
  const fields=await accessibility.refresh();
  typing.update({status:'idle',message:fields.length?`Found ${fields.length} editable desktop fields. Choose one above.`:'No compatible desktop fields found. Use the VS Code connection or select an editor in the browser.'});
  publish();return;
 }
 if(type==='select-browser'){
  if(selecting)throw Error('Click the editor in the browser first.');
  const id=model.activeId,w=tabs.get(id)?.view.webContents;
  if(!w||!/^https?:\/\//.test(w.getURL()))throw Error('Open a regular website first.');
  selecting=true;selectionContents=w;publish();
  try{
   await w.executeJavaScript(fs.readFileSync(path.join(__dirname,'../editor-bridge.js'),'utf8'));
   await w.executeJavaScript(fs.readFileSync(path.join(__dirname,'page-editor.js'),'utf8'));
   const result=await w.executeJavaScript('window.__copyTypeDesktopEditor.choose()');
   const target={id:`browser:${id}:${result.revision}`,label:`Browser · ${result.label}`,kind:result.kind,
    call:(op,args)=>{if(w.isDestroyed())throw Error('Browser destination was closed.');return w.executeJavaScript(`window.__copyTypeDesktopEditor.command(${JSON.stringify(op)},${JSON.stringify({...args,revision:result.revision})})`);}};
   browserTargets.set(id,target);preferredTarget=target.id;return {id:target.id};
  }finally{selecting=false;selectionContents=null;publish();}
 }
 throw Error('Unknown typing command.');
}
function command({type,payload}){
 const w=tabs.get(model.activeId)?.view.webContents;
 if(type==='new-tab')return openTab(typeof payload==='string'?payload:HOME);
 if(type==='close-tab'){closeTab(Number(payload));return true;}
 if(type==='activate-tab'){activate(Number(payload));return true;}
 if(type==='navigate'){w.loadURL(resolveInput(payload)).catch(()=>{});return true;}
 if(type==='home'){w.loadURL(HOME).catch(()=>{});return true;}
 if(type==='reload'){w.reload();return true;}
 if(type==='back'){if(w.navigationHistory.canGoBack())w.navigationHistory.goBack();return true;}
 if(type==='forward'){if(w.navigationHistory.canGoForward())w.navigationHistory.goForward();return true;}
 throw Error('Unknown command.');
}
function createWindow(){
 siteSession=session.fromPartition(PARTITION,{cache:true});
 configurePermissions(siteSession,()=>({webContents:tabs.get(model.activeId)?.view.webContents,focused:!!win&&!win.isDestroyed()&&win.isFocused(),visible:!!win&&!win.isDestroyed()&&win.isVisible()}));
 win=new BrowserWindow({width:1120,height:780,minWidth:760,minHeight:540,title:'CopyType Mini Browser',backgroundColor:'#0c1220',autoHideMenuBar:true,
  webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
 Menu.setApplicationMenu(null);
 if(process.env.COPYTYPE_PRIVATE==='1')win.setSkipTaskbar(true);
 win.webContents.on('will-navigate',event=>event.preventDefault());
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.on('resize',sizeView);
 win.on('closed',()=>{for(const t of tabs.values())if(!t.view.webContents.isDestroyed())t.view.webContents.close();tabs.clear();visibleId=null;win=null;});
 win.loadFile(path.join(__dirname,'index.html')).then(()=>{openTab(HOME);publish();});
}
if(!app.requestSingleInstanceLock())app.quit();
else app.whenReady().then(async()=>{
 localBridge=new LocalBridge();await localBridge.start();localBridge.on('targets',publish);
 if(process.env.COPYTYPE_PRIVATE==='1'){
  kdeShortcuts=new KdeShortcuts();
  kdeShortcuts.on('action',action=>{if(action==='toggle')toggleWindow(win);else if(action==='cancel'&&typing.job)typing.control('cancel');});
  kdeShortcuts.on('disconnected',()=>{win?.show();win?.focus();typing.update({message:'KDE shortcut connection ended. Restart CopyType to reconnect.'});});
  await kdeShortcuts.start();
 }else{
  globalShortcut.register('Control+Alt+Space',()=>toggleWindow(win));
  globalShortcut.register('Control+Alt+Backspace',()=>{if(typing.job)typing.control('cancel');});
 }
 ipcMain.handle('mini:state',event=>{if(!win||event.sender!==win.webContents)throw Error('Unauthorized request.');return snapshot();});
 ipcMain.handle('mini:command',(event,args)=>{if(!win||event.sender!==win.webContents)throw Error('Unauthorized request.');return command(args||{});});
 ipcMain.handle('mini:typing',(event,args)=>{if(!win||event.sender!==win.webContents)throw Error('Unauthorized request.');return typingCommand(args||{});});
 createWindow();app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)createWindow();});
}).catch(error=>{console.error(error.message);app.quit();});
app.on('second-instance',()=>{if(win?.isMinimized())win.restore();win?.show();win?.focus();});
app.on('before-quit',()=>{if(typing.job)typing.control('cancel');kdeShortcuts?.close();localBridge?.close();accessibility.close();globalShortcut.unregisterAll();});
app.on('window-all-closed',()=>app.quit());
