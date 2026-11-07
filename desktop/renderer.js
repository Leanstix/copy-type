'use strict';
const api=window.miniBrowser;
const $=id=>document.getElementById(id),tabs=$('tabs'),address=$('address'),alertBox=$('alert');
let state={tabs:[],activeId:null},editing=false,alertTimer=null;
function report(error){alertBox.textContent=String(error?.message||error);alertBox.classList.add('visible');clearTimeout(alertTimer);alertTimer=setTimeout(()=>alertBox.classList.remove('visible'),5000);}
async function call(type,payload){try{await api.command(type,payload);}catch(error){report(error);}}
function render(next){
 if(!next||!Array.isArray(next.tabs))return;state=next;tabs.replaceChildren();
 for(const tab of state.tabs){
  const button=document.createElement('button');button.type='button';button.className='tab'+(tab.id===state.activeId?' active':'');
  button.setAttribute('role','tab');button.setAttribute('aria-selected',String(tab.id===state.activeId));button.title=tab.title||tab.url;
  const name=document.createElement('span');name.className='name';name.textContent=tab.loading?'◌ '+tab.title:tab.title;
  const close=document.createElement('span');close.className='close';close.textContent='×';close.title='Close tab';
  close.addEventListener('click',e=>{e.stopPropagation();void call('close-tab',tab.id);});
  button.append(name,close);button.addEventListener('click',()=>void call('activate-tab',tab.id));tabs.append(button);
 }
 const active=state.tabs.find(t=>t.id===state.activeId);
 if(active){if(!editing)address.value=active.url||'';$('back').disabled=!active.canGoBack;$('forward').disabled=!active.canGoForward;$('reload').textContent=active.loading?'◌':'↻';}
 $('newTab').disabled=state.tabs.length>=6;
 renderTyping(next);
}
async function typeCall(type,payload){try{return await api.typing(type,payload);}catch(error){report(error);}}
function renderTyping(next){
 const panel=$('typingPanel');panel.hidden=!next.panelOpen;
 $('toggleTyping').textContent=next.panelOpen?'Hide typing':'Type text';
 const select=$('destination'),old=select.value;
 const previousPreferred=renderTyping.previousPreferred;
 select.replaceChildren(new Option('Choose an editor…',''));
 for(const target of next.targets||[])select.add(new Option(target.label,target.id));
 if(next.preferredTarget&&next.preferredTarget!==previousPreferred)select.value=next.preferredTarget;
 else select.value=old;
 renderTyping.previousPreferred=next.preferredTarget;
 const task=next.typing||{},busy=!!task.busy;
 for(const id of ['startTyping','source','rate','destination','refreshDesktop','selectBrowser'])$(id).disabled=busy||!!next.selecting;
 $('pauseTyping').disabled=!busy||['preparing','cancelling'].includes(task.status);
 $('pauseTyping').textContent=task.status==='paused'?'Resume':'Pause';
 $('cancelTyping').disabled=!busy&&!next.selecting;
 $('typingProgress').max=task.total||1;$('typingProgress').value=task.done||0;
 $('typingStatus').textContent=next.selecting?'Click the destination editor inside the browser.':`${task.message||'Choose a destination to begin.'}${task.total?` (${task.done||0} / ${task.total})`:''}`;
}
function estimate(){const count=Array.from($('source').value.replace(/\r\n?/g,'\n')).length;const rate=Number($('rate').value);$('estimate').textContent=`${count.toLocaleString()} characters${rate>0?` · about ${Math.ceil(count/rate)} seconds`:''}`;}
$('toggleTyping').addEventListener('click',()=>void typeCall('panel',!state.panelOpen));
$('closeTyping').addEventListener('click',()=>void typeCall('panel',false));
$('selectBrowser').addEventListener('click',()=>void typeCall('select-browser'));
$('refreshDesktop').addEventListener('click',async()=>{const button=$('refreshDesktop');button.disabled=true;button.textContent='Finding fields…';try{await typeCall('desktop-fields');}finally{button.disabled=false;button.textContent='Desktop fields';}});
$('startTyping').addEventListener('click',()=>void typeCall('start',{target:$('destination').value,text:$('source').value,rate:Number($('rate').value)}));
$('pauseTyping').addEventListener('click',()=>void typeCall(state.typing?.status==='paused'?'resume':'pause'));
$('cancelTyping').addEventListener('click',()=>void typeCall('cancel'));
$('source').addEventListener('input',estimate);$('rate').addEventListener('input',estimate);
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&state.typing?.busy){event.preventDefault();void typeCall('cancel');}});
$('addressForm').addEventListener('submit',event=>{event.preventDefault();const value=address.value;editing=false;void call('navigate',value);address.blur();});
address.addEventListener('focus',()=>{editing=true;address.select();});
address.addEventListener('blur',()=>{editing=false;});
for(const [id,type] of [['back','back'],['forward','forward'],['reload','reload'],['newTab','new-tab']])$(id).addEventListener('click',()=>void call(type));
for(const el of document.querySelectorAll('[data-url]'))el.addEventListener('click',()=>void call('navigate',el.dataset.url));
window.addEventListener('keydown',event=>{
 const mod=event.ctrlKey||event.metaKey;
 if(mod&&event.key.toLowerCase()==='l'){event.preventDefault();address.focus();address.select();}
 else if(mod&&event.key.toLowerCase()==='t'){event.preventDefault();void call('new-tab');}
 else if(mod&&event.key.toLowerCase()==='w'){event.preventDefault();void call('close-tab',state.activeId);}
 else if(mod&&event.key.toLowerCase()==='r'){event.preventDefault();void call('reload');}
 else if(event.altKey&&event.key==='ArrowLeft'){event.preventDefault();void call('back');}
 else if(event.altKey&&event.key==='ArrowRight'){event.preventDefault();void call('forward');}
});
api.onState(render);api.ready().then(render).catch(report);
api.onFocusAddress?.(()=>{address.focus();address.select();});
