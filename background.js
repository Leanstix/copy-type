/* Uses the Chrome DevTools Input domain only after explicit per-tab confirmation. */
'use strict';
importScripts('timing.js', 'keyboard.js', 'browser-utils.js', 'embedded-editor.js', 'viewer.js');
const jobs = new Map();
const keyForTab = (tabId) => `copytype:${tabId}`;
const responseError = (error) => ({ok:false,error:error?.message || String(error)});
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const notify = async (tabId, payload, target) => {
  try { await chrome.tabs.sendMessage(tabId, payload, target); } catch { /* document navigated */ }
};
const ui = (tabId, payload) => notify(tabId, payload, {frameId:0});
const readQueue = async tabId => (await chrome.storage.session.get(keyForTab(tabId)))[keyForTab(tabId)];
const disarmFrames = (tabId, queue) => Promise.all(
  (queue?.frameDocuments ?? []).map(documentId => notify(tabId, {type:'CT_DISARMED', queueId:queue.id}, {documentId}))
);

const viewer = CopyTypeViewer.create(chrome, CopyTypeBrowser.resolveInput);

async function state(tabId) {
  const job = jobs.get(tabId);
  if (job && !job.finished) return {ok:true,status:job.paused?'paused':'typing',done:job.done,total:job.chars.length};
  const queued = await readQueue(tabId);
  return {ok:true,status:queued?'armed':'idle'};
}

async function installEditor(target) {
  // The MAIN world sees the editor model and the isolated world holds extension state.
  await chrome.scripting.executeScript({target,files:['editor-bridge.js'],world:'MAIN'});
  const [installed] = await chrome.scripting.executeScript({target,files:['content.js']});
  return installed.documentId;
}

async function installEmbeddedEditors(tabId, origin) {
  const permissions = CopyTypeEmbedded.permission(CopyTypeBrowser.editorAddress(origin));
  if (!await chrome.permissions.contains(permissions)) {
    throw new Error('Approve access to the embedded editor before confirming.');
  }
  const frames = await chrome.webNavigation.getAllFrames({tabId});
  const candidates = CopyTypeEmbedded.documentsFor(frames ?? [], origin);
  const results = await Promise.allSettled(candidates.map(async documentId => {
    const target = {tabId, documentIds:[documentId]};
    const [probe] = await chrome.scripting.executeScript({target,func:CopyTypeEmbedded.hasOrigin,args:[origin]});
    // A sandbox can make the real origin opaque even when the observed URL looks eligible.
    if (probe?.result !== true) return null;
    return installEditor(target);
  }));
  const installed = results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
  if (!installed.length) throw new Error('No accessible editor frame matched that origin. Open the IDE before confirming, or use its standalone link.');
  return installed;
}

async function arm(tabId, text, mode, editorOrigin) {
  if (!Number.isSafeInteger(tabId)) throw new Error('No browser tab selected.');
  if (typeof text !== 'string') throw new Error('Text must be a string.');
  const count = CopyTypeTiming.countCharacters(text);
  if (!count || count > CopyTypeTiming.MAX_CHARS) throw new Error(`Text must contain 1–${CopyTypeTiming.MAX_CHARS} characters.`);
  if (!['literal','keyboard'].includes(mode)) throw new Error('Invalid typing mode.');
  if (jobs.has(tabId)) throw new Error('Stop the running task before queuing another.');
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:\/\//.test(tab.url || '')) throw new Error('Only regular websites are supported.');
  const previous = await readQueue(tabId);
  const frameDocuments = editorOrigin ? await installEmbeddedEditors(tabId, editorOrigin) : [];
  const documentId = await installEditor({tabId, frameIds:[0]});
  // Recheck after injection so a pending queue cannot replace a task that just started.
  if (jobs.has(tabId)) throw new Error('Stop the running task before queuing another.');
  const queued = {id:crypto.randomUUID(), text, mode, created:Date.now(), documentId, frameDocuments, editorOrigin};
  await chrome.storage.session.set({[keyForTab(tabId)]:queued});
  await disarmFrames(tabId, previous);
  const armed = {type:'CT_ARMED', queueId:queued.id, embeddedAccess:frameDocuments.length > 0};
  await Promise.all([
    ui(tabId, armed),
    ...frameDocuments.map(documentId => notify(tabId, armed, {documentId})),
  ]);
  return {ok:true};
}

