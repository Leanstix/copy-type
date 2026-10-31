const {test} = require('node:test');
const assert = require('node:assert/strict');
const {findAdapter,makeSession} = require('../editor-bridge.js');

const cpp = '#include <bits/stdc++.h>\nusing namespace std;\n\nstruct FastScanner {\n    inline int nextInt() {\n        int x = 0;\n        do {\n            x++;\n        } while (x < 20);\n        return x;\n    }\n};\n';
function posOf(text, idx) {
  const before=text.slice(0,idx), lines=before.split('\n');
  return {row: lines.length-1,column:lines[lines.length-1].length};
}
function indexOf(text,p) {
  const lines=text.split('\n');
  return lines.slice(0,p.row).reduce((n,line)=>n+line.length+1,0)+p.column;
}
function fakeAce(initial, from=initial.length, to=from) {
  let text=initial;
  let range={start:posOf(text,from),end:posOf(text,to)};
  const doc={positionToIndex:p=>indexOf(text,p),indexToPosition:i=>posOf(text,i)};
  const session={getDocument:()=>doc,insert:()=>{throw new Error('Unexpected insert')},replace: (r,s)=>{
    const a=indexOf(text,r.start),b=indexOf(text,r.end);
    text=text.slice(0,a)+s+text.slice(b);
    return posOf(text,a+s.length);
  }};
  const editor={getValue:()=>text,getSession:()=>session,getSelectionRange:()=>range,
    selection:{moveCursorToPosition:p=>{range={start:p,end:p};}},clearSelection:()=>{},focus:()=>{}};
  const el={env:{editor}};
  return {element:{closest:s=>s==='.ace_editor'?el:null},value:()=>text};
}
function fakeCM5(initial) {
  let text=initial,cursor=0;
  const cm={getValue:()=>text,getCursor:()=>{const p=posOf(text,cursor);return {line:p.row,ch:p.column};},indexFromPos:p=>indexOf(text,{row:p.line,column:p.ch}),
    posFromIndex:i=>{const p=posOf(text,i);return {line:p.row,ch:p.column};},
    replaceRange:(s,p,q)=>{const a=indexOf(text,{row:p.line,column:p.ch}),b=indexOf(text,{row:q.line,column:q.ch});text=text.slice(0,a)+s+text.slice(b);},
    setCursor:p=>{cursor=indexOf(text,{row:p.line,column:p.ch});},focus:()=>{}};
  return {element:{closest:s=>s==='.CodeMirror'?{CodeMirror:cm}:null},value:()=>text};
}
function fakeCM6(initial) {
  let text=initial,from=0,to=0;
  const view={get state(){return {doc:{toString:()=>text},selection:{main:{from,to}}};},
    dispatch:spec=>{const {from:f,to:t,insert}=spec.changes;text=text.slice(0,f)+insert+text.slice(t);from=to=spec.selection.anchor;},focus:()=>{}};
  const el={querySelector:s=>s==='.cm-content'?{cmView:{view}}:null};
  return {element:{closest:s=>s==='.cm-editor'?el:null},value:()=>text};
}
function fakeMonaco(initial) {
  let text=initial,offset=0;
  const positionAt=i=>{const p=posOf(text,i);return {lineNumber:p.row+1,column:p.column+1};};
  const offsetAt=p=>indexOf(text,{row:p.lineNumber-1,column:p.column-1});
  const model={getValue:()=>text,getPositionAt:positionAt,getOffsetAt:offsetAt};
  const dom={};
  const editor={getDomNode:()=>dom,getModel:()=>model,getSelection:()=>({getStartPosition:()=>positionAt(offset),getEndPosition:()=>positionAt(offset)}),
    executeEdits:(source,edits)=>{const {range,text:insert}=edits[0];const a=offsetAt({lineNumber:range.startLineNumber,column:range.startColumn}),b=offsetAt({lineNumber:range.endLineNumber,column:range.endColumn});text=text.slice(0,a)+insert+text.slice(b);return true;},
    setPosition:p=>{offset=offsetAt(p);},focus:()=>{}};
  const old=global.monaco;
  global.monaco={editor:{getEditors:()=>[editor]}};
  return {element:{closest:s=>s==='.monaco-editor'?dom:null},value:()=>text,restore:()=>{global.monaco=old;}};
}
for (const [name,make] of Object.entries({Ace:fakeAce,CodeMirror5:fakeCM5,CodeMirror6:fakeCM6,Monaco:fakeMonaco})) {
  test(`${name} reproduces C++ exactly: no extra indentation or bracket pairs`,()=>{
    const target=make('');
    try {
      const adapter=findAdapter(target.element);
      assert.ok(adapter,`Missing ${name} adapter`);
      const session=makeSession(adapter);
      for(const char of cpp) session.append(char);
      assert.deepEqual(session.complete(),{verified:true,characters:cpp.length});
      assert.equal(target.value(),cpp);
    } finally {target.restore?.();}
  });
}

test('Ace preserves prefix/suffix outside selected range',()=>{
  const target=fakeAce('prefix(OLD)suffix',7,10);
  const session=makeSession(findAdapter(target.element));
  for (const char of '{\n  x();\n}') session.append(char);
  assert.deepEqual(session.complete(),{verified:true,characters:10});
  assert.equal(target.value(),'prefix({\n  x();\n})suffix');
});

test('Ace reconciliation fixes an editor plugin which altered source',()=>{
  const target=fakeAce('');
  const adapter=findAdapter(target.element);
  const original=adapter.insert;
  let drift=true;
  adapter.insert=(from,to,s)=>{original(from,to,s);if(drift && s==='{'){drift=false;const actual=adapter.read();original(actual.length,actual.length,'}');}};
  const session=makeSession(adapter);
  for(const char of 'int f() {\n    return 1;\n}\n') session.append(char);
  assert.deepEqual(session.complete().verified,true);
  assert.equal(target.value(),'int f() {\n    return 1;\n}\n');
});

test('adapter rejects non-code editors instead of editing a DOM projection',()=>{
  assert.equal(findAdapter({closest:()=>null}),null);
});
