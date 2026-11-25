"""Check the cross-world bridge against an Ace fixture in a same-origin iframe."""
import asyncio
import json
import os
from pathlib import Path
from playwright.async_api import async_playwright

SOURCE='int f() {\n    if (true) {\n        return 42;\n    }\n}\n'
async def main():
    async with async_playwright() as p:
        browser=await p.chromium.launch(
            headless=True,
            executable_path=os.environ.get('COPYTYPE_CHROMIUM', '/usr/bin/chromium'),
            args=['--no-sandbox'],
        )
        page=await browser.new_page()
        await page.set_content('<iframe srcdoc=\'<div class="ace_editor" id="ed" tabindex="0"></div>\'></iframe>')
        target=page.frame_locator('iframe').locator('#ed')
        await target.focus()
        frame=page.frames[1]
        await frame.evaluate('''() => {
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
        client=await page.context.new_cdp_session(page)
        frame_id=(await client.send('Page.getFrameTree'))['frameTree']['frame']['id']
        world=(await client.send('Page.createIsolatedWorld', {
            'frameId': frame_id,
            'worldName': 'CopyType test',
        }))['executionContextId']
        run='''async (source)=>{
          let n=0, token='test-token';
          const request=(action,char)=>new Promise((resolve,reject)=>{
            const id=String(++n);
            const deadline=setTimeout(()=>{
              window.removeEventListener('copytype:response',handler);
              reject(new Error('No bridge response for '+action));
            },1500);
            const handler=e=>{
              if(e.detail.id!==id)return;
              clearTimeout(deadline);
              window.removeEventListener('copytype:response',handler);
              resolve(e.detail);
            };
            window.addEventListener('copytype:response',handler);
            window.dispatchEvent(new CustomEvent('copytype:request',{detail:{id,token,action,char}}));
          });
          const init=await request('init');
          for (const char of source) {const reply=await request('append',char);if(!reply.ok)throw new Error(JSON.stringify(reply));}
          const final=await request('complete');
          return {init,final};
        }'''
        reply=await client.send('Runtime.evaluate', {
            'expression': f'({run})({json.dumps(SOURCE)})',
            'contextId': world,
            'awaitPromise': True,
            'returnByValue': True,
        })
        assert 'exceptionDetails' not in reply, reply
        result=reply['result']['value']
        assert result['init']['kind']=='Ace',result
        assert result['final']['verified'],result
        assert await frame.evaluate('window.readText()')==SOURCE,result
        print('PASS: Chromium bridge reproduces exact C++ across worlds in a focused iframe')
        await browser.close()
asyncio.run(main())
