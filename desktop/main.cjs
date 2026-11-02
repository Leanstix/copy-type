'use strict';
const path=require('node:path');
const {app,BrowserWindow,WebContentsView,ipcMain,session,Menu}=require('electron');
const {resolveInput,validateURL}=require('./navigation.cjs');
const {makeTabState}=require('./tab-state.cjs');
const HOME='https://chatgpt.com/',BAR_HEIGHT=126,PARTITION='persist:copytype-mini-browser';
const tabs=new Map(),model=makeTabState();
let win=null,visibleId=null,siteSession=null;
function snapshot(){return {activeId:model.activeId,tabs:model.ids.map(id=>{const t=tabs.get(id),w=t.view.webContents;return {id,title:t.title||'New tab',url:w.getURL()||t.url,loading:w.isLoading(),canGoBack:w.navigationHistory.canGoBack(),canGoForward:w.navigationHistory.canGoForward()};})};}
function publish(){if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send('mini:state',snapshot());}
function sizeView(){if(!win||win.isDestroyed())return;const [width,height]=win.getContentSize();const t=tabs.get(model.activeId);if(t)t.view.setBounds({x:0,y:BAR_HEIGHT,width,height:Math.max(0,height-BAR_HEIGHT)});}
function activate(id){
 if(!tabs.has(id))throw Error('Unknown tab.');
 if(visibleId!==null&&tabs.has(visibleId))try{win.contentView.removeChildView(tabs.get(visibleId).view);}catch{}
 model.activate(id);win.contentView.addChildView(tabs.get(id).view);visibleId=id;sizeView();publish();
}
function openTab(input=HOME){
 const url=resolveInput(input),id=model.add();
 const view=new WebContentsView({webPreferences:{session:siteSession,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,allowRunningInsecureContent:false}});
 const tab={id,view,title:'New tab',url};tabs.set(id,tab);
 const w=view.webContents;
 w.setWindowOpenHandler(({url:target})=>{
  try{const safe=validateURL(target);setImmediate(()=>{if(win&&!win.isDestroyed())try{openTab(safe);}catch{}});}catch{}
  return {action:'deny'};
 });
 w.on('will-navigate',(event,target)=>{try{validateURL(target);}catch{event.preventDefault();}});
 w.on('page-title-updated',(_event,title)=>{tab.title=String(title).slice(0,90);publish();});
 w.on('did-navigate',(_event,target)=>{tab.url=target;publish();});
 w.on('did-navigate-in-page',(_event,target)=>{tab.url=target;publish();});
 w.on('did-start-loading',publish);w.on('did-stop-loading',publish);
 w.on('did-fail-load',(_e,code,description,_url,isMainFrame)=>{if(isMainFrame&&code!==-3){tab.title='Failed: '+description;publish();}});
 w.on('before-input-event',(event,input)=>{
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
 if(wasActive){win.contentView.removeChildView(t.view);visibleId=null;}
 tabs.delete(id);model.close(id);t.view.webContents.close();
 if(wasActive&&model.activeId!==null){win.contentView.addChildView(tabs.get(model.activeId).view);visibleId=model.activeId;sizeView();}
 if(model.activeId===null)openTab(HOME);
 publish();
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
 siteSession.setPermissionRequestHandler((_web,_permission,callback)=>callback(false));
 siteSession.setPermissionCheckHandler(()=>false);
 win=new BrowserWindow({width:1020,height:750,minWidth:560,minHeight:460,title:'CopyType Mini Browser',backgroundColor:'#0c1220',autoHideMenuBar:true,
  webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
 Menu.setApplicationMenu(null);
 win.webContents.on('will-navigate',event=>event.preventDefault());
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.on('resize',sizeView);
 win.on('closed',()=>{for(const t of tabs.values())if(!t.view.webContents.isDestroyed())t.view.webContents.close();tabs.clear();visibleId=null;win=null;});
 win.loadFile(path.join(__dirname,'index.html')).then(()=>{openTab(HOME);publish();});
}
app.whenReady().then(()=>{
 ipcMain.handle('mini:state',event=>{if(!win||event.sender!==win.webContents)throw Error('Unauthorized request.');return snapshot();});
 ipcMain.handle('mini:command',(event,args)=>{if(!win||event.sender!==win.webContents)throw Error('Unauthorized request.');return command(args||{});});
 createWindow();app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)createWindow();});
});
app.on('window-all-closed',()=>app.quit());
