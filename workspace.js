'use strict';
const address = document.querySelector('#address');
const notice = document.querySelector('#message');
let busy = false;
async function openDestination(value) {
  if (busy) return;
  try {
    const url = CopyTypeBrowser.resolveInput(value);
    if (!url) { address.focus(); return; }
    busy = true;
    notice.textContent = '';
    const current = await chrome.windows.getCurrent();
    // This is a regular Chrome tab: Chrome handles logins, cookies and CSP normally.
    await chrome.tabs.create({windowId:current.id,url,active:true});
    address.value = '';
  } catch (error) {
    notice.textContent = error.message || 'Could not open this destination.';
  } finally { busy = false; }
}
document.querySelector('#search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void openDestination(address.value);
});
for (const button of document.querySelectorAll('[data-site]')) {
  button.addEventListener('click', () => void openDestination(CopyTypeBrowser.SHORTCUTS[button.dataset.site]));
}