async function finish(tabId, job, outcome, message) {
  if (job.finished) return;
  job.finished = true;
  await chrome.storage.session.remove(keyForTab(tabId));
  if (job.attached) {
    job.attached = false;
    try { await chrome.debugger.detach({tabId}); } catch (_) { /* already detached */ }
  }
  await disarmFrames(tabId, job.queue);
  await ui(tabId,{type:'CT_STATE',queueId:job.queue.id,status:outcome,message,verified:outcome==='done' && job.native});
  jobs.delete(tabId);
}

async function emitCharacter(tabId, char, mode) {
  const target = {tabId};
  // Input.insertText sends text through Chromium's editor input path, preserving
  // indentation better than Enter/Tab keystrokes in auto-formatting code editors.
  if (mode === 'literal' || char === '\t' || !CopyTypeKeyboard.keyDescriptor(char)) {
    return chrome.debugger.sendCommand(target,'Input.insertText',{text:char});
  }
  const descriptor = CopyTypeKeyboard.keyDescriptor(char);
  await chrome.debugger.sendCommand(target,'Input.dispatchKeyEvent',{type:'keyDown',...descriptor});
  await chrome.debugger.sendCommand(target,'Input.dispatchKeyEvent',{type:'keyUp',key:descriptor.key,code:descriptor.code,windowsVirtualKeyCode:descriptor.windowsVirtualKeyCode,modifiers:0});
}

async function start(tabId, message, sender) {
  if (jobs.has(tabId)) throw new Error('A task is already running in this tab.');
  const queued = await readQueue(tabId);
  if (!queued || Date.now() - queued.created > 15*60*1000) throw new Error('Queue expired. Open the popup and confirm again.');
  const embedded = sender.frameId > 0;
  const isTarget = embedded
    ? queued.frameDocuments?.includes(sender.documentId) && sender.origin === queued.editorOrigin
    : sender.frameId === 0 && queued.documentId === sender.documentId;
  if (queued.id !== message.queueId || !isTarget) throw new Error('Select the editor again after confirming.');
  if (embedded && !await chrome.permissions.contains(CopyTypeEmbedded.permission(CopyTypeBrowser.editorAddress(queued.editorOrigin)))) {
    throw new Error('Embedded editor access was removed.');
  }
  const current = await readQueue(tabId);
  if (current?.id !== queued.id || jobs.has(tabId)) {
    throw new Error('The typing task changed. Select the editor again.');
  }
  const chars = Array.from(queued.text.replace(/\r\n?/g,'\n'));
  const durationMs = CopyTypeTiming.secondsForCount(chars.length) * 1000;
  const delays = CopyTypeTiming.makeDelays(chars,durationMs);
  const job = {
    chars, queue:queued, embedded, mode:queued.mode, native:!!message.native,
    codeEditor:!!message.codeEditor, delays,done:0,paused:false,cancelled:false,attached:false,finished:false,
  };
  const editor = {documentId:sender.documentId};
  jobs.set(tabId,job);
  // The message resolves before the slow job finishes: popup/content script stay responsive.
  void (async () => {
    try {
      if (embedded) await ui(tabId,{type:'CT_STATE',queueId:queued.id,status:'typing',message:'Typing in the embedded editor…'});
      await chrome.debugger.attach({tabId},'1.3');
      job.attached = true;
      for (let i=0; i<chars.length; i++) {
        if (job.cancelled) break;
        while (job.paused && !job.cancelled) await sleep(90);
        if (job.cancelled) break;
        if (job.native) {
          const result = await chrome.tabs.sendMessage(tabId,{type:'CT_EDITOR_APPEND',char:chars[i]},editor);
          if (!result?.ok) throw new Error(result?.error || 'Editor rejected input');
        } else {
          const target = await chrome.tabs.sendMessage(tabId,{type:'CT_CHECK_TARGET'},editor);
          if (!target?.ok) throw new Error(target?.error || 'The selected editor is unavailable.');
          if (job.cancelled) break;
          // In code editors without an accessible model, prefer insertText
          // rather than key events, which trigger bracket/indent helpers.
          await emitCharacter(tabId,chars[i],job.codeEditor?'literal':job.mode);
        }
        job.done = i+1;
        if (job.done === chars.length || job.done % 30 === 0) {
          await ui(tabId,{type:'CT_PROGRESS',queueId:queued.id,done:job.done,total:chars.length,percent:Math.round(100*job.done/chars.length)});
        }
        if (!job.cancelled) await sleep(delays[i]);
      }
      if (!job.cancelled && job.native) {
        const verified=await chrome.tabs.sendMessage(tabId,{type:'CT_EDITOR_COMPLETE'},editor);
        if (!verified?.ok || !verified?.verified) throw new Error(verified?.error || 'Editor contents could not be verified');
      }
      const message = job.native ? 'Finished; editor content verified.' : 'Finished sending browser input. Check the result in the editor.';
      await finish(tabId,job,job.cancelled?'cancelled':'done',job.cancelled?(job.cancelMessage || 'Cancelled.'):message);
    } catch (error) {
      await finish(tabId,job,'error',`Typing stopped: ${error.message || error}`);
    }
  })();
  return {ok:true};
}

