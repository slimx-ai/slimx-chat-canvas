const el=(id)=>document.getElementById(id);
const messageList=el('messageList');
const assistantTemplate=el('assistantTemplate');
const branchRowTemplate=document.getElementById('branchRowTemplate');
const promptEl=el('prompt');

const messages=[];
const lanes=new Map();
const session={id:crypto.randomUUID(),title:'New session',mainLaneId:'main'};
lanes.set('main',{id:'main',originMessageId:null,direction:'main',title:'Main thread',messageIds:[],parentLaneId:null,collapsed:false});

let activeLaneId='main';
let activeOriginMessageId=null;
let activeDirection='main';

const uid=()=>crypto.randomUUID();
const msgById=(id)=>messages.find(m=>m.id===id);
const summarizeDetourTitle=(text)=>{const c=text.replace(/[?.!]/g,'').replace(/^(can you|please|explain|tell me|what about)\s+/i,'').trim();return c.split(/\s+/).slice(0,3).join(' ')||'Detour';};
const findDetour=(originId,dir)=>[...lanes.values()].find(l=>l.originMessageId===originId&&l.direction===dir) || null;

function buildContext(){
  const lane=lanes.get(activeLaneId);
  if(!lane||lane.id==='main') return lanes.get('main').messageIds.map(msgById).filter(Boolean);
  const origin=msgById(lane.originMessageId);
  const laneMsgs=lane.messageIds.map(msgById).filter(Boolean);
  return [origin,...laneMsgs].filter(Boolean);
}

function updateContextPreview(){
  const ctx=buildContext();
  el('contextPreview').textContent=`Context rule: ${activeLaneId==='main'?'main thread history':'origin + detour lane history'}\n\n${ctx.map((m,i)=>`${i+1}. ${m.role}: ${m.content}`).join('\n')}`;
}

function updateBranchHint(){
  const lane=lanes.get(activeLaneId);
  el('branchHint').textContent=activeLaneId==='main'?'Main thread':`${lane.direction==='left'?'Alternative':'Expansion'} detour`;
}

function openDetour(originMessageId,direction){
  const existing=findDetour(originMessageId,direction);
  if(existing){activeLaneId=existing.id; existing.collapsed=false;} else {
    const laneId=uid();
    const lane={id:laneId,originMessageId,direction,title:direction==='left'?'Alternative':'Expansion',messageIds:[],parentLaneId:'main',collapsed:false};
    lanes.set(laneId,lane);activeLaneId=laneId;
  }
  activeOriginMessageId=originMessageId; activeDirection=direction;
  updateBranchHint(); render(); promptEl.focus();
}

function openLane(laneId){const lane=lanes.get(laneId); if(!lane)return; activeLaneId=lane.id; activeOriginMessageId=lane.originMessageId; activeDirection=lane.direction; lane.collapsed=false; updateBranchHint(); render();}
function returnToMain(){const lane=lanes.get(activeLaneId); if(lane&&lane.id!=='main') lane.collapsed=true; activeLaneId='main'; activeOriginMessageId=null; activeDirection='main'; updateBranchHint(); render();}

function renderMessageBubble(msg){
  if(msg.role==='assistant') return `<article class="message assistant"><div class="message-card">${msg.content}</div></article>`;
  return `<article class="message user"><div class="message-card">${msg.content}</div></article>`;
}
function renderLaneMessages(laneId){const lane=lanes.get(laneId); if(!lane) return ''; return lane.messageIds.map(id=>msgById(id)).filter(Boolean).map(renderMessageBubble).join('');}

function renderDetourChips(message){
  const related=[...lanes.values()].filter(l=>l.originMessageId===message.id&&l.messageIds.length>0);
  if(!related.length) return '';
  return `<div class="detour-tags">${related.map(l=>`<button class="detour-tag" data-lane-id="${l.id}">${l.title} · ${l.messageIds.length} messages</button>`).join('')}</div>`;
}

function renderAssistantWithBranches(message){
  const leftLane=findDetour(message.id,'left');
  const rightLane=findDetour(message.id,'right');
  const activeForThisRow=activeOriginMessageId===message.id?activeDirection:'main';

  const rowFrag=branchRowTemplate.content.cloneNode(true);
  const row=rowFrag.querySelector('.branch-row');
  row.dataset.originId=message.id;
  row.dataset.active=activeForThisRow;

  const left=row.querySelector('.left-lane');
  left.innerHTML=`<div class="detour-head"><button class="back-main">← Back to main</button><span>Alternative detour</span></div>${leftLane?renderLaneMessages(leftLane.id):'<div class="detour-empty">Alternative from this answer</div>'}`;
  const main=row.querySelector('.main-lane');

  const assistantFrag=assistantTemplate.content.cloneNode(true);
  const article=assistantFrag.querySelector('.message');
  article.querySelector('.message-content').textContent=message.content;
  article.querySelector('.side-branch.left').onclick=()=>openDetour(message.id,'left');
  article.querySelector('.side-branch.right').onclick=()=>openDetour(message.id,'right');
  main.appendChild(assistantFrag);
  const chipsWrap=document.createElement('div'); chipsWrap.innerHTML=renderDetourChips(message); main.appendChild(chipsWrap);

  const right=row.querySelector('.right-lane');
  right.innerHTML=`<div class="detour-head"><button class="back-main">← Back to main</button><span>Expansion detour</span></div>${rightLane?renderLaneMessages(rightLane.id):'<div class="detour-empty">Expansion from this answer</div>'}`;

  row.querySelectorAll('.back-main').forEach(b=>b.onclick=()=>returnToMain());
  row.querySelectorAll('.detour-tag').forEach(btn=>btn.onclick=()=>openLane(btn.dataset.laneId));
  return rowFrag;
}

function render(){
  messageList.innerHTML='';
  const mainLane=lanes.get('main');
  for(const id of mainLane.messageIds){
    const m=msgById(id); if(!m) continue;
    if(m.role==='assistant') messageList.appendChild(renderAssistantWithBranches(m));
    else {const wrap=document.createElement('div'); wrap.innerHTML=renderMessageBubble(m); messageList.appendChild(wrap.firstChild);} 
  }
  updateContextPreview();
}

function makeFakeAssistantReply(text,lane){return `${lane.direction==='main'?'Answer':'Detour'}: ${text.slice(0,80)}`;}
function handleSend(){
  const text=promptEl.value.trim(); if(!text) return;
  const lane=lanes.get(activeLaneId);
  const previousId=lane.messageIds.at(-1)||lane.originMessageId||null;
  const user={id:uid(),role:'user',content:text,laneId:activeLaneId,parentId:previousId,createdAt:Date.now()}; messages.push(user); lane.messageIds.push(user.id);
  const assistant={id:uid(),role:'assistant',content:makeFakeAssistantReply(text,lane),laneId:activeLaneId,parentId:user.id,createdAt:Date.now()}; messages.push(assistant); lane.messageIds.push(assistant.id);
  if(lane.id!=='main'&&lane.messageIds.length===2) lane.title=summarizeDetourTitle(text);
  promptEl.value=''; render();
}

el('sendBtn').onclick=handleSend;
el('toggleMetaBtn').onclick=()=>el('metaPanel').classList.toggle('hidden');

const u={id:uid(),role:'user',content:'Analyze this project carefully.',laneId:'main',parentId:null,createdAt:Date.now()};
const a={id:uid(),role:'assistant',content:'Here is a detailed UI review with a cleaner interaction model.',laneId:'main',parentId:u.id,createdAt:Date.now()};
messages.push(u,a); lanes.get('main').messageIds.push(u.id,a.id);
updateBranchHint(); render();
