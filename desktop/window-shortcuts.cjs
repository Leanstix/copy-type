'use strict';
const {spawn} = require('node:child_process');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {jsonLines} = require('./local-bridge.cjs');

function toggleWindow(window) {
  if (!window || window.isDestroyed()) return;
  if (window.isVisible() && !window.isMinimized()) window.hide();
  else { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
}

class KdeShortcuts extends EventEmitter {
  start() {
    return new Promise((resolve, reject) => {
      const child = spawn('/usr/bin/python3', [path.join(__dirname, 'kde-shortcuts.py'), String(process.pid)], {stdio: ['pipe', 'pipe', 'pipe']});
      this.child = child;
      let ready = false, errorText = '';
      const timer = setTimeout(() => { child.kill(); reject(Error('KDE shortcut connection timed out.')); }, 10000);
      child.stderr.on('data', data => { errorText = (errorText + data.toString()).slice(-1000); });
      jsonLines(child.stdout, message => {
        if (message.event === 'ready') { ready = true; clearTimeout(timer); resolve(); }
        else if (message.event === 'action') this.emit('action', message.action);
        else if (message.event === 'error') { clearTimeout(timer); reject(Error(message.message)); child.kill(); }
      }, error => { clearTimeout(timer); reject(error); child.kill(); });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('exit', () => {
        clearTimeout(timer);
        if (!ready) reject(Error(errorText || 'KDE shortcut connection closed before it was ready.'));
        else if (!this.stopping) this.emit('disconnected');
      });
    });
  }
  close() { this.stopping = true; this.child?.kill(); }
}
module.exports = {KdeShortcuts, toggleWindow};
