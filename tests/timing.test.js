const {test} = require('node:test');
const assert = require('node:assert/strict');
const pacing = require('../timing.js');
test('counts Unicode codepoints instead of UTF-16 halves',()=>assert.equal(pacing.countCharacters('a😀b'),3));
test('normalizes CRLF and CR line breaks',()=>assert.equal(pacing.countCharacters('a\r\nb\rc'),5));
test('short text uses a plausible pace',()=>assert.equal(pacing.secondsForCount(750),100));
test('long code is scheduled for approximately five minutes',()=>assert.equal(pacing.secondsForCount(2000),300));
test('very long text is not rushed beyond the rate cap',()=>assert.ok(pacing.secondsForCount(24000)>=2000));
test('pacing delays preserve the total target duration',()=>{
  const chars=Array.from('function x() {\n  return 1;\n}');
  const delays=pacing.makeDelays(chars,12000,()=>0.5);
  assert.equal(delays.length,chars.length);
  assert.ok(Math.abs(delays.reduce((a,b)=>a+b,0)-12000)<1);
});
test('empty input produces no delays',()=>assert.deepEqual(pacing.makeDelays([],0),[]));
test('invalid character counts are rejected',()=>assert.throws(()=>pacing.secondsForCount(-2),RangeError));
