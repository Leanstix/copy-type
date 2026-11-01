'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const CopyTypeBrowser = require('../browser-utils.js');

function fixture() {
  const calls = [];
  const store = {};
  const windows = new Map();
  let receive;
  let removed;
  let number = 10;
  const chrome = {
    runtime: {
      getURL: item => `chrome-extension://copytype/${item}`,
      onMessage: {addListener: callback => { receive = callback; }}
    },
    windows: {
      create: async spec => {
        const window = {id: ++number, type: spec.type, incognito: false, tabs: [{id:100}]};
        windows.set(window.id, window); calls.push(['new-window',spec]); return window;
      },
      get: async id => { if (!windows.has(id)) throw Error('Not found'); return windows.get(id); },
      update: async (id,spec) => {calls.push(['focus-window',id,spec]);},
      onRemoved: {addListener: fn => {removed=fn;}}
    },
    tabs: {
      create: async spec => {calls.push(['new-tab',spec]);return {id:101};},
      update: async (id,spec) => {calls.push(['pin',id,spec]);},
      sendMessage: async () => {},
      onRemoved: {addListener: () => {}},
      onUpdated: {addListener: () => {}}
    },
    storage: {session: {
      get: async key => ({[key]: store[key]}),
      set: async pairs => {Object.assign(store, pairs);},
      remove: async key => {delete store[key];}
    }},
    debugger: {onDetach: {addListener: () => {}}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), {
    chrome, CopyTypeBrowser, importScripts: () => {}, setTimeout, console
  });
  const send = (input, sender='chrome-extension://copytype/popup.html') => new Promise(resolve => {
    receive({type:'OPEN_WORKSPACE',input}, {url: sender}, resolve);
  });
  return {calls,store,windows,send,removed: (...args) => removed(...args)};
}

test('opens compact Chrome normal window and a real tab', async () => {
  const f = fixture();
  const result = await f.send('chatgpt.com');
  assert.equal(result.ok,true);
  assert.equal(f.calls[0][1].type,'normal');
  assert.equal(f.calls[0][1].url,'chrome-extension://copytype/workspace.html');
  assert.equal(f.calls.find(c=>c[0]==='new-tab')[1].url,'https://chatgpt.com/');
});
test('reuses the same compact window rather than creating a second one', async () => {
  const f = fixture();
  await f.send('');
  await f.send('github.com');
  assert.equal(f.calls.filter(c=>c[0]==='new-window').length,1);
  assert.equal(f.calls.filter(c=>c[0]==='focus-window').length,1);
  assert.equal(f.calls.filter(c=>c[0]==='new-tab').length,1);
});
test('recreates workspace if previous window was closed', async () => {
  const f = fixture();
  await f.send('');
  f.windows.clear();
  await f.send('google.com');
  assert.equal(f.calls.filter(c=>c[0]==='new-window').length,2);
});
test('rejects unsafe schemes without opening tabs or windows', async () => {
  const f = fixture();
  const result = await f.send('javascript:alert(1)');
  assert.equal(result.ok,false);
  assert.equal(f.calls.length,0);
});
test('rejects external messages from non-extension documents', async () => {
  const f = fixture();
  const result = await f.send('chatgpt.com','https://random-site.example/');
  assert.equal(result.ok,false);
  assert.equal(f.calls.length,0);
});
test('cleans up saved workspace ID after window close', async () => {
  const f = fixture();
  const result = await f.send('');
  await f.removed(result.windowId);
  assert.equal(f.store['copytype:workspace-window'],undefined);
});
