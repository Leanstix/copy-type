'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {once} = require('node:events');
const {LocalBridge,jsonLines} = require('../local-bridge.cjs');

test('the editor connection requires authentication and restricts its descriptor permissions', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'copytype-bridge-test-'));
  const bridge = new LocalBridge(directory); let socket;
  try {
    await bridge.start();
    assert.equal(fs.statSync(bridge.registry).mode & 0o777, 0o600);
    const attacker = net.createConnection(bridge.socket); await once(attacker, 'connect');
    attacker.write(JSON.stringify({op: 'hello', token: 'wrong'}) + '\n'); await once(attacker, 'close');
    assert.equal(bridge.targets().length, 0);
    socket = net.createConnection(bridge.socket); await once(socket, 'connect');
    const info = JSON.parse(fs.readFileSync(bridge.registry, 'utf8'));
    const ready = new Promise(resolve => jsonLines(socket, message => {
      if (message.op === 'connected') resolve();
      else socket.write(JSON.stringify({id: message.id, ok: true, result: 'acknowledged'}) + '\n');
    }, assert.fail));
    socket.write(JSON.stringify({op: 'hello', token: info.token}) + '\n'); await ready;
    const targetAdded = once(bridge, 'targets');
    socket.write(JSON.stringify({op: 'target', target: {revision: 'selected', label: 'chosen file'}}) + '\n'); await targetAdded;
    assert.equal(await bridge.targets()[0].call('prepare', {session: 'test'}), 'acknowledged');
  } finally { socket?.destroy(); bridge.close(); fs.rmSync(directory, {recursive: true, force: true}); }
});
