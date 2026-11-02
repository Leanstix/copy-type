'use strict';
const MAX_TABS=6;
function makeTabState(){
 const tabs=[];let activeId=null,nextId=1;
 return {
 add(){if(tabs.length>=MAX_TABS)throw Error('Up to '+MAX_TABS+' tabs can be open at once.');const id=nextId++;tabs.push(id);activeId=id;return id;},
 activate(id){if(!tabs.includes(id))throw Error('Unknown tab.');activeId=id;},
 close(id){const i=tabs.indexOf(id);if(i===-1)throw Error('Unknown tab.');tabs.splice(i,1);if(activeId===id)activeId=tabs[Math.min(i,tabs.length-1)]||null;return activeId;},
 has:id=>tabs.includes(id),get ids(){return [...tabs];},get activeId(){return activeId;}
 };
}
module.exports={makeTabState,MAX_TABS};
