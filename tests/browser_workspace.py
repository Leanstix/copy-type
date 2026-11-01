"""Chromium UI smoke tests for the popup and workspace using mocked Chrome APIs.
This deliberately does not claim to test Chrome-extension installation or cookies.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
MOCK_CHROME = '''
window.__copytypeCalls = [];
window.close = () => { window.__copytypePopupClosed = true; };
window.chrome = {
  runtime: {
    getURL: path => 'chrome-extension://copytype/' + path,
    sendMessage: async msg => { window.__copytypeCalls.push(msg); return {ok: true, status:'idle'}; }
  },
  tabs: {
    query: async () => [{id: 7, url:'https://example.com/'}],
    create: async args => { window.__copytypeCalls.push(args); return {id: 42}; }
  },
  windows: {getCurrent: async () => ({id: 13})}
};
'''

def load(page, html, scripts, styles):
    page.set_content((ROOT / html).read_text())
    page.evaluate(MOCK_CHROME)
    page.add_style_tag(path=str(ROOT / styles))
    for script in scripts:
        page.add_script_tag(path=str(ROOT / script))


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        context = browser.new_context()
        popup = context.new_page()
        load(popup, 'popup.html', ['timing.js','browser-utils.js','popup.js'], 'popup.css')
        popup.locator('[data-panel="browser"]').click()
        assert popup.locator('#browser-panel').is_visible()
        assert not popup.locator('#typing-panel').is_visible()
        popup.locator('#browse-address').fill('chatgpt.com')
        popup.locator('#browse-submit').click()
        popup.wait_for_function("window.__copytypeCalls.some(c => c.type === 'OPEN_WORKSPACE')")
        assert popup.evaluate("window.__copytypeCalls.find(c => c.type === 'OPEN_WORKSPACE').input") == 'chatgpt.com'
        home = context.new_page()
        load(home, 'workspace.html', ['browser-utils.js','workspace.js'], 'workspace.css')
        home.locator('#address').fill('C++ syntax')
        home.locator('#search-form button').click()
        home.wait_for_function('window.__copytypeCalls.length > 0')
        call = home.evaluate('window.__copytypeCalls[0]')
        assert call['windowId'] == 13
        assert call['url'] == 'https://www.google.com/search?q=C%2B%2B%20syntax'
        home.locator('[data-site="chatgpt"]').click()
        home.wait_for_function('window.__copytypeCalls.length > 1')
        assert home.evaluate('window.__copytypeCalls[1].url') == 'https://chatgpt.com/'
        browser.close()
        print('Chromium UI smoke test passed (popup, query, shortcut).')

if __name__ == '__main__':
    main()
