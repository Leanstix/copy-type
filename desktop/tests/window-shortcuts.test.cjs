'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {toggleWindow} = require('../window-shortcuts.cjs');

function fakeWindow({visible = true, minimized = false} = {}) {
  const calls = [];
  return {calls, isDestroyed:()=>false, isVisible:()=>visible, isMinimized:()=>minimized,
    hide(){visible=false;calls.push('hide');},
    restore(){minimized=false;calls.push('restore');},
    show(){visible=true;calls.push('show');},focus(){calls.push('focus');}};
}
test('the toggle hides a visible window and brings it back on the next activation',()=>{
  const window=fakeWindow();toggleWindow(window);toggleWindow(window);
  assert.deepEqual(window.calls,['hide','show','focus']);
});
test('the toggle restores a minimized window instead of hiding it again',()=>{
  const window=fakeWindow({visible:true,minimized:true});toggleWindow(window);
  assert.deepEqual(window.calls,['restore','show','focus']);
});
test('the toggle recovers a hidden minimized window',()=>{
  const window=fakeWindow({visible:false,minimized:true});toggleWindow(window);
  assert.deepEqual(window.calls,['restore','show','focus']);
});
