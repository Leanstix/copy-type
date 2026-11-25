'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const {randomUUID} = require('node:crypto');
const embedded = require('../embedded-editor.js');

const origin = 'https://editor.example.com:8443';
const frames = [
  {frameId:0, parentFrameId:-1, documentId:'workspace', url:'https://workspace.example.com/'},
  {frameId:1, parentFrameId:0, documentId:'editor', url:origin + '/edit'},
  {frameId:2, parentFrameId:1, documentId:'nested', url:origin + '/nested'},
  {frameId:3, parentFrameId:0, documentId:'opaque', url:origin + '/sandbox'},
  {frameId:4, parentFrameId:0, documentId:'wrong-port', url:'https://editor.example.com:8444/'},
  {frameId:5, parentFrameId:0, documentId:'unrelated', url:'https://cdn.example.com/'},
];

test('embedded grant is for an exact host and frame selection filters the exact origin', () => {
  assert.deepEqual(embedded.permission(new URL(origin)), {
    permissions:['webNavigation'], origins:['https://editor.example.com/*'],
  });
  assert.deepEqual(embedded.documentsFor(frames, origin), ['editor', 'opaque']);
  assert.throws(() => embedded.permission(new URL(origin + '/file?session=123')), /origin only/);
  assert.throws(() => embedded.permission(new URL('http://editor.example.com')), /HTTPS/);
});

function worker({allowed = true, focus = true, exposedFrames = frames} = {}) {
  const pageMessages = [];
  const injections = [];
  const input = [];
  const storage = {};
  let receive, finished;
  const completion = new Promise(resolve => { finished = resolve; });
  const chrome = {
    runtime:{
      getURL: path => 'chrome-extension://test/' + path,
      onMessage:{addListener: handler => { receive = handler; }},
    },
    tabs:{
      get: async () => ({url:frames[0].url}),
      sendMessage: async (tabId, payload, target) => {
        pageMessages.push({payload, target});
        if (['done','error','cancelled'].includes(payload.status)) finished(payload);
        if (payload.type === 'CT_EDITOR_COMPLETE') return {ok:true, verified:true};
        if (payload.type === 'CT_CHECK_TARGET') return {ok:focus};
        return {ok:true};
      },
      onUpdated:{addListener() {}},
      onRemoved:{addListener() {}},
    },
    storage:{session:{
      get: async key => ({[key]:storage[key]}),
      set: async values => Object.assign(storage, values),
      remove: async key => { delete storage[key]; },
    }},
    scripting:{
      executeScript: async instruction => {
        injections.push(instruction);
        const documentId = instruction.target.documentIds?.[0] ?? 'workspace';
        if (instruction.func) {
          const frame = exposedFrames.find(frame => frame.documentId === documentId);
          const window = {origin:documentId === 'opaque' ? 'null' : new URL(frame.url).origin};
          const result = vm.runInNewContext(`(${instruction.func})(expected)`, {window, expected:origin});
          return [{documentId, result}];
        }
        return [{documentId}];
      },
    },
    webNavigation:{getAllFrames:async () => exposedFrames},
    permissions:{contains:async () => allowed, onRemoved:{addListener() {}}},
    debugger:{
      attach:async () => {},
      detach:async () => {},
      sendCommand:async (target, method, params) => input.push({target, method, params}),
      onDetach:{addListener() {}},
    },
  };
  const context = vm.createContext({
    chrome, URL, crypto:{randomUUID}, setTimeout: callback => setTimeout(callback, 0),
    importScripts(...paths) {
      for (const path of paths) vm.runInContext(readFileSync(require.resolve('../' + path), 'utf8'), context);
    },
  });
  vm.runInContext(readFileSync(require.resolve('../background.js'), 'utf8'), context);
  const popup = {url:chrome.runtime.getURL('popup.html')};
  const sender = {tab:{id:1}, frameId:1, documentId:'editor', origin};
  const send = (message, from = popup) => new Promise(resolve => receive(message, from, resolve));
  return {
    pageMessages, injections, input, completion,
    arm: (editorOrigin = origin) => send({type:'ARM', tabId:1, text:'λ', mode:'literal', editorOrigin}),
    start: (from = sender, options = {}) => {
      const queueId = pageMessages.find(({payload}) => payload.type === 'CT_ARMED')?.payload.queueId;
      return send({type:'START', queueId, native:true, codeEditor:true, ...options}, from);
    },
    sender,
  };
}

test('embedded jobs send text and verification only to the approved document', {timeout:2000}, async () => {
  const h = worker();
  assert.equal((await h.arm()).ok, true);
  const installed = h.injections.filter(entry => entry.files).map(entry => entry.target.documentIds?.[0] ?? 'workspace');
  assert.deepEqual(installed, ['editor', 'editor', 'workspace', 'workspace']);
  assert.equal((await h.start({...h.sender, documentId:'unrelated'})).ok, false);
  assert.equal((await h.start(h.sender, {queueId:'old-queue'})).ok, false);
  assert.equal((await h.start()).ok, true);
  assert.equal((await h.completion).verified, true);
  const writes = h.pageMessages.filter(({payload}) => ['CT_EDITOR_APPEND','CT_EDITOR_COMPLETE'].includes(payload.type));
  assert.deepEqual(writes.map(({target}) => target.documentId), ['editor','editor']);
  assert.equal(h.input.length, 0);
});

test('denied host access and opaque documents block embedded arming', async () => {
  const denied = worker({allowed:false});
  assert.match((await denied.arm()).error, /Approve access/);
  assert.equal(denied.injections.length, 0);
  const opaque = worker({exposedFrames:[frames[0], frames[3]]});
  assert.match((await opaque.arm()).error, /No accessible editor frame/);
  assert.ok(opaque.injections.every(entry => !entry.files));
});

test('embedded browser input stops before sending text when the document loses focus', {timeout:2000}, async () => {
  const h = worker({focus:false});
  assert.equal((await h.arm()).ok, true);
  assert.equal((await h.start(h.sender, {native:false, codeEditor:false})).ok, true);
  assert.equal((await h.completion).status, 'error');
  assert.equal(h.input.length, 0);
});
