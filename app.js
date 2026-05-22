const el=(id)=>document.getElementById(id);
const messageList=el('messageList');
const assistantTemplate=el('assistantTemplate');
const promptEl=el('prompt');

const messages=[]; // {id,role,content,parentId,branchId,branchOriginId,directionFromParent}
const detours=new Map(); // id->{id,originMessageId,direction,title,messageIds,collapsed}
let mainIds=[];
let pendingDetour=null; // {originMessageId,direction,detourId}

function uid(){return crypto.randomUUID();}
function summarizeDetourTitle(text){const cleaned=text.replace(/[?.!]/g,'').replace(/^(can you|please|explain|tell me|what about)\s+/i,'').trim();return cleaned.split(/\s+/).slice(0,3).join(' ')||'Detour';}
function msgById(id){return messages.find(m=>m.id===id);} 
function laneMessages(){
  if(!pendingDetour) return mainIds.map(msgById).filter(Boolean);
  const d=detours.get(pendingDetour.detourId); if(!d) return mainIds.map(msgById).filter(Boolean);
  const originIndex=mainIds.indexOf(d.originMessageId);
  const base=mainIds.slice(0,originIndex+1).map(msgById).filter(Boolean);
  const branch=d.messageIds.map(msgById).filter(Boolean);
  return [...base,...branch];
}

function beginDetour(originMessageId,direction){
  const d={id:uid(),originMessageId,direction,title:'Detour',messageIds:[],collapsed:true};
  detours.set(d.id,d);
  pendingDetour={originMessageId,direction,detourId:d.id};
  promptEl.placeholder=direction==='left'?'Ask an alternative angle...':'Expand this answer...';
  el('branchHint').textContent=`Detour from selected answer (${direction})`;
  render(); promptEl.focus();
}

function toggleDetour(detourId){
  const d=detours.get(detourId); if(!d) return;
  d.collapsed=!d.collapsed; render();
}

function renderDetourTags(container,msg){
  const box=container.querySelector('.detour-tags'); box.innerHTML='';
  for(const d of detours.values()){
    if(d.originMessageId!==msg.id || d.messageIds.length===0) continue;
    const tag=document.createElement('button'); tag.className='detour-tag';
    tag.textContent=`${d.title} · ${d.messageIds.length}`;
    tag.onclick=()=>toggleDetour(d.id);
    box.appendChild(tag);
  }
}

function renderDetourInline(container,msg){
  const holder=container.querySelector('.detour-inline'); holder.innerHTML='';
  for(const d of detours.values()){
    if(d.originMessageId!==msg.id || d.collapsed||d.messageIds.length===0) continue;
    const box=document.createElement('div'); box.className='detour-box';
    box.innerHTML=d.messageIds.map(id=>{const m=msgById(id);return m?`<div><strong>${m.role}:</strong> ${m.content}</div>`:'';}).join('');
    holder.appendChild(box);
  }
}

function renderMessages(){
  messageList.innerHTML='';
  for(const m of laneMessages()){
    if(m.role==='assistant'){
      const frag=assistantTemplate.content.cloneNode(true); const article=frag.querySelector('.message');
      article.dataset.id=m.id;
      article.querySelector('.message-content').textContent=m.content;
      article.querySelector('.side-branch.left').onclick=()=>beginDetour(m.id,'left');
      article.querySelector('.side-branch.right').onclick=()=>beginDetour(m.id,'right');
      renderDetourTags(article,m); renderDetourInline(article,m);
      messageList.appendChild(frag);
    } else {
      const article=document.createElement('article'); article.className='message user';
      article.innerHTML=`<div class="message-card">${m.content}</div>`; messageList.appendChild(article);
    }
  }
}

function buildContext(){
  const lane=laneMessages();
  return `Context rule: ${pendingDetour?'branch origin + detour history':'main thread history'}\n\n`+lane.map((m,i)=>`${i+1}. ${m.role}: ${m.content}`).join('\n');
}

function handleSend(){
  el('statusMsg').textContent='';
  const text=promptEl.value.trim(); if(!text) return;

  if(!pendingDetour){
    const u={id:uid(),role:'user',content:text,parentId:mainIds.at(-1)||null,branchId:'main',directionFromParent:'main'}; messages.push(u); mainIds.push(u.id);
    const a={id:uid(),role:'assistant',content:`Answer: ${text.slice(0,80)}`,parentId:u.id,branchId:'main',directionFromParent:'main'}; messages.push(a); mainIds.push(a.id);
  } else {
    const d=detours.get(pendingDetour.detourId);
    const branchParent=d.messageIds.at(-1) || d.originMessageId;
    const u={id:uid(),role:'user',content:text,parentId:branchParent,branchId:d.id,branchOriginId:d.originMessageId,directionFromParent:d.direction};
    messages.push(u); d.messageIds.push(u.id);
    const branchCtx=d.messageIds.map(id=>msgById(id)).filter(Boolean);
    const a={id:uid(),role:'assistant',content:`Detour ${d.direction}: ${text.slice(0,70)}`,parentId:u.id,branchId:d.id,branchOriginId:d.originMessageId,directionFromParent:d.direction};
    messages.push(a); d.messageIds.push(a.id);
    if(d.messageIds.length===2) d.title=summarizeDetourTitle(text);
  }

  promptEl.value='';
  promptEl.placeholder='Ask, refine, compare...';
  el('branchHint').textContent='Main thread';
  pendingDetour=null;
  render();
  messageList.parentElement.scrollTop=messageList.parentElement.scrollHeight;
}

function render(){renderMessages(); el('contextPreview').textContent=buildContext();}

el('sendBtn').onclick=handleSend;
el('toggleMetaBtn').onclick=()=>el('metaPanel').classList.toggle('hidden');

const introU={id:uid(),role:'user',content:'How should we improve this UI?',parentId:null,branchId:'main',directionFromParent:'main'};
const introA={id:uid(),role:'assistant',content:'Use a clean chat-first layout and attach subtle left/right detours to assistant messages.',parentId:introU.id,branchId:'main',directionFromParent:'main'};
messages.push(introU,introA); mainIds=[introU.id,introA.id];
render();
