'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {TypingController} = require('../typing.cjs');
const finish = async controller => { if (controller.job) await controller.job.completion; };

test('Unicode and line breaks are delivered exactly to a pinned background destination', async () => {
  const operations = [], target = {label: 'pinned', call: async (op, args) => { operations.push([op, args]); }};
  const controller = new TypingController({wait: async () => {}});
  await controller.start(target, 'é🙂\r\n{\n\t}', 60); await finish(controller);
  assert.equal(operations.filter(([op]) => op === 'append').map(([,args]) => args.char).join(''), 'é🙂\n{\n\t}');
  assert.equal(controller.state.status, 'done');
  assert.equal(operations.at(-2)[0], 'complete');
  assert.equal(operations.at(-1)[0], 'cancel');
});

test('cancelling a paused job keeps partial text and does not complete or retarget it', async () => {
  const controller = new TypingController({wait: async () => {}});
  let typed = '', completed = false;
  await controller.start({label: 'original', call: async op => {
    if (op === 'append') { typed += 'a'; controller.control('pause'); controller.control('cancel'); }
    if (op === 'complete') completed = true;
  }}, 'abc');
  await finish(controller);
  assert.equal(typed, 'a'); assert.equal(completed, false); assert.equal(controller.state.status, 'cancelled');
});

test('destination errors stop immediately without overwriting or retrying', async () => {
  let writes = 0;
  const controller = new TypingController({wait: async () => {}});
  await controller.start({label: 'document', call: async op => { if (op === 'append') { writes++; throw Error('Document changed'); } }}, 'abc');
  await finish(controller);
  assert.equal(writes, 1); assert.equal(controller.state.status, 'error'); assert.equal(controller.state.message, 'Document changed');
});
