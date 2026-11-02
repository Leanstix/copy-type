/* Uses the Chrome DevTools Input domain only after explicit per-tab confirmation. */
'use strict';
importScripts('timing.js', 'keyboard.js', 'browser-utils.js', 'viewer.js');
const jobs = new Map();
const keyForTab = (tabId) => `copytype:${tabId}`;
const responseError = (error) => ({ok:false,error:error?.message || String(error)});
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const ui = async (tabId, payload) => { try { await chrome.tabs.sendMessage(tabId, payload); } catch (_) { /* page navigated */ } };

const viewer = CopyTypeViewer.create(chrome, CopyTypeBrowser.resolveInput);

async function state(tabId) {
  const job = jobs.get(tabId);
  if (job && !job.finished) return {ok:true,status:job.paused?'paused':'typing',done:job.done,total:job.chars.length};
  const queued = (await chrome.storage.session.get(keyForTab(tabId)))[keyForTab(tabId)];
  return {ok:true,status:queued?'armed':'idle'};
}

async function arm(tabId, text, mode) {
  if (!Number.isSafeInteger(tabId)) throw new Error('No browser tab selected.');
  if (typeof text !== 'string') throw new Error('Text must be a string.');
  const count = CopyTypeTiming.countCharacters(text);
  if (!count || count > CopyTypeTiming.MAX_CHARS) throw new Error(`Text must contain 1–${CopyTypeTiming.MAX_CHARS} characters.`);
  if (!['literal','keyboard'].includes(mode)) throw new Error('Invalid typing mode.');
  if (jobs.has(tabId)) throw new Error('Stop the running task before queuing another.');
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:\/\//.test(tab.url || '')) throw new Error('Only regular websites are supported.');
  // MAIN world sees the editor's real API; isolated content scripts do not.
  await chrome.scripting.executeScript({target:{tabId},files:['editor-bridge.js'],world:'MAIN'});
  await chrome.scripting.executeScript({target:{tabId},files:['content.js']});
  await chrome.storage.session.set({[keyForTab(tabId)]:{text,mode,created:Date.now()}});
  await ui(tabId,{type:'CT_ARMED'});
  return {ok:true};
}

async function finish(tabId, job, outcome, message) {
  if (job.finished) return;
  job.finished = true;
  jobs.delete(tabId);
  await chrome.storage.session.remove(keyForTab(tabId));
  if (job.attached) {
    job.attached = false;
    try { await chrome.debugger.detach({tabId}); } catch (_) { /* already detached */ }
  }
  await ui(tabId,{type:'CT_STATE',status:outcome,message});
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

async function start(tabId, native, codeEditor) {
  if (jobs.has(tabId)) throw new Error('A task is already running in this tab.');
  const queued = (await chrome.storage.session.get(keyForTab(tabId)))[keyForTab(tabId)];
  if (!queued || Date.now() - queued.created > 15*60*1000) throw new Error('Queue expired. Open the popup and confirm again.');
  const chars = Array.from(queued.text.replace(/\r\n?/g,'\n'));
  const durationMs = CopyTypeTiming.secondsForCount(chars.length) * 1000;
  const delays = CopyTypeTiming.makeDelays(chars,durationMs);
  const job = {chars,mode:queued.mode,native:!!native,codeEditor:!!codeEditor,delays,done:0,paused:false,cancelled:false,attached:false,finished:false};
  jobs.set(tabId,job);
  // The message resolves before the slow job finishes: popup/content script stay responsive.
  void (async () => {
    try {
      await chrome.debugger.attach({tabId},'1.3');
      job.attached = true;
      for (let i=0; i<chars.length; i++) {
        if (job.cancelled) break;
        while (job.paused && !job.cancelled) await sleep(90);
        if (job.cancelled) break;
        if (job.native) {
          const result = await chrome.tabs.sendMessage(tabId,{type:'CT_EDITOR_APPEND',char:chars[i]});
          if (!result?.ok) throw new Error(result?.error || 'Editor rejected input');
        } else {
          // In code editors without an accessible model, prefer insertText
          // rather than key events, which trigger bracket/indent helpers.
          await emitCharacter(tabId,chars[i],job.codeEditor?'literal':job.mode);
        }
        job.done = i+1;
        if (job.done === chars.length || job.done % 30 === 0) {
          await ui(tabId,{type:'CT_PROGRESS',done:job.done,total:chars.length,percent:Math.round(100*job.done/chars.length)});
        }
        if (!job.cancelled) await sleep(delays[i]);
      }
      if (!job.cancelled && job.native) {
        const verified=await chrome.tabs.sendMessage(tabId,{type:'CT_EDITOR_COMPLETE'});
        if (!verified?.ok || !verified?.verified) throw new Error(verified?.error || 'Editor contents could not be verified');
      }
      await finish(tabId,job,job.cancelled?'cancelled':'done',job.cancelled?'Cancelled.':'Finished; editor content verified.');
    } catch (error) {
      await finish(tabId,job,'error',`Typing stopped: ${error.message || error}`);
    }
  })();
  return {ok:true};
}

async function control(tabId, type) {
  const job = jobs.get(tabId);
  if (type === 'CANCEL') {
    if (job) { job.cancelled=true; job.paused=false; }
    else { await chrome.storage.session.remove(keyForTab(tabId)); await ui(tabId,{type:'CT_STATE',status:'cancelled'}); }
    return {ok:true};
  }
  if (!job || job.finished) throw new Error('No active typing task.');
  job.paused=type==='PAUSE';
  await ui(tabId,{type:'CT_STATE',status:job.paused?'paused':'typing'});
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
    if (message.type==='ARM') return arm(tabId,message.text,message.mode);
    if (message.type==='GET_STATE') return state(tabId);
    if (message.type==='START') return start(tabId, message.native, message.codeEditor);
    if (['CANCEL','PAUSE','RESUME'].includes(message.type)) return control(tabId,message.type);
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

