"""Headless Chrome check for exact entry into an auto-pairing fake Ace editor."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

SOURCE='int f() {\n    if (true) {\n        return 42;\n    }\n}\n'
async def main():
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        page=await browser.new_page()
        await page.set_content('<div class="ace_editor" id="ed"></div>')
        await page.evaluate('''() => {
          const el=document.getElementById('ed');
          let buffer='',caret=0;
          const pos=i=>{const s=buffer.slice(0,i).split('\\n');return {row:s.length-1,column:s.at(-1).length}};
          const idx=p=>buffer.split('\\n').slice(0,p.row).reduce((n,l)=>n+l.length+1,0)+p.column;
          const doc={positionToIndex:idx,indexToPosition:pos};
          const session={getDocument:()=>doc,insert:()=>{},replace:(range,t)=>{
            let a=idx(range.start),b=idx(range.end);
            buffer=buffer.slice(0,a)+t+buffer.slice(b);caret=a+t.length;el.textContent=buffer;return pos(caret);
          }};
          el.env={editor:{getSession:()=>session,getValue:()=>buffer,getSelectionRange:()=>({start:pos(caret),end:pos(caret)}),
            selection:{moveCursorToPosition:p=>caret=idx(p)},clearSelection:()=>{},focus:()=>{}}};
          el.addEventListener('beforeinput',e=>{
            e.preventDefault();let t=e.data||'';
            buffer=buffer.slice(0,caret)+t+(t==='{'?'}':'')+buffer.slice(caret);
            caret+=t.length;el.textContent=buffer;
          });
          window.readText=()=>buffer;
        }''')
        await page.add_script_tag(path=str(Path(__file__).resolve().parents[1]/'editor-bridge.js'))
        result=await page.evaluate('''async (source)=>{
          const el=document.getElementById('ed');let n=0, token='test-token';
          const request=(action,char)=>new Promise(resolve=>{
            const id=String(++n);
            const handler=e=>{if(e.detail.id===id){window.removeEventListener('copytype:response',handler);resolve(e.detail);}};
            window.addEventListener('copytype:response',handler);
            el.dispatchEvent(new CustomEvent('copytype:request',{bubbles:true,detail:{id,token,action,char}}));
          });
          const init=await request('init');
          for (const char of source) {const reply=await request('append',char);if(!reply.ok)throw new Error(JSON.stringify(reply));}
          const final=await request('complete');
          return {init,final,value:window.readText(),expected:source};
        }''',SOURCE)
        assert result['init']['kind']=='Ace',result
        assert result['final']['verified'],result
        assert result['value']==SOURCE,result
        print('PASS: Chromium Ace bridge bypasses auto-pairs and reproduces exact C++ code')
        await browser.close()
asyncio.run(main())
