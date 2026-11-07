const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');

function contentHarness() {
  const listeners = new Map(), messages = [], timers = [];
  let receive;
  const addEventListener = (type, handler) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(handler);
  };
  const emit = (type, event = {}) => {
    for (const handler of listeners.get(type) || []) handler(event);
  };
  class Element {
    constructor() { this.style = {}; }
    append() {}
    appendChild() {}
    addEventListener() {}
    attachShadow() {
      const elements = new Map();
      return {append() {}, getElementById(id) {
        if (!elements.has(id)) elements.set(id, new Element());
        return elements.get(id);
      }};
    }
    closest(selector) { return selector.startsWith('.monaco') ? this : null; }
    matches() { return true; }
    contains(element) { return element === this; }
    dispatchEvent(event) {
      emit('copytype:response', {detail: {...event.detail, ok: true, supported: true, kind: 'Ace'}});
    }
  }
  const document = {hidden: false, addEventListener, createElement: () => new Element(), documentElement: new Element()};
  vm.runInNewContext(readFileSync(require.resolve('../content.js'), 'utf8'), {
    document, window: {addEventListener}, Element,
    crypto: {randomUUID: () => 'test-id'},
    CustomEvent: class { constructor(type, options) { this.detail = options.detail; } },
    setTimeout: handler => { timers.push(handler); return handler; }, clearTimeout() {},
    chrome: {runtime: {
      sendMessage: async message => { messages.push(message); return {ok: true}; },
      onMessage: {addListener: handler => { receive = handler; }}
    }}
  });
  return {document, messages, emit, receive: payload => receive(payload), Element,
    start: async () => {
      receive({type: 'CT_ARMED'});
      const target = new Element();
      emit('click', {composedPath: () => [target]});
      await timers.shift()();
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
  h.emit('focusin', {target});
  assert.equal(h.messages.length, 1);
  h.emit('focusin', {target: new h.Element()});
  assert.deepEqual(h.messages.map(m => m.type), ['START', 'CANCEL']);
});
