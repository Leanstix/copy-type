'use strict';
const $ = (id) => document.getElementById(id);
const source = $('source');
const confirm = $('confirm');
const cancel = $('cancel');
let tabId = null;
const send = (payload) => chrome.runtime.sendMessage(payload);
function updateEstimate() {
  const count = CopyTypeTiming.countCharacters(source.value);
  $('count').textContent = `${count.toLocaleString()} characters`;
  $('estimate').textContent = `Estimated ${CopyTypeTiming.formatSeconds(CopyTypeTiming.secondsForCount(count))}`;
  confirm.disabled = count === 0 || count > CopyTypeTiming.MAX_CHARS || tabId === null;
  $('alert').textContent = count > CopyTypeTiming.MAX_CHARS ? `Limit: ${CopyTypeTiming.MAX_CHARS.toLocaleString()} characters` : '';
}
async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:\/\//.test(tab.url || '')) {
      $('alert').textContent = 'Open a regular http(s) webpage first.';
      return;
    }
    tabId = tab.id;
    const result = await send({ type: 'GET_STATE', tabId });
    if (result?.status === 'typing' || result?.status === 'paused' || result?.status === 'armed') {
      $('alert').textContent = `Current task: ${result.status}. Confirm replaces an armed task, not a running one.`;
      cancel.hidden = false;
    }
    updateEstimate();
  } catch (error) { $('alert').textContent = error.message || 'Unable to access tab.'; }
}
source.addEventListener('input', updateEstimate);
confirm.addEventListener('click', async () => {
  confirm.disabled = true;
  $('alert').textContent = '';
  try {
    const result = await send({type:'ARM',tabId,text:source.value,mode:$('mode').value});
    if (!result?.ok) throw new Error(result?.error || 'Unable to arm typing.');
    source.value = ''; // do not keep an extra copy in the popup
    window.close();
  } catch (error) { $('alert').textContent = error.message || 'Failed to queue text.'; updateEstimate(); }
});
cancel.addEventListener('click', async () => {
  try { await send({type:'CANCEL',tabId}); cancel.hidden = true; $('alert').textContent = 'Task cancelled.'; }
  catch (error) { $('alert').textContent = error.message; }
});
init();

// Browser workspace runs separately from code entry, including on protected tabs.
for (const tabButton of document.querySelectorAll('[data-panel]')) {
  tabButton.addEventListener('click', () => {
    for (const button of document.querySelectorAll('[data-panel]')) {
      const active = button === tabButton;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      $(button.dataset.panel + '-panel').hidden = !active;
    }
  });
}
async function launchWorkspace(input = '') {
  const notice = $('browser-alert');
  notice.textContent = '';
  try {
    CopyTypeBrowser.resolveInput(input); // reject invalid input before opening a window
    const result = await send({type:'OPEN_WORKSPACE', input});
    if (!result?.ok) throw new Error(result?.error || 'Could not open mini browser.');
    window.close();
  } catch (error) {
    notice.textContent = error.message || 'Could not open mini browser.';
  }
}
$('browse-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void launchWorkspace($('browse-address').value);
});
for (const quick of document.querySelectorAll('[data-quick]')) {
  quick.addEventListener('click', () => void launchWorkspace(CopyTypeBrowser.SHORTCUTS[quick.dataset.quick]));
}
