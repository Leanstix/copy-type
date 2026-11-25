const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');

function contentHarness() {
  const listeners = new Map(), messages = [], timers = [];
  let receive, widgetMessage;
  const addEventListener = (type, handler) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(handler);
  };
  const emit = (type, event = {}) => {
    for (const handler of listeners.get(type) || []) handler(event);
  };
  class Element {
    constructor() { this.style = {}; this.isConnected = true; }
    append() {}
    appendChild() {}
    addEventListener() {}
    attachShadow() {
      const elements = new Map();
      return {append() {}, addEventListener() {}, getElementById(id) {
        if (!elements.has(id)) elements.set(id, new Element());
        if (id === 'message') widgetMessage = elements.get(id);
        return elements.get(id);
      }};
    }
    closest(selector) { return selector.startsWith('.monaco') ? this : null; }
    matches(selector) { return selector.startsWith('.monaco'); }
    contains(element) { return element === this; }
    dispatchEvent(event) {
      emit('copytype:response', {detail: {...event.detail, ok: true, supported: true, kind: 'Ace'}});
    }
  }
  const document = {hidden: false, addEventListener, createElement: () => new Element(), documentElement: new Element(), querySelectorAll: () => []};
  const window = {addEventListener, dispatchEvent: Element.prototype.dispatchEvent};
  window.top = window;
  vm.runInNewContext(readFileSync(require.resolve('../content.js'), 'utf8'), {
    document, window,
    crypto: {randomUUID: () => 'test-id'},
    CustomEvent: class { constructor(type, options) { this.detail = options.detail; } },
    setTimeout: handler => { timers.push(handler); return handler; }, clearTimeout() {},
    chrome: {runtime: {
      sendMessage: async message => { messages.push(message); return {ok: true}; },
      onMessage: {addListener: handler => { receive = handler; }}
    }}
  });
  const runTimer = () => timers.shift()();
  return {document, messages, emit, receive: payload => receive(payload), Element, runTimer,
    widgetText: () => widgetMessage.textContent,
    start: async () => {
      receive({type: 'CT_ARMED'});
      const target = new Element();
      document.activeElement = target;
      emit('click', {isTrusted: true, composedPath: () => [target]});
      runTimer();
      await new Promise(resolve => setImmediate(resolve));
      return target;
    }};
}

test('tab visibility changes do not automatically pause or resume a job', async () => {
  const h = contentHarness();
  await h.start();
  assert.equal(h.messages[0].type, 'START');
  h.document.hidden = true;
  h.emit('visibilitychange');
  assert.deepEqual(h.messages.map(m => m.type), ['START']);
  h.receive({type: 'CT_STATE', status: 'paused'});
  h.document.hidden = false;
  h.emit('visibilitychange');
  assert.deepEqual(h.messages.map(m => m.type), ['START']);
});

test('moving focus to another field in the target page still cancels typing', async () => {
  const h = contentHarness();
  const target = await h.start();
  h.emit('focusin', {composedPath: () => [target]});
  assert.equal(h.messages.length, 1);
  h.document.activeElement = new h.Element();
  h.emit('focusin', {composedPath: () => [h.document.activeElement]});
  assert.deepEqual(h.messages.map(m => m.type), ['START', 'CANCEL']);
});

test('a trusted click inside an accessible frame selects its focused editor', async () => {
  const h = contentHarness();
  const target = new h.Element();
  const handlers = new Map();
  const child = {
    activeElement: target,
    querySelectorAll: () => [],
    addEventListener: (type, listener) => handlers.set(type, listener),
  };
  const frame = {contentDocument: child};
  h.document.activeElement = frame;
  h.document.querySelectorAll = () => [frame];
  h.receive({type: 'CT_ARMED'});
  await handlers.get('click')({isTrusted: false, composedPath: () => [target]});
  assert.equal(h.messages.length, 0);
  const start = handlers.get('click')({isTrusted: true, composedPath: () => [target]});
  h.runTimer();
  await start;
  assert.equal(h.messages[0].type, 'START');
});

test('a click on a VS Code workbench without an editable target keeps the queue armed', async () => {
  const h = contentHarness();
  h.receive({type:'CT_ARMED'});
  const workbench = {matches: selector => selector === '.monaco-workbench'};
  h.emit('click', {isTrusted:true, composedPath:() => [workbench]});
  assert.match(h.widgetText(), /Open a writable source file/);
  assert.equal(h.messages.length, 0);

  const editor = new h.Element();
  h.document.activeElement = editor;
  h.emit('click', {isTrusted:true, composedPath:() => [editor, workbench]});
  h.runTimer();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.messages[0].type, 'START');
});

test('a focused frame without an accessible document explains why typing is waiting', () => {
  const h = contentHarness();
  const frame = {matches: selector => selector === 'iframe, frame', contentDocument:null};
  h.document.activeElement = frame;
  h.document.querySelectorAll = () => [frame];
  h.receive({type:'CT_ARMED'});
  assert.match(h.widgetText(), /cannot access the focused embedded frame/);
  assert.equal(h.messages.length, 0);
});
