"""Smoke-test CopyType's browser shell using a mocked, trusted preload bridge."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
async def main():
  async with async_playwright() as p:
    browser=await p.chromium.launch(headless=True,args=['--no-sandbox'])
    page=await browser.new_page(viewport={'width':1020,'height':740})
    html=(ROOT/'index.html').read_text()
    html=html.replace('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'self\'; script-src \'self\';">','')
    await page.set_content(html)
    await page.add_style_tag(content=(ROOT/'styles.css').read_text())
    await page.evaluate("""window.__commands=[];window.miniBrowser={
      command:async(type,payload)=>{window.__commands.push([type,payload]);return true;},
      onState:callback=>{window.__onState=callback;return ()=>{};},
      ready:async()=>({activeId:1,tabs:[
        {id:1,title:'ChatGPT',url:'https://chatgpt.com/',loading:false,canGoBack:false,canGoForward:false},
        {id:2,title:'GitHub',url:'https://github.com/',loading:false,canGoBack:true,canGoForward:false}
      ]})
    }""")
    await page.add_script_tag(content=(ROOT/'renderer.js').read_text())
    await page.wait_for_selector('[role="tab"]')
    assert await page.locator('[role="tab"]').count()==2
    await page.locator('#address').fill('hello browsers')
    await page.locator('#address').press('Enter')
    await page.locator('[data-url="https://github.com"]').click()
    await page.locator('#newTab').click()
    result=await page.evaluate('window.__commands')
    assert result[:3]==[['navigate','hello browsers'],['navigate','https://github.com'],['new-tab',None]],result
    await browser.close()
    print('Browser shell smoke test passed')

asyncio.run(main())
