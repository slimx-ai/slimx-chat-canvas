const TILE_W = 320;
const TILE_H = 180;
const STEP_X = TILE_W;
const STEP_Y = TILE_H;
const canvas = document.getElementById('canvas');
const minimap = document.getElementById('minimap');
const viewport = minimap.querySelector('.viewport');
const template = document.getElementById('nodeTemplate');
const contextPreview = document.getElementById('contextPreview');
const directionLabel = document.getElementById('branchDirection');
const promptInput = document.getElementById('prompt');
const activeNodeLabel = document.getElementById('activeNode');
const pathDepthLabel = document.getElementById('pathDepth');
const searchInput = document.getElementById('searchInput');

const nodes = new Map();
let selectedNodeId = null;
let selectedDirection = 'south';
let focusMode = false;
let camera = { x: 620, y: 300, zoom: 0.8 };
const OFFSETS = { north: { x: 0, y: -STEP_Y }, south: { x: 0, y: STEP_Y }, east: { x: STEP_X, y: 0 }, west: { x: -STEP_X, y: 0 } };

function createNode({ role, content, parentId = null, direction = null, tags = [] }) {
  const id = crypto.randomUUID();
  const parent = parentId ? nodes.get(parentId) : null;
  const coordinates = parent && direction ? { x: parent.coordinates.x + OFFSETS[direction].x, y: parent.coordinates.y + OFFSETS[direction].y } : { x: 0, y: 0 };
  const node = { id, role, content, coordinates, tags, parentId, children: { north: null, east: null, west: null, south: null } };
  nodes.set(id, node);
  if (parent && direction) parent.children[direction] = id;
  return node;
}

function contextPath(nodeId) {
  const path = [];
  let cursor = nodes.get(nodeId);
  while (cursor) {
    path.unshift(cursor);
    cursor = cursor.parentId ? nodes.get(cursor.parentId) : null;
  }
  return path;
}

function fakeAssistantReply(path, direction) {
  const stem = [...path].reverse().find((p) => p.role === 'user')?.content || 'idea';
  return `NEWS-${direction.toUpperCase()} synthesis:\n\n• Pulled only ancestor context\n• Proposed a refined viewpoint\n\nNext: ${stem.slice(0, 70)}`;
}

function updateInspector() {
  if (!selectedNodeId) return;
  const path = contextPath(selectedNodeId);
  activeNodeLabel.textContent = selectedNodeId.slice(0, 8);
  pathDepthLabel.textContent = String(path.length);
  contextPreview.textContent = path.map((p) => `${p.role}> ${p.content}`).join('\n\n');
}

function renderMinimap() {
  minimap.querySelectorAll('.minidot').forEach((n) => n.remove());
  for (const node of nodes.values()) {
    const dot = document.createElement('div');
    dot.className = 'minidot';
    dot.style.left = `${120 + node.coordinates.x / 16}px`;
    dot.style.top = `${75 + node.coordinates.y / 16}px`;
    minimap.appendChild(dot);
  }
  viewport.style.left = `${120 - camera.x / 16}px`;
  viewport.style.top = `${75 - camera.y / 16}px`;
  viewport.style.width = `${500 / camera.zoom / 16}px`;
  viewport.style.height = `${300 / camera.zoom / 16}px`;
}

function render() {
  canvas.innerHTML = '';
  const activePathSet = new Set(contextPath(selectedNodeId).map((n) => n.id));
  const q = searchInput.value.trim().toLowerCase();

  for (const node of nodes.values()) {
    if (q && !`${node.content} ${node.tags.join(' ')}`.toLowerCase().includes(q)) continue;
    const frag = template.content.cloneNode(true);
    const card = frag.querySelector('.node');
    card.style.left = `${node.coordinates.x}px`;
    card.style.top = `${node.coordinates.y}px`;
    card.querySelector('.role').textContent = node.role;
    card.querySelector('.role').classList.add(node.role);
    card.querySelector('.meta').textContent = `${node.coordinates.x}, ${node.coordinates.y}`;
    card.querySelector('.content').textContent = node.content;
    if (node.id === selectedNodeId) card.classList.add('active');
    if (activePathSet.has(node.id)) card.classList.add('path-node');
    const tags = card.querySelector('.tags');
    node.tags.forEach((t) => { const s = document.createElement('span'); s.textContent = t; tags.appendChild(s); });

    card.onclick = () => { selectedNodeId = node.id; updateInspector(); render(); };
    card.querySelectorAll('.branch-arrow').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); selectedDirection = b.dataset.dir; directionLabel.textContent = selectedDirection; selectedNodeId = node.id; updateInspector(); render(); };
    });
    canvas.appendChild(frag);
  }
  canvas.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
  canvas.classList.toggle('focus-dim', focusMode);
  renderMinimap();
}

document.getElementById('sendBtn').onclick = () => {
  const text = promptInput.value.trim();
  if (!text || !selectedNodeId) return;
  const userNode = createNode({ role: 'user', content: text, parentId: selectedNodeId, direction: selectedDirection });
  const path = contextPath(userNode.id);
  const assistant = createNode({ role: 'assistant', content: fakeAssistantReply(path, selectedDirection), parentId: userNode.id, direction: selectedDirection, tags: [selectedDirection, 'auto'] });
  selectedNodeId = assistant.id;
  promptInput.value = '';
  updateInspector();
  render();
};

document.getElementById('focusBtn').onclick = () => { focusMode = !focusMode; render(); };
document.getElementById('fitBtn').onclick = () => { camera = { x: 620, y: 300, zoom: 0.8 }; render(); };
document.getElementById('newSessionBtn').onclick = () => window.location.reload();
searchInput.oninput = () => render();

window.onkeydown = (e) => {
  const map = { ArrowUp: 'north', ArrowRight: 'east', ArrowLeft: 'west', ArrowDown: 'south' };
  if ((e.metaKey || e.ctrlKey) && map[e.key]) {
    selectedDirection = map[e.key];
    directionLabel.textContent = selectedDirection;
  }
};

canvas.onwheel = (e) => { e.preventDefault(); camera.zoom = Math.max(0.3, Math.min(2.2, camera.zoom + (e.deltaY < 0 ? 0.08 : -0.08))); render(); };
let panning = false; let last = null;
canvas.onmousedown = (e) => { if (e.target === canvas) { panning = true; last = { x: e.clientX, y: e.clientY }; } };
window.onmouseup = () => panning = false;
window.onmousemove = (e) => { if (!panning || !last) return; camera.x += e.clientX - last.x; camera.y += e.clientY - last.y; last = { x: e.clientX, y: e.clientY }; render(); };

const root = createNode({ role: 'system', content: 'Root orchestration node. Branch with NEWS controls to explore independent angles.', tags: ['root', 'strategy'] });
const seedA = createNode({ role: 'assistant', content: 'Primary South lane: architecture and execution plan.', parentId: root.id, direction: 'south', tags: ['plan'] });
createNode({ role: 'assistant', content: 'East lane: UX polish and interaction model.', parentId: root.id, direction: 'east', tags: ['ux'] });
createNode({ role: 'assistant', content: 'West lane: performance and scaling strategy.', parentId: root.id, direction: 'west', tags: ['perf'] });
selectedNodeId = seedA.id;

document.getElementById('threadList').innerHTML = '<li>Gemini-quality Workspace</li><li>NEWS Planning Session</li>';
updateInspector();
render();
