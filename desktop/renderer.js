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
}
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
