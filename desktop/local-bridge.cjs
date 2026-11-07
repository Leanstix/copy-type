'use strict';
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {randomUUID, timingSafeEqual} = require('node:crypto');
const {EventEmitter} = require('node:events');
const {spawn} = require('node:child_process');

class RpcPeer {
  constructor(write) { this.write = write; this.pending = new Map(); this.closed = false; }
  call(op, args = {}) {
    if (this.closed) return Promise.reject(Error('Destination disconnected.'));
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('Destination did not respond.')); }, 10000);
      this.pending.set(id, {resolve, reject, timer}); this.write({id, op, ...args});
    });
  }
  reply(message) {
    const entry = this.pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timer); this.pending.delete(message.id);
    if (message.ok) entry.resolve(message.result);
    else entry.reject(Error(message.error || 'Destination rejected input.'));
  }
  close() {
    this.closed = true;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(Error('Destination disconnected.')); }
    this.pending.clear();
  }
}

function jsonLines(stream, receive, onError) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > 1024 * 1024) { onError(Error('Destination message is too large.')); return; }
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      try { receive(JSON.parse(line)); } catch (error) { onError(error); return; }
    }
  });
}

class LocalBridge extends EventEmitter {
  constructor(directory = process.env.COPYTYPE_RUNTIME_DIR || path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), `copytype-${process.getuid()}`)) {
    super(); this.directory = directory; this.peers = new Map(); this.token = randomUUID();
    this.registry = path.join(directory, 'desktop.json');
    this.socket = path.join(directory, `desktop-${process.pid}.sock`);
  }
  async start() {
    fs.mkdirSync(this.directory, {recursive: true, mode: 0o700});
    const stat = fs.lstatSync(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()) throw Error('Local connection directory is not owned by this user.');
    fs.chmodSync(this.directory, 0o700);
    this.server = net.createServer(socket => this.accept(socket));
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.socket, resolve); });
    fs.chmodSync(this.socket, 0o600);
    fs.writeFileSync(this.registry, JSON.stringify({socket: this.socket, token: this.token}), {mode: 0o600});
    fs.chmodSync(this.registry, 0o600);
  }
  accept(socket) {
    const peer = new RpcPeer(message => socket.write(JSON.stringify(message) + '\n'));
    peer.disconnect = () => socket.destroy();
    peer.id = randomUUID(); peer.target = null;
    let authenticated = false;
    const timer = setTimeout(() => socket.destroy(), 5000);
    jsonLines(socket, message => {
      if (!authenticated) {
        const supplied = Buffer.from(typeof message.token === 'string' ? message.token : '');
        const expected = Buffer.from(this.token);
        if (message.op !== 'hello' || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { socket.destroy(); return; }
        authenticated = true; clearTimeout(timer); this.peers.set(peer.id, peer);
        socket.write(JSON.stringify({op: 'connected'}) + '\n'); return;
      }
      if (message.op === 'target') {
        peer.target = message.target && typeof message.target.revision === 'string' && typeof message.target.label === 'string'
          ? {revision: message.target.revision.slice(0, 80), label: message.target.label.slice(0, 300)} : null;
        this.emit('targets');
      } else peer.reply(message);
    }, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('close', () => { clearTimeout(timer); peer.close(); this.peers.delete(peer.id); this.emit('targets'); });
  }
  targets() {
    return [...this.peers.values()].filter(peer => peer.target).map(peer => {
      const target = {...peer.target};
      return {id: `vscode:${peer.id}:${target.revision}`, label: `VS Code · ${target.label}`, kind: 'VS Code',
        call: (op, args) => peer.call(op, {...args, revision: target.revision})};
    });
  }
  close() {
    for (const peer of this.peers.values()) { peer.close(); peer.disconnect(); }
    this.server?.close();
    try { if (JSON.parse(fs.readFileSync(this.registry, 'utf8')).token === this.token) fs.unlinkSync(this.registry); } catch {}
    try { fs.unlinkSync(this.socket); } catch {}
  }
}

class AccessibilityBridge {
  constructor() { this.child = null; this.items = []; }
  connect() {
    if (this.child) return;
    const child = spawn('/usr/bin/python3', [path.join(__dirname, 'accessibility.py'), String(process.pid)], {stdio: ['pipe', 'pipe', 'pipe']});
    this.child = child;
    this.peer = new RpcPeer(message => child.stdin.write(JSON.stringify(message) + '\n'));
    this.error = '';
    child.stderr.on('data', data => { this.error = (this.error + data.toString()).slice(-1000); });
    jsonLines(child.stdout, message => this.peer.reply(message), () => child.kill());
    child.on('error', () => this.peer.close());
    child.on('exit', () => { this.peer.close(); this.child = null; this.items = []; });
    child.stdin.on('error', () => this.peer.close());
  }
  async refresh() {
    this.connect();
    try { this.items = await this.peer.call('list'); }
    catch (error) { throw Error(this.error ? 'Desktop accessibility is unavailable. Install python3-gi and gir1.2-atspi-2.0.' : error.message); }
    return this.targets();
  }
  targets() { return this.items.map(item => ({id: `desktop:${item.id}`, label: item.label, kind: 'Desktop field', call: (op, args) => this.peer.call(op, {...args, target: item.id})})); }
  close() { this.child?.kill(); }
}
module.exports = {LocalBridge, AccessibilityBridge, RpcPeer, jsonLines};
