'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {workspaceFile}=require('../vscode/files.cjs');
test('new files stay inside their selected workspace, including symbolic-link parents',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'copytype-paths-'));
 const outside=fs.mkdtempSync(path.join(os.tmpdir(),'copytype-outside-'));
 try{
  assert.equal(workspaceFile(root,'src/example.js'),path.join(root,'src/example.js'));
  for(const name of ['../escape.js','/tmp/escape.js','C:\\escape.js','src/../../escape.js','src//file.js',''])assert.throws(()=>workspaceFile(root,name));
  fs.symlinkSync(outside,path.join(root,'outside'));
  assert.throws(()=>workspaceFile(root,'outside/file.js'),/symbolic link/);
 }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});}
});
