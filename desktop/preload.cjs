'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const ALLOWED=new Set(['navigate','back','forward','reload','new-tab','close-tab','activate-tab','home']);
const TYPING=new Set(['panel','start','pause','resume','cancel','desktop-fields','select-browser','vscode-refresh','vscode-select','vscode-create']);
contextBridge.exposeInMainWorld('miniBrowser',{
 command:(type,payload=null)=>ALLOWED.has(type)?ipcRenderer.invoke('mini:command',{type,payload}):Promise.reject(Error('Unknown browser command.')),
 typing:(type,payload=null)=>TYPING.has(type)?ipcRenderer.invoke('mini:typing',{type,payload}):Promise.reject(Error('Unknown typing command.')),
 onFocusAddress:callback=>{if(typeof callback!=='function')return;ipcRenderer.on('mini:focus-address',()=>callback());},
 onState:callback=>{
  if(typeof callback!=='function')return ()=>{};
  const listener=(_e,state)=>callback(state);ipcRenderer.on('mini:state',listener);
  return ()=>ipcRenderer.removeListener('mini:state',listener);
 },
 ready:()=>ipcRenderer.invoke('mini:state')
});
