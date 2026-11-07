/* Injected only when the user arms a task; nothing reads page content. */
(() => {
  'use strict';
  if (globalThis.__copyTypeReady) return;
  globalThis.__copyTypeReady = true;
  let status = 'idle';
  let selectionRoot = null;
  let editorToken = '';
  let host, root, message, progress, pauseButton;
  const pending = new Map();
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
  function bridge(action, char) {
    if (!selectionRoot) return Promise.resolve({ok:false,error:'Editor was disconnected.'});
    const id = crypto.randomUUID();
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => {pending.delete(id);reject(new Error('Editor did not respond.'));}, 4000);
      pending.set(id,{resolve,reject,timer});
      selectionRoot.dispatchEvent(new CustomEvent('copytype:request',{
        bubbles:true,composed:true, detail:{id,token:editorToken,action,char}
      }));
    });
  }
  window.addEventListener('copytype:response',event => {
    const result = event.detail;
    if (!result || result.token !== editorToken) return;
    const entry = pending.get(result.id);
    if (!entry) return;
    clearTimeout(entry.timer);pending.delete(result.id);entry.resolve(result);
  });
  function setup() {
    if (host) return;
    host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;top:14px;right:14px;z-index:2147483647;pointer-events:auto';
    root = host.attachShadow({mode:'closed'});
    const style = document.createElement('style');
    style.textContent = ':host{all:initial}*{box-sizing:border-box}.panel{width:270px;padding:13px 14px;border:1px solid #455473;border-radius:13px;background:#172032;color:#eff3fe;font:12px/1.45 system-ui;box-shadow:0 8px 35px #0008}strong{font-size:13px}#message{display:block;color:#b4c0d4;margin:5px 0 9px}.actions{display:flex;gap:7px}button{border:0;border-radius:7px;padding:6px 10px;background:#6575eb;color:white;font:600 11px system-ui;cursor:pointer}button.secondary{background:#354359}progress{width:100%;height:6px;margin-bottom:9px;accent-color:#8491ff}';
    const panel = document.createElement('div'); panel.className = 'panel';
    panel.innerHTML = '<strong>CopyType</strong><span id="message"></span><progress id="progress" max="100" value="0"></progress><div class="actions"><button id="pause">Pause</button><button class="secondary" id="cancel">Cancel</button></div>';
    root.append(style,panel); document.documentElement.appendChild(host);
    message = root.getElementById('message'); progress = root.getElementById('progress');
    pauseButton = root.getElementById('pause');
    pauseButton.addEventListener('click', () => {if(status==='typing'||status==='paused') send(status==='typing'?'PAUSE':'RESUME');});
    root.getElementById('cancel').addEventListener('click', () => send('CANCEL'));
  }
  function show(state, detail = '') {
    status = state;setup();host.style.display='block';
    message.textContent = detail || ({armed:'Click the editor where typing should begin.',typing:'Entering exact text…',paused:'Paused.',done:'Finished and verified.',error:'Typing stopped.',cancelled:'Cancelled.'}[state] || '');
    pauseButton.style.display = ['typing','paused'].includes(state) ? 'block' : 'none';
    pauseButton.textContent = state==='paused'?'Resume':'Pause';
    if (['done','cancelled','error'].includes(state)) {
      if (state==='done') progress.value=100;
      setTimeout(() => {if(status===state && host) host.style.display='none';}, 8500);
    }
  }
  function onClick(event) {
    if (status!=='armed' || (host && event.composedPath().includes(host))) return;
    const candidate = event.composedPath().map(eligible).find(Boolean);
    if (!candidate) return;
    selectionRoot=candidate;
    editorToken=crypto.randomUUID();
    status='starting';
    setTimeout(async () => {
      try {
        if(status!=='starting') return;
        // The page's own click handler has now placed its cursor/selection.
        const kind = await bridge('init');
        if (!kind.ok) throw new Error(kind.error || 'Unable to initialise the editor');
        const response = await chrome.runtime.sendMessage({type:'START',native:!!kind.supported,codeEditor:selectionRoot.matches('.ace_editor, .CodeMirror, .cm-editor, .monaco-editor')});
        if (!response?.ok) throw new Error(response?.error || 'Could not start typing');
        show('typing',kind.supported?`Exact mode: ${kind.kind}.`:'Browser text entry (verification depends on editor).');
      } catch (error) { show('error',error.message); }
    },110);
  }
  function onFocus(event) {
    if (status!=='typing' || !selectionRoot) return;
    if (event.target===selectionRoot || selectionRoot.contains(event.target)) return;
    const candidate=eligible(event.target);
    if (candidate && (candidate===selectionRoot || selectionRoot.contains(candidate))) return;
    send('CANCEL');
  }
  document.addEventListener('click',onClick,true);
  document.addEventListener('focusin',onFocus,true);
  document.addEventListener('keydown',event => {
    if(event.key==='Escape' && ['armed','starting','typing','paused'].includes(status)) {
      event.preventDefault();event.stopImmediatePropagation();send('CANCEL');
    }
  },true);
  // Switching tabs leaves this job running in its original tab. The worker
  // targets that tab ID; visibility is not a request to pause the job.
  chrome.runtime.onMessage.addListener((payload, sender, sendResponse) => {
    if (payload.type==='CT_ARMED') { selectionRoot=null;progress && (progress.value=0);show('armed'); }
    if (payload.type==='CT_STATE') {
      if (payload.status==='done'||payload.status==='error'||payload.status==='cancelled') {
        // Cleanup is separate from verification, which was already completed by the worker.
        if (selectionRoot) void bridge('cancel').catch(()=>{});
      }
      show(payload.status,payload.message||'');
    }
    if (payload.type==='CT_PROGRESS') {progress.value=payload.percent;message.textContent=`${payload.done.toLocaleString()} / ${payload.total.toLocaleString()} characters`;}
    if (payload.type==='CT_EDITOR_APPEND'||payload.type==='CT_EDITOR_COMPLETE') {
      const action=payload.type==='CT_EDITOR_APPEND'?'append':'complete';
      bridge(action,payload.char).then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));
      return true;
    }
  });
})();
