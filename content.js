/* Injected only when the user arms a task; nothing reads page content. */
(() => {
  'use strict';
  if (globalThis.__copyTypeReady) return;
  globalThis.__copyTypeReady = true;
  let status = 'idle';
  let selectionRoot = null;
  let host, root, message, progress, pauseButton;
  const send = (type) => chrome.runtime.sendMessage({ type });
  function eligible(element) {
    if (!(element instanceof Element)) return null;
    const editor = element.closest('.monaco-editor, .ace_editor, .CodeMirror, .cm-editor');
    if (editor) return editor;
    const field = element.closest('textarea, input, [contenteditable="true"], [contenteditable="plaintext-only"]');
    if (!field || field.matches('[disabled], [readonly], input[type="password"], input[type="file"], input[type="checkbox"], input[type="radio"], input[type="submit"]')) return null;
    if (field.tagName === 'INPUT' && !['text','search','email','url','tel','number'].includes(field.type)) return null;
    return field;
  }
  function setup() {
    if (host) return;
    host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;top:14px;right:14px;z-index:2147483647;pointer-events:auto';
    root = host.attachShadow({mode:'closed'});
    const style = document.createElement('style');
    style.textContent = ':host{all:initial}*{box-sizing:border-box}.panel{width:260px;padding:13px 14px;border:1px solid #455473;border-radius:13px;background:#172032;color:#eff3fe;font:12px/1.45 system-ui;box-shadow:0 8px 35px #0008}strong{font-size:13px}#message{display:block;color:#b4c0d4;margin:5px 0 9px}.actions{display:flex;gap:7px}button{border:0;border-radius:7px;padding:6px 10px;background:#6575eb;color:white;font:600 11px system-ui;cursor:pointer}button.secondary{background:#354359}progress{width:100%;height:6px;margin-bottom:9px;accent-color:#8491ff}';
    const panel = document.createElement('div'); panel.className = 'panel';
    panel.innerHTML = '<strong>CopyType</strong><span id="message"></span><progress id="progress" max="100" value="0"></progress><div class="actions"><button id="pause">Pause</button><button class="secondary" id="cancel">Cancel</button></div>';
    root.append(style,panel); document.documentElement.appendChild(host);
    message = root.getElementById('message'); progress = root.getElementById('progress');
    pauseButton = root.getElementById('pause');
    pauseButton.addEventListener('click', () => { if(status==='typing'||status==='paused') send(status==='typing'?'PAUSE':'RESUME'); });
    root.getElementById('cancel').addEventListener('click', () => send('CANCEL'));
  }
  function show(state, detail = '') {
    status = state;
    setup();
    host.style.display = 'block';
    message.textContent = detail || ({armed:'Click the editor where typing should begin.', typing:'Entering text…', paused:'Paused.', done:'Finished.', error:'Typing stopped.', cancelled:'Cancelled.'}[state] || '');
    pauseButton.style.display = ['typing','paused'].includes(state) ? 'block' : 'none';
    pauseButton.textContent = state === 'paused' ? 'Resume' : 'Pause';
    if (['done','cancelled','error'].includes(state)) { progress.value = state === 'done' ? 100 : progress.value; setTimeout(() => { if (status === state && host) host.style.display='none'; }, 5500); }
  }
  function onClick(event) {
    if (status !== 'armed' || (host && event.composedPath().includes(host))) return;
    const path = event.composedPath();
    const candidate = path.map(eligible).find(Boolean);
    if (!candidate) return;
    selectionRoot = candidate;
    status = 'starting';
    // Give the editor its normal click/focus handlers before entering text.
    setTimeout(async () => {
      try {
        if (status !== 'starting') return;
        const response = await send('START');
        if (!response?.ok) show('error', response?.error || 'Could not start typing.');
        else show('typing');
      } catch (error) { show('error', error.message); }
    }, 100);
  }
  function onFocus(event) {
    if (status !== 'typing' || !selectionRoot) return;
    if (event.target === selectionRoot || selectionRoot.contains(event.target)) return;
    // Some editors shift focus between internal inputs; honor their container.
    const candidate = eligible(event.target);
    if (candidate && (candidate === selectionRoot || selectionRoot.contains(candidate))) return;
    send('CANCEL');
  }
  document.addEventListener('click', onClick, true);
  document.addEventListener('focusin', onFocus, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && ['armed','starting','typing','paused'].includes(status)) {
      event.preventDefault(); event.stopImmediatePropagation(); send('CANCEL');
    }
  }, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && status === 'typing') send('PAUSE');
  });
  chrome.runtime.onMessage.addListener((payload) => {
    if (payload.type === 'CT_ARMED') { selectionRoot = null; progress && (progress.value = 0); show('armed'); }
    if (payload.type === 'CT_STATE') show(payload.status, payload.message || '');
    if (payload.type === 'CT_PROGRESS') { progress.value = payload.percent; message.textContent = `${payload.done.toLocaleString()} / ${payload.total.toLocaleString()} characters`; }
  });
})();
