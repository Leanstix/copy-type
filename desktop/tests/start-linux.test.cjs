'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const launcher=path.join(__dirname,'..','start-linux.sh');
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'copytype-sandbox-'));
  fs.copyFileSync(launcher,path.join(dir,'start-linux.sh'));
  fs.mkdirSync(path.join(dir,'bin'));
  fs.mkdirSync(path.join(dir,'node_modules','.bin'),{recursive:true});
  fs.mkdirSync(path.join(dir,'node_modules','electron','dist'),{recursive:true});
  const electron=path.join(dir,'node_modules','.bin','electron');
  fs.writeFileSync(electron,'#!/bin/sh\nexit 0\n',{mode:0o755});
  fs.chmodSync(electron,0o755);
  const helper=path.join(dir,'node_modules','electron','dist','chrome-sandbox');
  const log=path.join(dir,'npm.log');
  const npm=path.join(dir,'bin','npm');
  fs.writeFileSync(npm,'#!/bin/sh\nprintf "%s\\n" "$*" >> "$COPYTYPE_TEST_LOG"\nexit 0\n',{mode:0o755});
  fs.chmodSync(npm,0o755);
  return {
    dir,helper,log,
    launch(){return spawnSync('bash',[path.join(dir,'start-linux.sh')],{
      cwd:'/',encoding:'utf8',env:{...process.env,PATH:path.join(dir,'bin')+":"+process.env.PATH,COPYTYPE_TEST_LOG:log}
    });},
    calledNpm(){return fs.existsSync(log)?fs.readFileSync(log,'utf8'):'';},
    cleanup(){fs.rmSync(dir,{recursive:true,force:true});}
  };
}

test('unconfigured helper refuses to start unsandboxed in noninteractive mode',()=>{
  const f=fixture();
  try{
    fs.writeFileSync(f.helper,'placeholder',{mode:0o755});
    fs.chmodSync(f.helper,0o755);
    const r=f.launch();
    assert.equal(r.status,1);
    assert.match(r.stderr,/mode 4755/);
    assert.match(r.stderr,/one-time sudo setup/);
    assert.equal(f.calledNpm(),'');
  }finally{f.cleanup();}
});

test('missing helper is rejected before Electron starts',()=>{
  const f=fixture();
  try{
    const r=f.launch();
    assert.equal(r.status,1);
    assert.match(r.stderr,/sandbox helper is missing/);
    assert.equal(f.calledNpm(),'');
  }finally{f.cleanup();}
});

test('symlink helper is rejected instead of modifying an arbitrary target',()=>{
  const f=fixture();
  try{
    const target=path.join(f.dir,'target');
    fs.writeFileSync(target,'placeholder',{mode:0o755});
    fs.symlinkSync(target,f.helper);
    const r=f.launch();
    assert.equal(r.status,1);
    assert.match(r.stderr,/symlink/);
    assert.equal(f.calledNpm(),'');
  }finally{f.cleanup();}
});

test('correctly configured sandbox helper launches Electron without sudo', {skip:process.getuid?.()!==0?'requires root ownership fixture':false},()=>{
  const f=fixture();
  try{
    fs.writeFileSync(f.helper,'placeholder',{mode:0o755});
    fs.chmodSync(f.helper,0o4755);
    const r=f.launch();
    assert.equal(r.status,0,r.stderr);
    assert.equal(f.calledNpm(),'start\n');
  }finally{f.cleanup();}
});
