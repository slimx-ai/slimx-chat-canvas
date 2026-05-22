const TILE_W = 320, TILE_H = 180;
const OFFSETS = { north: { x: 0, y: -TILE_H }, south: { x: 0, y: TILE_H }, east: { x: TILE_W, y: 0 }, west: { x: -TILE_W, y: 0 } };
const canvas = document.getElementById('canvas');
const edgesSvg = document.getElementById('edges');
const minimap = document.getElementById('minimap');
const viewport = minimap.querySelector('.viewport');
const template = document.getElementById('nodeTemplate');
const nodes = new Map();
let selectedNodeId = null, selectedDirection = 'south', focusMode = false;
let camera = { x: 620, y: 260, zoom: 0.8 };

const el = (id) => document.getElementById(id);

function createNode({ role, content, parentId = null, direction = null, tags = [] }) {
  const id = crypto.randomUUID();
  const p = parentId ? nodes.get(parentId) : null;
  const coordinates = p && direction ? { x: p.coordinates.x + OFFSETS[direction].x, y: p.coordinates.y + OFFSETS[direction].y } : { x: 0, y: 0 };
  const node = { id, role, content, coordinates, tags, parentId, directionFromParent: direction, children: { north: [], east: [], west: [], south: [] } };
  nodes.set(id, node);
  if (p && direction) p.children[direction].push(id);
  return node;
}
const contextPath = (id) => { const p=[]; let c=nodes.get(id); while(c){p.unshift(c); c=c.parentId?nodes.get(c.parentId):null;} return p; };
const fakeAssistantReply = (path,d)=>`NEWS-${d.toUpperCase()} synthesis:\n\nUsed ancestor-only context (${path.length} nodes).`;

function graphBounds(){const arr=[...nodes.values()]; const xs=arr.map(n=>n.coordinates.x), ys=arr.map(n=>n.coordinates.y); return {minX:Math.min(...xs),minY:Math.min(...ys),maxX:Math.max(...xs)+TILE_W,maxY:Math.max(...ys)+TILE_H};}
function fitToGraph(){ const b=graphBounds(); const vw=window.innerWidth-260-300-60, vh=window.innerHeight-220; const zw=Math.max(.25,Math.min(1.5,vw/(b.maxX-b.minX+80))); const zh=Math.max(.25,Math.min(1.5,vh/(b.maxY-b.minY+80))); camera.zoom=Math.min(zw,zh); camera.x=-(b.minX*camera.zoom)+20; camera.y=-(b.minY*camera.zoom)+20; applyCamera(); renderMinimap(); }
function applyCamera(){ canvas.style.transform=`translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`; edgesSvg.style.transform=canvas.style.transform; }

function renderEdges(activeSet){ edgesSvg.innerHTML=''; for(const n of nodes.values()){ if(!n.parentId) continue; const p=nodes.get(n.parentId); const l=document.createElementNS('http://www.w3.org/2000/svg','line'); l.setAttribute('x1',p.coordinates.x+TILE_W/2); l.setAttribute('y1',p.coordinates.y+TILE_H/2); l.setAttribute('x2',n.coordinates.x+TILE_W/2); l.setAttribute('y2',n.coordinates.y+TILE_H/2); l.setAttribute('class',`edge ${activeSet.has(n.id)&&activeSet.has(p.id)?'active':''}`); edgesSvg.appendChild(l);} }

function renderNodes(){
  canvas.innerHTML='';
  const activePath=contextPath(selectedNodeId); const activeSet=new Set(activePath.map(n=>n.id)); const q=el('searchInput').value.trim().toLowerCase();
  for(const node of nodes.values()){
    const frag=template.content.cloneNode(true), card=frag.querySelector('.node');
    card.classList.add(node.role); // critical fix
    card.style.left=`${node.coordinates.x}px`; card.style.top=`${node.coordinates.y}px`;
    if(q && !`${node.content} ${node.tags.join(' ')}`.toLowerCase().includes(q)) card.style.opacity='.25';
    if(node.id===selectedNodeId) card.classList.add('active'); if(activeSet.has(node.id)) card.classList.add('path-node');
    card.querySelector('.role').textContent=node.role; card.querySelector('.role').classList.add(node.role); card.querySelector('.meta').textContent=`${node.coordinates.x},${node.coordinates.y}`; card.querySelector('.content').textContent=node.content;
    const tags=card.querySelector('.tags'); node.tags.forEach(t=>{const s=document.createElement('span'); s.textContent=t; tags.appendChild(s);});
    card.onclick=()=>{selectedNodeId=node.id; updateInspector(); rerender();}; card.onkeydown=(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectedNodeId=node.id;updateInspector();rerender();}};
    card.querySelectorAll('.branch-arrow').forEach(b=>b.onclick=(e)=>{e.stopPropagation();selectedDirection=b.dataset.dir;updateBranchUI();selectedNodeId=node.id;updateInspector();rerender();});
    canvas.appendChild(frag);
  }
  canvas.classList.toggle('focus-dim', focusMode); renderEdges(activeSet);
}
function renderMinimap(){ minimap.querySelectorAll('.minidot').forEach(n=>n.remove()); const b=graphBounds(); const w=b.maxX-b.minX,h=b.maxY-b.minY, sx=200/Math.max(w,1), sy=120/Math.max(h,1); for(const n of nodes.values()){const d=document.createElement('div'); d.className='minidot'; d.style.left=`${10+(n.coordinates.x-b.minX)*sx}px`; d.style.top=`${10+(n.coordinates.y-b.minY)*sy}px`; minimap.appendChild(d);} viewport.style.left=`${10+((-camera.x/camera.zoom)-b.minX)*sx}px`; viewport.style.top=`${10+((-camera.y/camera.zoom)-b.minY)*sy}px`; viewport.style.width=`${(window.innerWidth/camera.zoom)*sx}px`; viewport.style.height=`${(window.innerHeight/camera.zoom)*sy}px`; }

