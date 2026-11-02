'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const ALLOWED=new Set(['navigate','back','forward','reload','new-tab','close-tab','activate-tab','home']);
contextBridge.exposeInMainWorld('miniBrowser',{
 command:(type,payload=null)=>ALLOWED.has(type)?ipcRenderer.invoke('mini:command',{type,payload}):Promise.reject(Error('Unknown browser command.')),
 onState:callback=>{
  if(typeof callback!=='function')return ()=>{};
  const listener=(_e,state)=>callback(state);ipcRenderer.on('mini:state',listener);
  return ()=>ipcRenderer.removeListener('mini:state',listener);
 },
 ready:()=>ipcRenderer.invoke('mini:state')
});
