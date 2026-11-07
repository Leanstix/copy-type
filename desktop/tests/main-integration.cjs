/* Exercise the actual app main process with a local website and isolated profile. */
'use strict';
const {app,BrowserWindow,WebContentsView} = require('electron');
const http = require('node:http');
const assert = require('node:assert/strict');
const server = http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<title>Main-process fixture</title><textarea id="editor">before OLD after</textarea>');});
const wait = ms=>new Promise(resolve=>setTimeout(resolve,ms));
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
    await window.webContents.executeJavaScript('window.miniBrowser.typing("panel",true)');
    await wait(50);
    assert.equal(await window.webContents.executeJavaScript('document.getElementById("typingPanel").hidden'),false);
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
    console.log('PASS: actual desktop app selection, panel layout, target pinning across tabs, and exact typing');
    server.close();app.quit();
  } catch(error){console.error(error);server.close();app.exit(1);}
});
