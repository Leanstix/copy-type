/* Exercise the actual app main process with a local website and isolated profile. */
'use strict';
const {app,BrowserWindow,WebContentsView,clipboard,ClipboardItem} = require('electron');
const http = require('node:http');
const assert = require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const {jsonLines}=require('../local-bridge.cjs');
const {execFileSync}=require('node:child_process');
const os=require('node:os');
const server = http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<title>Main-process fixture</title><textarea id="editor">before OLD after</textarea><button id="copy" onclick="navigator.clipboard.writeText('CopyType clipboard fixture').then(()=>this.dataset.result='copied',error=>this.dataset.result=error.message)">Copy code</button>`);});
const wait = ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fakeVSCode(label){
 const info=JSON.parse(fs.readFileSync(path.join(process.env.COPYTYPE_RUNTIME_DIR,'desktop.json'),'utf8'));
 const socket=net.createConnection(info.socket),requests=[];
 const catalog={label,folders:[{id:'file:///tmp/'+label,label}],tabs:[{id:'active',label:'active.js',active:true},{id:'background',label:'background.js',active:false}]};
 await new Promise((resolve,reject)=>{
  socket.on('error',reject);
  jsonLines(socket,message=>{
   if(message.op==='connected'){socket.write(JSON.stringify({op:'catalog',catalog})+'\n');resolve();return;}
   requests.push(message);let result=true;
   if(message.op==='list-tabs')result=catalog;
   if(message.op==='create-file'){
    const id='created-'+requests.length;catalog.tabs.forEach(tab=>tab.active=false);catalog.tabs.push({id,label:message.untitled?'Untitled test':message.name,active:true});
    socket.write(JSON.stringify({op:'catalog',catalog})+'\n');result={tabId:id};
   }
   socket.write(JSON.stringify({id:message.id,ok:true,result})+'\n');
  },reject);
  socket.on('connect',()=>socket.write(JSON.stringify({op:'hello',token:info.token})+'\n'));
 });return {socket,requests};
}
server.listen(0,'127.0.0.1',async()=>{
  process.env.COPYTYPE_START_URL=`http://127.0.0.1:${server.address().port}`;
  require('../main.cjs');
  try {
    await app.whenReady();
    let window;
    for(let i=0;i<100;i++){window=BrowserWindow.getAllWindows()[0];if(window&&window.contentView.children.some(child=>child instanceof WebContentsView))break;await wait(100);}
    assert.ok(window);
    const website=window.contentView.children.find(child=>child instanceof WebContentsView).webContents;
    for(let i=0;i<100&&website.isLoading();i++)await wait(50);
    window.show();window.focus();
    if(process.env.XDG_CURRENT_DESKTOP?.split(':').includes('KDE')){
      const directory=fs.mkdtempSync(path.join(os.tmpdir(),'copytype-focus-test-')),script=path.join(directory,'focus.js'),name='copytype-focus-test-'+process.pid;
      fs.writeFileSync(script,`for(const window of workspace.windowList())if(window.pid===${process.pid}){if(typeof workspace.activateWindow==='function')workspace.activateWindow(window);else workspace.activeWindow=window;}`);
      try{
        const id=execFileSync('qdbus6',['org.kde.KWin','/Scripting','org.kde.kwin.Scripting.loadScript',script,name],{encoding:'utf8'}).trim();
        execFileSync('qdbus6',['org.kde.KWin','/Scripting/Script'+id,'org.kde.kwin.Script.run']);
      }finally{execFileSync('qdbus6',['org.kde.KWin','/Scripting','org.kde.kwin.Scripting.unloadScript',name]);fs.rmSync(directory,{recursive:true,force:true});}
    }
    for(let i=0;i<100&&!window.isFocused();i++)await wait(20);
    assert.equal(window.isFocused(),true,'Copy test requires its disposable native window focused');
    const previousClipboard=await Promise.all((await clipboard.read()).filter(item=>item.types.length).map(async item=>new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)]))))));
    try{
      window.show();window.focus();
      // Start with shell focus, just as after entering text in CopyType's panel.
      window.webContents.focus();
      const point=await website.executeJavaScript('(()=>{const r=document.getElementById("copy").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
      website.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});website.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});
      let copied;
      for(let i=0;i<80;i++){copied=await website.executeJavaScript('document.getElementById("copy").dataset.result');if(copied)break;await wait(50);}
      assert.equal(copied,'copied');assert.equal(await clipboard.readText(),'CopyType clipboard fixture');
      const read=await website.executeJavaScript('navigator.clipboard.readText().then(()=>"allowed",()=>"denied")');assert.equal(read,'denied');
    }finally{if(previousClipboard.length)await clipboard.write(previousClipboard);else await clipboard.clear();}
    await window.webContents.executeJavaScript('window.miniBrowser.typing("panel",true)');
    await wait(50);
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("typingPanel").hidden'),false);
    const first=await fakeVSCode('Workspace-A');await wait(80);
    let discovered=await window.webContents.executeJavaScript('window.miniBrowser.ready()');
    const windowA=discovered.vscodeWindows[0].id;
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("vscodeWindow").value'),windowA);
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("destination").options.length'),3);
    const second=await fakeVSCode('Workspace-B');await wait(80);
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("vscodeWindow").value'),'');
    await window.webContents.executeJavaScript(`document.getElementById('vscodeWindow').value=${JSON.stringify(windowA)};document.getElementById('vscodeWindow').dispatchEvent(new Event('change'));document.getElementById('destination').value=${JSON.stringify(`vscode:${windowA}:background`)};document.getElementById('destination').dispatchEvent(new Event('change'));`);
    await wait(100);assert.ok(first.requests.some(request=>request.op==='select-tab'&&request.tabId==='background'));
    await window.webContents.executeJavaScript('document.getElementById("newFileOptions").open=true;document.getElementById("newFilename").value="src/new.js";document.getElementById("newFilename").dispatchEvent(new Event("input"));document.getElementById("createVsFile").click()');
    await wait(150);
    assert.ok(first.requests.some(request=>request.op==='create-file'&&request.name==='src/new.js'));
    assert.equal(second.requests.some(request=>request.op==='create-file'),false);
    assert.match(await window.webContents.executeJavaScript('document.getElementById("destination").selectedOptions[0].textContent'),/src\/new.js/);
    await window.webContents.executeJavaScript('document.getElementById("newVsTab").click()');await wait(100);
    assert.ok(first.requests.some(request=>request.op==='create-file'&&request.untitled));
    first.socket.destroy();second.socket.destroy();await wait(50);
    const selecting=window.webContents.executeJavaScript('window.miniBrowser.typing("select-browser")');
    await wait(100);
    await website.executeJavaScript('const field=document.getElementById("editor");field.focus();field.setSelectionRange(7,10);field.click()');
    await selecting;
    const state=await window.webContents.executeJavaScript('window.miniBrowser.ready()');
    assert.equal(state.targets.length,1);
    const input='{\n\t🙂\n}';
    await window.webContents.executeJavaScript(`window.miniBrowser.typing('start',${JSON.stringify({target:state.targets[0].id,text:input,rate:60})})`);
    await window.webContents.executeJavaScript('window.miniBrowser.command("new-tab")');
    let finished;
    for(let i=0;i<100;i++){finished=await window.webContents.executeJavaScript('window.miniBrowser.ready()');if(!finished.typing.busy)break;await wait(50);}
    assert.equal(finished.typing.status,'done',finished.typing.message);
    assert.equal(await website.executeJavaScript('document.getElementById("editor").value'),'before '+input+' after');
    console.log('PASS: real desktop UI auto-selects one VS Code window, requires a choice for two, opens tabs, creates files/tabs in the chosen window, and preserves copy-button/typing behavior');
    server.close();app.quit();
  } catch(error){console.error(error);server.close();app.exit(1);}
});
