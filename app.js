const TILE_W = 320;
const TILE_H = 180;
const OFFSETS = { north: { x: 0, y: -TILE_H }, south: { x: 0, y: TILE_H }, east: { x: TILE_W, y: 0 }, west: { x: -TILE_W, y: 0 } };

const canvas = document.getElementById('canvas');
const edgesSvg = document.getElementById('edges');
const minimap = document.getElementById('minimap');
const viewport = minimap.querySelector('.viewport');
const onboarding = document.getElementById('onboarding');
const template = document.getElementById('nodeTemplate');
const nodes = new Map();
let selectedNodeId = null, selectedDirection = 'south', focusMode = false, contextMode = 'focused', minimapOpen = true;
let camera = { x: 620, y: 260, zoom: 0.8 };

const el = (id) => document.getElementById(id);

function createNode({ role, content, parentId = null, direction = null, tags = [] }) {
  const id = crypto.randomUUID();
  const parent = parentId ? nodes.get(parentId) : null;
  const coordinates = parent && direction ? { x: parent.coordinates.x + OFFSETS[direction].x, y: parent.coordinates.y + OFFSETS[direction].y } : { x: 0, y: 0 };
  const node = { id, role, content, coordinates, tags, parentId, children: { north: [], east: [], west: [], south: [] } };
  nodes.set(id, node);
  if (parent && direction) parent.children[direction].push(id);
  return node;
}
const contextPath = (id) => { const path = []; let c = nodes.get(id); while (c) { path.unshift(c); c = c.parentId ? nodes.get(c.parentId) : null; } return path; };
function findBranchOrigin(nodeId) { const root = [...nodes.values()].find((n) => !n.parentId); const path = contextPath(nodeId); return path.find((n) => n.parentId === root?.id) || path[1] || path[0]; }
function focusedContext(nodeId) { const path = contextPath(nodeId); if (path.length <= 2) return path; const origin = findBranchOrigin(nodeId); const idx = path.findIndex((n) => n.id === origin.id); return [path[0], ...path.slice(Math.max(1, idx))]; }
const buildContext = (nodeId) => (contextMode === 'ancestor' ? contextPath(nodeId) : focusedContext(nodeId));
const fakeAssistantReply = (path, d) => `NEWS-${d.toUpperCase()} synthesis:\n\nContext mode: ${contextMode}\nIncludes ${path.length} nodes from branch origin + active lane.`;

const nodeAt = (x, y) => [...nodes.values()].find((n) => n.coordinates.x === x && n.coordinates.y === y) || null;
const targetFor = (node, direction) => ({ x: node.coordinates.x + OFFSETS[direction].x, y: node.coordinates.y + OFFSETS[direction].y });
const childAtDirection = (node, direction) => (node.children[direction] || []).map((id) => nodes.get(id)).find(Boolean) || null;

