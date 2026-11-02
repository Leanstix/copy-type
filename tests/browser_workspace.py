"""Chromium UI smoke test with mocked Chrome extension API. Does not test installed extension or login."""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
MOCK_CHROME='''
window.__calls=[];
window.chrome={
 runtime:{getURL:p=>'chrome-extension://copytype/'+p,
 sendMessage:async m=>{
   window.__calls.push(m);
   if(m.type==='VIEW_STATUS')return {ok:true,open:false};
   if(m.type==='VIEW_OPEN')return {ok:true,url:'https://chatgpt.com/'};
   if(m.type==='VIEW_FRAME')return {ok:true,url:'https://chatgpt.com/',image:'data:image/jpeg;base64,/9j/4AAQSkZJRg=='};
   return {ok:true,status:'idle'};
 }},
 tabs:{query:async()=>[{id:7,url:'https://example.com/'}]}
};
'''
def main():
  with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page()
    page.set_content((ROOT/'popup.html').read_text())
    page.evaluate(MOCK_CHROME)
    page.add_style_tag(path=str(ROOT/'popup.css'))
    for js in ['timing.js','browser-utils.js','popup.js','viewer-ui.js']:
      page.add_script_tag(path=str(ROOT/js))
    page.locator('[data-panel=browser]').click()
    assert page.locator('#browser-panel').is_visible()
    assert not page.locator('#typing-panel').is_visible()
    assert page.locator('body').evaluate("el=>el.classList.contains('is-browser')")
    page.locator('[data-quick=chatgpt]').click()
    page.wait_for_function("window.__calls.some(c=>c.type==='VIEW_OPEN')")
    assert page.evaluate("window.__calls.find(c=>c.type==='VIEW_OPEN').input")=='https://chatgpt.com/'
    page.wait_for_function("window.__calls.some(c=>c.type==='VIEW_FRAME')")
    assert page.locator('#browser-screen').is_visible()
    page.locator('#browser-text').fill('test input')
    page.locator('#browser-send').click()
    page.wait_for_function("window.__calls.some(c=>c.type==='VIEW_ACTION'&&c.action==='text')")
    assert page.evaluate("window.__calls.find(c=>c.type==='VIEW_ACTION'&&c.action==='text').text")=='test input'
    page.locator('#view-close').click()
    page.wait_for_function("window.__calls.some(c=>c.type==='VIEW_CLOSE')")
    print('Chromium UI smoke test passed: embedded viewer, toolbar, text entry, close.')
    browser.close()
if __name__=='__main__':main()
