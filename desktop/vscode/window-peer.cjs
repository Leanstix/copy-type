'use strict';
const vscode=require('vscode'),fs=require('node:fs'),path=require('node:path');
async function run(){
 await vscode.extensions.getExtension('copytype-local.copytype-editor').activate();
 const document=await vscode.workspace.openTextDocument({content:'Second window test'});
 await vscode.window.showTextDocument(document,{preview:false});
 const runtime=process.env.COPYTYPE_RUNTIME_DIR;
 for(let i=0;i<600&&!fs.existsSync(path.join(runtime,'finish-second'));i++)await new Promise(resolve=>setTimeout(resolve,100));
 fs.writeFileSync(path.join(runtime,'second-finished'),'done');
}
module.exports={run};
