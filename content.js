/* Injected only when the user arms a task; nothing reads page content. */
(() => {
  'use strict';
  if (globalThis.__copyTypeReady) return;
  globalThis.__copyTypeReady = true;
  let status = 'idle';
  let selectionRoot = null;
  let editorToken = '';
  let host, root, message, progress, pauseButton;
  const trackedDocuments = new WeakSet();
  const pending = new Map();
  const send = (type, reason) => chrome.runtime.sendMessage({type, reason});
  const editors = [
    ['.monaco-editor', 'Monaco'],
    ['.ace_editor', 'Ace'],
    ['.CodeMirror', 'CodeMirror 5'],
    ['.cm-editor', 'CodeMirror 6'],
  ];
  const editorSelector = editors.map(([selector]) => selector).join(', ');
  const diagnose = (event, details = {}) => console.debug('[CopyType]', event, details);

  function targetKind(element) {
    const editor = editors.find(([selector]) => element.matches(selector));
    if (editor) return editor[1];
    if (element.tagName === 'TEXTAREA') return 'Textarea';
    if (element.tagName === 'INPUT') return 'Text input';
    if (element.matches('.ProseMirror, .ql-editor, [data-lexical-editor], [data-slate-editor]')) return 'Rich-text editor';
    return 'Contenteditable';
  }

  function activeElement(doc = document) {
    let active = doc.activeElement;
    while (active) {
      const inner = active.shadowRoot?.activeElement ?? active.contentDocument?.activeElement;
      if (!inner) break;
      active = inner;
    }
    return active;
  }

  function eligible(element) {
    // Elements in an iframe have a different Element constructor.
    if (typeof element?.closest !== 'function') return null;
    if (element.closest('[inert]')) return null;
    if (element.matches('input, textarea')) {
      if (element.matches(':disabled, [readonly]')) return null;
      if (element.tagName === 'INPUT') {
        return ['text', 'search', 'email', 'url', 'tel', 'number'].includes(element.type)
          ? element : null;
      }
      return element.closest('.CodeMirror') ??
        element.closest('.ace_text-input, .inputarea')?.closest(editorSelector) ?? element;
    }
    const editor = element.closest(editorSelector);
    if (editor) return editor;
    if (element.isContentEditable) {
      while (element.parentElement?.isContentEditable) element = element.parentElement;
      return element;
    }
    if (element.ownerDocument?.designMode === 'on') return element.ownerDocument.body;
    return null;
  }

  function targetHasFocus() {
    return selectionRoot?.isConnected && eligible(activeElement()) === selectionRoot;
  }

  function bridge(action, char) {
    if (!selectionRoot) return Promise.resolve({ok:false,error:'Editor was disconnected.'});
    const id = crypto.randomUUID();
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => {pending.delete(id);reject(new Error('Editor did not respond.'));}, 4000);
      pending.set(id,{resolve,reject,timer});
      window.dispatchEvent(new CustomEvent('copytype:request',{
        detail:{id, token:editorToken, action, char}
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
    // Keep the editor's selection when the panel's mouse controls are used.
    root.addEventListener('mousedown', event => event.preventDefault());
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
  async function onClick(event) {
    if (!event.isTrusted || status !== 'armed') return;
    const path = event.composedPath();
    if (path.includes(host)) return;
    const candidate = path.map(eligible).find(Boolean);
    if (!candidate) {
      diagnose('click-ignored', {reason:'no-editable-target'});
      return;
    }
    const token = crypto.randomUUID();
    editorToken = token;
    status = 'starting';
    try {
      // Let the page's click handler move the caret and focus its input first.
      await new Promise(resolve => setTimeout(resolve, 110));
      if (status !== 'starting' || editorToken !== token) return;
      const active = eligible(activeElement());
      if (!active || (active !== candidate && !candidate.contains(active))) {
        diagnose('click-ignored', {reason:'target-did-not-receive-focus'});
        show('armed', 'Click inside the editable area to place the caret.');
        return;
      }
      selectionRoot = active;
      const codeEditor = active.matches(editorSelector);
      const kind = codeEditor ? await bridge('init') : {ok:true, supported:false};
      if (status !== 'starting' || editorToken !== token) return;
      if (!kind.ok) {
        diagnose('editor-rejected', {editor:targetKind(active)});
        show('armed', kind.error || 'Click inside a writable editor.');
        return;
      }
      if (!targetHasFocus()) {
        if (codeEditor) void bridge('cancel').catch(() => {});
        diagnose('click-ignored', {reason:'focus-moved-before-start'});
        show('armed', 'The editor lost focus. Click inside it to try again.');
        return;
      }
      const response = await chrome.runtime.sendMessage({type:'START',native:!!kind.supported,codeEditor});
      if (status !== 'starting' || editorToken !== token) return;
      if (!response?.ok) throw new Error(response?.error || 'Could not start typing');
      diagnose('editor-selected', {
        editor: targetKind(active),
        method: kind.supported ? 'editor-model' : 'browser-input',
        frame: active.ownerDocument === document ? 'top' : 'iframe',
      });
      show('typing',kind.supported?`Exact mode: ${kind.kind}.`:'Browser text entry (verification depends on editor).');
    } catch (error) {
      if (status !== 'starting' || editorToken !== token) return;
      diagnose('start-failed');
      if (selectionRoot?.matches(editorSelector)) void bridge('cancel').catch(() => {});
      show('error',error.message);
    }
  }
  function onFocus(event) {
    if (!['typing','paused'].includes(status) || event.composedPath().includes(host)) return;
    if (!targetHasFocus()) {
      diagnose('focus-changed');
      send('CANCEL', 'focus-changed');
    }
  }
  function onKeydown(event) {
    if (event.isTrusted && event.key === 'Escape' && ['armed','starting','typing','paused'].includes(status)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      send('CANCEL');
    }
  }
  function trackDocument(doc) {
    if (!doc) return 0;
    if (!trackedDocuments.has(doc)) {
      trackedDocuments.add(doc);
      doc.addEventListener('click', onClick, true);
      doc.addEventListener('focusin', onFocus, true);
      doc.addEventListener('keydown', onKeydown, true);
      doc.addEventListener('load', event => {
        if (event.target.matches?.('iframe, frame')) trackDocument(event.target.contentDocument);
      }, true);
    }
    // contentDocument is null when Chromium denies access to the frame.
    let count = 1;
    for (const frame of doc.querySelectorAll('iframe, frame')) count += trackDocument(frame.contentDocument);
    return count;
  }
  // Switching tabs leaves this job running in its original tab. The worker
  // targets that tab ID; visibility is not a request to pause the job.
  chrome.runtime.onMessage.addListener((payload, sender, sendResponse) => {
    if (payload.type==='CT_ARMED') {
      editorToken = '';
      selectionRoot = null;
      if (progress) progress.value = 0;
      const accessibleFrames = trackDocument(document) - 1;
      diagnose('armed', {accessibleFrames});
      show('armed');
    }
    if (payload.type==='CT_STATE') {
      if (payload.status==='done'||payload.status==='error'||payload.status==='cancelled') {
        diagnose('finished', {status:payload.status, verified:payload.verified === true});
        // Cleanup is separate from verification, which was already completed by the worker.
        if (selectionRoot?.matches(editorSelector)) void bridge('cancel').catch(()=>{});
      }
      show(payload.status,payload.message||'');
    }
    if (payload.type==='CT_PROGRESS') {progress.value=payload.percent;message.textContent=`${payload.done.toLocaleString()} / ${payload.total.toLocaleString()} characters`;}
    if (['CT_CHECK_TARGET','CT_EDITOR_APPEND','CT_EDITOR_COMPLETE'].includes(payload.type)) {
      if (!targetHasFocus()) {
        diagnose('target-unavailable', {reason:'focus-changed-or-target-removed'});
        sendResponse({ok:false,error:'The selected editor lost focus or was removed.'});
        return;
      }
      if (payload.type==='CT_CHECK_TARGET') {
        sendResponse({ok:true});
        return;
      }
    }
    if (payload.type==='CT_EDITOR_APPEND'||payload.type==='CT_EDITOR_COMPLETE') {
      const action=payload.type==='CT_EDITOR_APPEND'?'append':'complete';
      bridge(action,payload.char).then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));
      return true;
    }
  });
})();
