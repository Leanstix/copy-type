'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const viewerModule = require('../viewer');
const {resolveInput} = require('../browser-utils');
function setup() {
  const calls=[]; let next=100;
  const chrome={
    tabs:{create:async opts=>{calls.push(['tab-create',opts]);return{id:next++}},remove:async id=>{calls.push(['tab-remove',id])}},
    debugger:{attach:async(t,v)=>calls.push(['attach',t,v]),detach:async t=>calls.push(['detach',t]),
      sendCommand:async(t,method,params)=>{calls.push([method,t,params]);if(method==='Page.captureScreenshot')return {data:'mock-image'};if(method==='Page.getNavigationHistory')return {currentIndex:1,entries:[{id:10,url:'https://one.example/'},{id:11,url:'https://two.example/'},{id:12,url:'https://three.example/'}]};return {}}}
  };
  return {viewer:viewerModule.create(chrome,resolveInput),calls};
}
test('opens a background tab only, not a new window',async()=>{
  const {viewer,calls}=setup();
  await viewer.open('https://chatgpt.com');
  assert.deepEqual(calls[0],['tab-create',{url:'https://chatgpt.com/',active:false}]);
  assert.equal(calls.some(c=>c[0]==='window-create'),false);
  assert.equal(viewer.status().open,true);
});
test('captures image data without inspecting cookies',async()=>{
  const {viewer,calls}=setup();await viewer.open('example.com');
  const frame=await viewer.capture();
  assert.equal(frame.image,'data:image/jpeg;base64,mock-image');
  assert.equal(calls.some(c=>c[0].includes('Cookies')||c[0].includes('Storage')),false);
});
test('reuses the same tab and navigates rather than spawning tabs',async()=>{
  const {viewer,calls}=setup();await viewer.open('github.com');await viewer.open('chatgpt.com');
  assert.equal(calls.filter(c=>c[0]==='tab-create').length,1);
  assert.equal(calls.filter(c=>c[0]==='Page.navigate').length,1);
});
test('rejects unsafe browser destinations before opening',async()=>{
  const {viewer,calls}=setup();await assert.rejects(()=>viewer.open('javascript:alert(1)'));
  assert.equal(calls.length,0);
});
test('click coordinates are validated',async()=>{
  const {viewer,calls}=setup();await viewer.open('example.com');
  await assert.rejects(()=>viewer.interact({action:'click',x:2000,y:100}));
  await viewer.interact({action:'click',x:50,y:80});
  assert.equal(calls.filter(c=>c[0]==='Input.dispatchMouseEvent').length,2);
});
test('rejects oversized typed text',async()=>{
  const {viewer,calls}=setup();await viewer.open('example.com');
  await assert.rejects(()=>viewer.interact({action:'text',text:'x'.repeat(5001)}));
  assert.equal(calls.some(c=>c[0]==='Input.insertText'),false);
});
test('text and Enter go through the CDP input interface',async()=>{
  const {viewer,calls}=setup();await viewer.open('example.com');
  await viewer.interact({action:'text',text:'hello'});
  await viewer.interact({action:'key',key:'Enter'});
  assert.deepEqual(calls.find(c=>c[0]==='Input.insertText')[2],{text:'hello'});
  assert.equal(calls.filter(c=>c[0]==='Input.dispatchKeyEvent').length,2);
});
test('close removes its owned background tab',async()=>{
  const {viewer,calls}=setup();await viewer.open('example.com');await viewer.dispose(true);
  assert.equal(viewer.status().open,false);
  assert.equal(calls.filter(c=>c[0]==='tab-remove').length,1);
});
test('browser tab closure cleans up state',async()=>{
  const {viewer}=setup();await viewer.open('example.com');viewer.onRemoved(100);
  assert.equal(viewer.status().open,false);
});
test('debugger detachment cleans up state',async()=>{
  const {viewer}=setup();await viewer.open('example.com');viewer.onDetach(100);
  assert.equal(viewer.status().open,false);
});
