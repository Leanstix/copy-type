'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mayWriteClipboard}=require('../browser-permissions.cjs');
test('only the focused active website can write, while clipboard reads remain denied',()=>{
 const web={isDestroyed:()=>false,isFocused:()=>true,getURL:()=> 'https://chatgpt.com/c/example'};
 const context={webContents:web,visible:true,focused:true},details={isMainFrame:true};
 assert.equal(mayWriteClipboard(web,'clipboard-sanitized-write','https://chatgpt.com',details,context),true);
 for(const permission of ['clipboard-read','deprecated-sync-clipboard-read','media','notifications'])assert.equal(mayWriteClipboard(web,permission,'https://chatgpt.com',details,context),false);
 assert.equal(mayWriteClipboard(web,'clipboard-sanitized-write','https://other.example',details,context),false);
 assert.equal(mayWriteClipboard(web,'clipboard-sanitized-write','https://chatgpt.com',{isMainFrame:false},context),false);
 assert.equal(mayWriteClipboard(web,'clipboard-sanitized-write','https://chatgpt.com',details,{...context,focused:false}),false);
 assert.equal(mayWriteClipboard(web,'clipboard-sanitized-write','https://chatgpt.com',details,{...context,webContents:{}}),false);
});