async function control(tabId, type, reason) {
  const job = jobs.get(tabId);
  if (type === 'CANCEL') {
    if (job) {
      if (reason==='focus-changed') job.cancelMessage='Typing stopped because the selected editor lost focus.';
      job.cancelled=true;
      job.paused=false;
    }
    else {
      const queued = await readQueue(tabId);
      await chrome.storage.session.remove(keyForTab(tabId));
      await disarmFrames(tabId, queued);
      await ui(tabId,{type:'CT_STATE',queueId:queued?.id,status:'cancelled'});
    }
    return {ok:true};
  }
  if (!job || job.finished) throw new Error('No active typing task.');
  job.paused=type==='PAUSE';
  await ui(tabId,{type:'CT_STATE',queueId:job.queue.id,status:job.paused?'paused':'typing'});
  return {ok:true};
}

chrome.runtime.onMessage.addListener((message,sender,sendResponse) => {
  const tabId = message.type==='ARM' || message.type==='GET_STATE' ? message.tabId : sender.tab?.id || message.tabId;
  (async () => {
    if (message.type?.startsWith('VIEW_') && !sender.url?.startsWith(chrome.runtime.getURL(''))) throw new Error('Only CopyType pages can control the browser.');
    if (message.type === 'VIEW_STATUS') return viewer.status();
    if (message.type === 'VIEW_OPEN') return viewer.open(message.input);
    if (message.type === 'VIEW_NAV') return viewer.navigate(message.input);
    if (message.type === 'VIEW_FRAME') return viewer.capture();
    if (message.type === 'VIEW_ACTION') return viewer.interact(message);
    if (message.type === 'VIEW_CLOSE') { await viewer.dispose(true); return {ok:true}; }
    if (message.type==='ARM') return arm(tabId,message.text,message.mode,message.editorOrigin);
    if (message.type==='GET_STATE') return state(tabId);
    if (message.type==='START' && sender.tab) return start(tabId, message, sender);
    if (['CANCEL','PAUSE','RESUME'].includes(message.type)) {
      if (sender.frameId > 0) {
        const queue = jobs.get(tabId)?.queue ?? await readQueue(tabId);
        if (queue?.id !== message.queueId || !queue?.frameDocuments?.includes(sender.documentId)) {
          throw new Error('This embedded document no longer owns the typing task.');
        }
      }
      return control(tabId,message.type,message.reason);
    }
    throw new Error('Unknown command.');
  })().then(sendResponse).catch(error => sendResponse(responseError(error)));
  return true;
});
chrome.debugger.onDetach.addListener((source,reason) => {
  viewer.onDetach(source.tabId);
  const job=jobs.get(source.tabId);
  if (job && !job.finished) { job.attached=false; job.cancelled=true; void finish(source.tabId,job,'error',`Chrome ended the input session (${reason}).`); }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  viewer.onRemoved(tabId);
  const job=jobs.get(tabId); if (job) {job.cancelled=true;job.paused=false;}
  void chrome.storage.session.remove(keyForTab(tabId));
});
chrome.tabs.onUpdated.addListener((tabId,changeInfo) => {
  if (changeInfo.status==='loading') {
    const job=jobs.get(tabId); if (job) {job.cancelled=true;job.paused=false;}
    void chrome.storage.session.remove(keyForTab(tabId));
  }
});
chrome.permissions.onRemoved.addListener(async () => {
  for (const job of jobs.values()) {
    if (!job.embedded || job.finished) continue;
    const access = CopyTypeEmbedded.permission(CopyTypeBrowser.editorAddress(job.queue.editorOrigin));
    if (!await chrome.permissions.contains(access)) {
      job.cancelMessage = 'Embedded editor access was removed.';
      job.cancelled = true;
      job.paused = false;
    }
  }
});