function updateBranchUI(){ el('branchDirection').textContent=selectedDirection; document.querySelectorAll('#compass button').forEach(b=>b.classList.toggle('active',b.dataset.dir===selectedDirection)); }
function updateInspector(){const p=contextPath(selectedNodeId); el('activeNode').textContent=selectedNodeId?.slice(0,8)||'—'; el('pathDepth').textContent=String(p.length); el('contextPreview').textContent=p.map(n=>`${n.role}> ${n.content}`).join('\n\n'); const t=nodes.get(selectedNodeId); el('actionBar').textContent=`Replying to: ${t?.content?.slice(0,35)||'none'} · Branch: ${selectedDirection} · Context depth: ${p.length}`;}
function rerender(){renderNodes();applyCamera();renderMinimap();}

el('sendBtn').onclick=()=>{const text=el('prompt').value.trim(); if(!text||!selectedNodeId) return; const u=createNode({role:'user',content:text,parentId:selectedNodeId,direction:selectedDirection,tags:[selectedDirection]}); const a=createNode({role:'assistant',content:fakeAssistantReply(contextPath(u.id),selectedDirection),parentId:u.id,direction:selectedDirection,tags:['auto']}); selectedNodeId=a.id; el('prompt').value=''; updateInspector(); rerender();};
el('focusBtn').onclick=()=>{focusMode=!focusMode; rerender();}; el('fitBtn').onclick=()=>fitToGraph();
el('zoomInBtn').onclick=()=>{camera.zoom=Math.min(2.2,camera.zoom+.1);applyCamera();renderMinimap();}; el('zoomOutBtn').onclick=()=>{camera.zoom=Math.max(.25,camera.zoom-.1);applyCamera();renderMinimap();};
el('searchInput').oninput=()=>rerender(); el('newSessionBtn').onclick=()=>location.reload();
document.querySelectorAll('#compass button').forEach(b=>b.onclick=()=>{selectedDirection=b.dataset.dir; updateBranchUI();});
window.onkeydown=(e)=>{const map={ArrowUp:'north',ArrowRight:'east',ArrowLeft:'west',ArrowDown:'south'}; if((e.metaKey||e.ctrlKey)&&map[e.key]){selectedDirection=map[e.key]; updateBranchUI();} if(e.key==='/'&&document.activeElement!==el('searchInput')){e.preventDefault();el('searchInput').focus();} if(e.key==='Escape'){el('prompt').blur();}};
canvas.onwheel=(e)=>{e.preventDefault();camera.zoom=Math.max(.25,Math.min(2.2,camera.zoom+(e.deltaY<0?.07:-.07)));applyCamera();renderMinimap();}; let pan=false,last=null; canvas.onmousedown=(e)=>{if(e.target===canvas||e.target===edgesSvg){pan=true;last={x:e.clientX,y:e.clientY};}}; window.onmouseup=()=>pan=false; window.onmousemove=(e)=>{if(!pan||!last)return;camera.x+=e.clientX-last.x;camera.y+=e.clientY-last.y;last={x:e.clientX,y:e.clientY};applyCamera();renderMinimap();};

const root=createNode({role:'system',content:'Root orchestration node',tags:['root']}); const s=createNode({role:'assistant',content:'Primary South lane: architecture plan',parentId:root.id,direction:'south',tags:['plan']}); createNode({role:'assistant',content:'East lane: UX polish',parentId:root.id,direction:'east',tags:['ux']}); createNode({role:'assistant',content:'West lane: performance strategy',parentId:root.id,direction:'west',tags:['perf']});
selectedNodeId=s.id; el('threadList').innerHTML='<li>Gemini-quality Workspace</li><li>NEWS Planning Session</li>'; updateBranchUI(); updateInspector(); rerender();