function graphBounds() { const arr = [...nodes.values()]; const xs = arr.map((n) => n.coordinates.x), ys = arr.map((n) => n.coordinates.y); return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs) + TILE_W, maxY: Math.max(...ys) + TILE_H }; }
function applyCamera() { canvas.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`; edgesSvg.style.transform = canvas.style.transform; }
function fitToGraph() { const b = graphBounds(); const vw = window.innerWidth - 620, vh = window.innerHeight - 240; const z = Math.max(.25, Math.min(1.4, Math.min(vw / (b.maxX - b.minX + 80), vh / (b.maxY - b.minY + 80)))); camera.zoom = z; camera.x = -(b.minX * z) + 30; camera.y = -(b.minY * z) + 30; applyCamera(); renderMinimap(); }
function centerOnNode(node) { const rect = document.querySelector('.canvas-wrap').getBoundingClientRect(); const composerH = document.querySelector('.composer').getBoundingClientRect().height; const usableH = rect.height - composerH * 0.15; camera.x = rect.width / 2 - (node.coordinates.x + TILE_W / 2) * camera.zoom; camera.y = usableH / 2 - (node.coordinates.y + TILE_H / 2) * camera.zoom; applyCamera(); renderMinimap(); }

function renderEdges(activeSet) { edgesSvg.innerHTML = ''; for (const n of nodes.values()) { if (!n.parentId) continue; const p = nodes.get(n.parentId); const l = document.createElementNS('http://www.w3.org/2000/svg', 'line'); l.setAttribute('x1', p.coordinates.x + TILE_W / 2); l.setAttribute('y1', p.coordinates.y + TILE_H / 2); l.setAttribute('x2', n.coordinates.x + TILE_W / 2); l.setAttribute('y2', n.coordinates.y + TILE_H / 2); l.setAttribute('class', `edge ${activeSet.has(n.id) && activeSet.has(p.id) ? 'active' : ''}`); edgesSvg.appendChild(l); } }

function renderNodes() {
  canvas.innerHTML = '';
  const activeSet = new Set(contextPath(selectedNodeId).map((n) => n.id));
  const q = el('searchInput').value.trim().toLowerCase();
  for (const node of nodes.values()) {
    const frag = template.content.cloneNode(true), card = frag.querySelector('.node');
    card.classList.add(node.role);
    card.style.left = `${node.coordinates.x}px`; card.style.top = `${node.coordinates.y}px`;
    if (q && !`${node.content} ${node.tags.join(' ')}`.toLowerCase().includes(q)) card.style.opacity = '.25';
    if (node.id === selectedNodeId) card.classList.add('active'); if (activeSet.has(node.id)) card.classList.add('path-node');
    card.querySelector('.role').textContent = node.role;
    card.querySelector('.role').classList.add(node.role);
    card.querySelector('.meta').textContent = `${node.coordinates.x},${node.coordinates.y}`;
    card.querySelector('.content').textContent = node.content;
    node.tags.forEach((t) => { const s = document.createElement('span'); s.textContent = t; card.querySelector('.tags').appendChild(s); });
    card.onclick = () => { selectedNodeId = node.id; updateInspector(); rerender(); };
    card.querySelectorAll('.branch-arrow').forEach((b) => {
      const dir = b.dataset.dir, t = targetFor(node, dir), occupant = nodeAt(t.x, t.y), child = childAtDirection(node, dir);
      b.classList.remove('has-child', 'blocked'); b.disabled = false;
      if (!occupant) b.title = `Create ${dir} branch`; else if (child && occupant.id === child.id) { b.title = `Go to ${dir} branch`; b.classList.add('has-child'); } else { b.title = 'Blocked: tile occupied'; b.disabled = true; b.classList.add('blocked'); }
      b.onclick = (e) => { e.stopPropagation(); if (b.disabled) return; selectedDirection = dir; updateBranchUI(); selectedNodeId = occupant && child && occupant.id === child.id ? occupant.id : node.id; updateInspector(); rerender(); };
    });
    canvas.appendChild(frag);
  }
  canvas.classList.toggle('focus-dim', focusMode);
  renderEdges(activeSet);
}

function renderMinimap() {
  minimap.querySelectorAll('.minidot').forEach((n) => n.remove());
  if (!minimapOpen) return;
  const b = graphBounds(), w = b.maxX - b.minX, h = b.maxY - b.minY, sx = 200 / Math.max(w, 1), sy = 120 / Math.max(h, 1);
  for (const n of nodes.values()) { const d = document.createElement('div'); d.className = 'minidot'; d.style.left = `${10 + (n.coordinates.x - b.minX) * sx}px`; d.style.top = `${10 + (n.coordinates.y - b.minY) * sy}px`; minimap.appendChild(d); }
  viewport.style.left = `${10 + ((-camera.x / camera.zoom) - b.minX) * sx}px`;
  viewport.style.top = `${10 + ((-camera.y / camera.zoom) - b.minY) * sy}px`;
  viewport.style.width = `${(window.innerWidth / camera.zoom) * sx}px`;
  viewport.style.height = `${(window.innerHeight / camera.zoom) * sy}px`;
}

function updateBranchUI() { el('branchDirection').textContent = selectedDirection; document.querySelectorAll('#compass button').forEach((b) => b.classList.toggle('active', b.dataset.dir === selectedDirection)); }
function updateInspector() {
  const included = buildContext(selectedNodeId), all = contextPath(selectedNodeId), current = nodes.get(selectedNodeId);
  el('activeNode').textContent = `${current?.role || '—'} · ${selectedDirection}`;
  el('pathDepth').textContent = String(included.length);
  el('contextPreview').textContent = `Context rule: ${contextMode}\n\nIncluded:\n${included.map((n, i) => `${i + 1}. ${n.content}`).join('\n')}\n\nExcluded:\n- ${Math.max(0, all.length - included.length)} older path nodes\n- sibling branches unless explicitly referenced`;
  el('actionBar').textContent = `Replying to: ${current?.content?.slice(0, 35) || 'none'} · Branch: ${selectedDirection} · Context depth: ${included.length}`;
}
function rerender() { renderNodes(); applyCamera(); renderMinimap(); onboarding.style.display = [...nodes.values()].some((n) => n.role === 'user') ? 'none' : 'block'; }

el('sendBtn').onclick = () => {
  const text = el('prompt').value.trim(); if (!text || !selectedNodeId) return;
  const base = nodes.get(selectedNodeId), t = targetFor(base, selectedDirection), occupant = nodeAt(t.x, t.y), child = childAtDirection(base, selectedDirection);
  if (occupant && (!child || occupant.id !== child.id)) return;
  if (occupant && child && occupant.id === child.id) { selectedNodeId = occupant.id; updateInspector(); rerender(); centerOnNode(nodes.get(selectedNodeId)); return; }
  const user = createNode({ role: 'user', content: text, parentId: selectedNodeId, direction: selectedDirection, tags: [selectedDirection] });
  const assistant = createNode({ role: 'assistant', content: fakeAssistantReply(buildContext(user.id), selectedDirection), parentId: user.id, direction: selectedDirection, tags: ['auto'] });
  selectedNodeId = assistant.id; el('prompt').value = ''; updateInspector(); rerender(); centerOnNode(assistant);
};

document.querySelectorAll('#compass button').forEach((b) => b.onclick = () => { selectedDirection = b.dataset.dir; updateBranchUI(); });
el('focusBtn').onclick = () => { focusMode = !focusMode; rerender(); };
el('fitBtn').onclick = () => fitToGraph();
el('zoomInBtn').onclick = () => { camera.zoom = Math.min(2.2, camera.zoom + .1); applyCamera(); renderMinimap(); };
el('zoomOutBtn').onclick = () => { camera.zoom = Math.max(.25, camera.zoom - .1); applyCamera(); renderMinimap(); };
el('searchInput').oninput = () => rerender();
el('newSessionBtn').onclick = () => location.reload();
el('toggleMinimapBtn').onclick = () => { minimapOpen = !minimapOpen; minimap.classList.toggle('minimap-collapsed', !minimapOpen); el('toggleMinimapBtn').textContent = minimapOpen ? 'Minimap ▼' : 'Minimap ▶'; renderMinimap(); };
el('helpBtn').onclick = () => { onboarding.style.display = onboarding.style.display === 'none' ? 'block' : 'none'; };

window.onkeydown = (e) => { const map = { ArrowUp: 'north', ArrowRight: 'east', ArrowLeft: 'west', ArrowDown: 'south' }; if ((e.metaKey || e.ctrlKey) && map[e.key]) { selectedDirection = map[e.key]; updateBranchUI(); } if (e.key === '/' && document.activeElement !== el('searchInput')) { e.preventDefault(); el('searchInput').focus(); } if (e.key.toLowerCase() === 'm') { contextMode = contextMode === 'focused' ? 'ancestor' : 'focused'; updateInspector(); } };

canvas.onwheel = (e) => { e.preventDefault(); camera.zoom = Math.max(.25, Math.min(2.2, camera.zoom + (e.deltaY < 0 ? .07 : -.07))); applyCamera(); renderMinimap(); };
let pan = false, last = null;
canvas.onmousedown = (e) => { if (e.target === canvas || e.target === edgesSvg) { pan = true; last = { x: e.clientX, y: e.clientY }; } };
window.onmouseup = () => pan = false;
window.onmousemove = (e) => { if (!pan || !last) return; camera.x += e.clientX - last.x; camera.y += e.clientY - last.y; last = { x: e.clientX, y: e.clientY }; applyCamera(); renderMinimap(); };

const root = createNode({ role: 'system', content: 'Root orchestration node', tags: ['root'] });
const s = createNode({ role: 'assistant', content: 'Primary South lane: architecture plan', parentId: root.id, direction: 'south', tags: ['plan'] });
createNode({ role: 'assistant', content: 'East lane: UX polish', parentId: root.id, direction: 'east', tags: ['ux'] });
createNode({ role: 'assistant', content: 'West lane: performance strategy', parentId: root.id, direction: 'west', tags: ['perf'] });
selectedNodeId = s.id;
el('threadList').innerHTML = '<li>Gemini-quality Workspace</li><li>NEWS Planning Session</li>';
updateBranchUI(); updateInspector(); rerender(); centerOnNode(s);
