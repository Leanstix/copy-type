/* Run with the installed Electron binary, not node --test. Uses only local fixtures. */
'use strict';
const {app,BrowserWindow,ipcMain} = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {TypingController} = require('../typing.cjs');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const windows = [], server = http.createServer((_req,res) => {res.setHeader('Content-Type','text/html');res.end('<title>Typing test</title><textarea id="editor">prefixOLDsuffix</textarea><input type="password" id="password">');});
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}); windows.push(browser);
    await browser.loadURL(`http://127.0.0.1:${server.address().port}`);
    await browser.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname,'../../editor-bridge.js'),'utf8'));
    await browser.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname,'../page-editor.js'),'utf8'));
    const selected = await browser.webContents.executeJavaScript(`(() => {
      const choosing=window.__copyTypeDesktopEditor.choose();
      setTimeout(()=>{const editor=document.getElementById('editor');editor.focus();editor.setSelectionRange(6,9);editor.click();},20);
      return choosing;
    })()`);
    const adapter = {label:'background textarea', call:(op,args)=>browser.webContents.executeJavaScript(`window.__copyTypeDesktopEditor.command(${JSON.stringify(op)},${JSON.stringify({...args,revision:selected.revision})})`)};
    const controller = new TypingController({wait:async()=>{}});
    await controller.start(adapter,'{\n\t🙂é\n}');
    const other = new BrowserWindow({show:false,webPreferences:{sandbox:true}}); windows.push(other);
    await other.loadURL(`http://127.0.0.1:${server.address().port}/other`);
    if(controller.job)await controller.job.completion;
    assert.equal(controller.state.status,'done',controller.state.message);
    assert.equal(await browser.webContents.executeJavaScript('document.getElementById("editor").value'),'prefix{\n\t🙂é\n}suffix');
    await browser.webContents.executeJavaScript('document.getElementById("editor").value += "MANUAL CHANGE"');
    await controller.start(adapter,'should not overwrite');if(controller.job)await controller.job.completion;
    assert.equal(controller.state.status,'error');
    assert.ok((await browser.webContents.executeJavaScript('document.getElementById("editor").value')).endsWith('MANUAL CHANGE'));

    const ui = new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'../preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});windows.push(ui);
    const commands = [];
    const state={activeId:1,tabs:[{id:1,title:'Local test',url:'http://localhost',canGoBack:false,canGoForward:false}],targets:[{id:'test',label:'Selected document'}],typing:{status:'idle'},panelOpen:false};
    ipcMain.handle('mini:state',()=>state);
    ipcMain.handle('mini:command',(_event,command)=>commands.push(command));
    ipcMain.handle('mini:typing',(_event,command)=>{
      commands.push(command);
      if(command.type==='panel'){state.panelOpen=command.payload;ui.webContents.send('mini:state',state);}
    });
    await ui.loadFile(path.join(__dirname,'../index.html'));
    await new Promise(resolve=>setTimeout(resolve,100));
    await ui.webContents.executeJavaScript('document.getElementById("toggleTyping").click()');
    await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(await ui.webContents.executeJavaScript('document.getElementById("typingPanel").hidden'),false);
    await ui.webContents.executeJavaScript('document.getElementById("destination").value="test";document.getElementById("source").value="exact code";document.getElementById("startTyping").click()');
    await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(commands.at(-1).type,'start');assert.equal(commands.at(-1).payload.text,'exact code');
    console.log('PASS: native Chromium exact background entry, drift detection, and typing-panel IPC');
    app.exit(0);
  } catch(error) {console.error(error);app.exit(1);}
  finally {for(const window of windows)if(!window.isDestroyed())window.destroy();server.close();}
});
