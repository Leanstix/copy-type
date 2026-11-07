'use strict';
const {EventEmitter} = require('node:events');
const {randomUUID} = require('node:crypto');
const {MAX_CHARS} = require('../timing.js');

class TypingController extends EventEmitter {
  constructor({wait = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
    super(); this.wait = wait; this.job = null;
    this.state = {status: 'idle', done: 0, total: 0, message: ''};
  }
  update(fields) { Object.assign(this.state, fields); this.emit('state', {...this.state}); }
  async start(adapter, text, rate = 7.5) {
    if (this.job) throw Error('Cancel the current task before starting another.');
    if (typeof text !== 'string' || text.includes('\0')) throw Error('Enter text without NUL characters.');
    const chars = Array.from(text.replace(/\r\n?/g, '\n'));
    if (!chars.length || chars.length > MAX_CHARS) throw Error(`Enter 1–${MAX_CHARS} characters.`);
    if (!Number.isFinite(rate) || rate < 1 || rate > 60) throw Error('Choose a rate between 1 and 60 characters/sec.');
    if (!adapter) throw Error('Choose a destination first.');
    const job = {id: randomUUID(), adapter, cancelled: false, paused: false};
    this.job = job;
    this.update({status: 'preparing', done: 0, total: chars.length, target: adapter.label, message: 'Preparing selected editor…'});
    job.completion = this.run(job, chars, rate);
    return {...this.state};
  }
  async run(job, chars, rate) {
    try {
      await job.adapter.call('prepare', {session: job.id});
      this.update({status: job.cancelled ? 'cancelling' : 'typing', message: 'Typing into the selected editor.'});
      for (const char of chars) {
        while (job.paused && !job.cancelled) await this.wait(50);
        if (job.cancelled) break;
        await job.adapter.call('append', {session: job.id, char});
        this.update({done: this.state.done + 1});
        if (this.state.done < chars.length && !job.cancelled) await this.wait(1000 / rate);
      }
      if (job.cancelled) this.update({status: 'cancelled', message: 'Cancelled. Text already entered was kept.'});
      else {
        await job.adapter.call('complete', {session: job.id});
        this.update({status: 'done', message: 'Finished. Destination text verified.'});
      }
    } catch (error) {
      this.update({status: job.cancelled ? 'cancelled' : 'error', message: String(error.message || error)});
    } finally {
      try { await job.adapter.call('cancel', {session: job.id}); } catch {}
      this.job = null; this.emit('state', {...this.state});
    }
  }
  control(action) {
    if (!this.job) throw Error('No active typing task.');
    if (action === 'cancel') { this.job.cancelled = true; this.job.paused = false; this.update({status: 'cancelling', message: 'Stopping…'}); }
    else if (action === 'pause' || action === 'resume') {
      this.job.paused = action === 'pause';
      this.update({status: this.job.paused ? 'paused' : 'typing', message: this.job.paused ? 'Paused.' : 'Typing into the selected editor.'});
    } else throw Error('Unknown typing control.');
    return {...this.state};
  }
}
module.exports = {TypingController};
