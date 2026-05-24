const el = (id) => document.getElementById(id);

const chatWindow = el('chatWindow');
const messageList = el('messageList');
const assistantTemplate = el('assistantTemplate');
const branchRowTemplate = el('branchRowTemplate');
const promptEl = el('prompt');
const sendBtn = el('sendBtn');
const branchHint = el('branchHint');
const statusMsg = el('statusMsg');
const backToMainBtn = el('backToMainBtn');

const MAIN_LANE_ID = 'main';
const messages = [];
const messagesById = new Map();
const lanes = new Map();
const renderedMainMessageIds = new Set();
const branchRowByOriginId = new Map();

const session = {
  id: crypto.randomUUID(),
  title: 'New session',
  mainLaneId: MAIN_LANE_ID,
};

lanes.set(MAIN_LANE_ID, {
  id: MAIN_LANE_ID,
  originMessageId: null,
  direction: 'main',
  title: 'Main thread',
  messageIds: [],
  parentLaneId: null,
  collapsed: false,
});

const state = {
  activeLaneId: MAIN_LANE_ID,
  activeOriginMessageId: null,
  activeDirection: 'main',
};

const uid = () => crypto.randomUUID();
const msgById = (id) => messagesById.get(id) || null;
const laneById = (id) => lanes.get(id) || null;

function directionLabel(direction) {
  if (direction === 'left') return 'Alternative';
  if (direction === 'right') return 'Expansion';
  return 'Main thread';
}

function summarizeDetourTitle(text) {
  const cleaned = text
    .replace(/[?.!]/g, '')
    .replace(/^(can you|please|explain|tell me|what about|show me|give me)\s+/i, '')
    .trim();

  return cleaned.split(/\s+/).slice(0, 4).join(' ') || 'Detour';
}

function findDetour(originMessageId, direction) {
  return [...lanes.values()].find(
    (lane) => lane.originMessageId === originMessageId && lane.direction === direction,
  ) || null;
}

function getOriginRow(originMessageId) {
  return messageList.querySelector(`[data-origin-id="${originMessageId}"]`);
}

function activeLane() {
  return laneById(state.activeLaneId) || laneById(MAIN_LANE_ID);
}
function transition(patch) { Object.assign(state, patch); }

function buildContextMessages() {
  const lane = activeLane();

  if (!lane || lane.id === MAIN_LANE_ID) {
    return laneById(MAIN_LANE_ID).messageIds.map(msgById).filter(Boolean);
  }

  const origin = msgById(lane.originMessageId);
  const laneMessages = lane.messageIds.map(msgById).filter(Boolean);
  return [origin, ...laneMessages].filter(Boolean);
}

function updateContextPreview() {
  const ctx = buildContextMessages();
  const rule = state.activeLaneId === MAIN_LANE_ID
    ? 'main thread history'
    : 'origin assistant answer + active detour history';

  el('contextPreview').textContent = [
    `Context rule: ${rule}`,
    '',
    ...ctx.map((message, index) => `${index + 1}. ${message.role}: ${message.content}`),
  ].join('\n');
}

function updateBranchHint() {
  const lane = activeLane();

  if (!lane || lane.id === MAIN_LANE_ID) {
    branchHint.textContent = 'Main thread';
    backToMainBtn.classList.add('hidden');
    promptEl.placeholder = 'Ask, refine, compare...';
    return;
  }

  const origin = msgById(lane.originMessageId);
  const originSnippet = origin?.content?.slice(0, 60) || 'selected answer';
  branchHint.textContent = `${directionLabel(lane.direction)} detour from: ${originSnippet}`;
  backToMainBtn.classList.remove('hidden');
  promptEl.placeholder = lane.direction === 'left'
    ? 'Ask an alternative angle...'
    : 'Expand this answer...';
}

function showStatus(text) {
  statusMsg.textContent = text || '';
}

function makeMessage({ role, content, laneId, parentId = null }) {
  return {
    id: uid(),
    role,
    content,
    laneId,
    parentId,
    createdAt: Date.now(),
  };
}
function addMessage(message) {
  messages.push(message);
  messagesById.set(message.id, message);
}

function makeFakeAssistantReply(text, lane) {
  if (lane.id === MAIN_LANE_ID) return `Answer: ${text.slice(0, 120)}`;
  return `${directionLabel(lane.direction)} detour: ${text.slice(0, 120)}`;
}

function createOrOpenDetour(originMessageId, direction) {
  const origin = msgById(originMessageId);
  if (!origin || origin.role !== 'assistant') {
    showStatus('You can only branch from an assistant answer.');
    return;
  }

  let lane = findDetour(originMessageId, direction);

  if (!lane) {
    lane = {
      id: uid(),
      originMessageId,
      direction,
      title: directionLabel(direction),
      messageIds: [],
      parentLaneId: MAIN_LANE_ID,
      collapsed: false,
    };
    lanes.set(lane.id, lane);
  }

  transition({ activeLaneId: lane.id, activeOriginMessageId: originMessageId, activeDirection: direction });
  lane.collapsed = false;

  showStatus(`${directionLabel(direction)} detour opened.`);
  render();
  updateBranchHint();

  requestAnimationFrame(() => {
    getOriginRow(originMessageId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    promptEl.focus();
  });
}

function openLane(laneId) {
  const lane = laneById(laneId);
  if (!lane || lane.id === MAIN_LANE_ID) return;

  transition({ activeLaneId: lane.id, activeOriginMessageId: lane.originMessageId, activeDirection: lane.direction });
  lane.collapsed = false;

  showStatus(`Now viewing ${directionLabel(lane.direction).toLowerCase()} detour.`);
  render();
  updateBranchHint();

  requestAnimationFrame(() => {
    getOriginRow(lane.originMessageId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    promptEl.focus();
  });
}

function returnToMain() {
  const lane = activeLane();
  if (lane && lane.id !== MAIN_LANE_ID) lane.collapsed = true;

  transition({ activeLaneId: MAIN_LANE_ID, activeOriginMessageId: null, activeDirection: 'main' });

  showStatus('');
  render();
  updateBranchHint();
}

function createMessageElement(message, options = {}) {
  const article = document.createElement('article');
  article.className = `message ${message.role}`;
  if (options.compact) article.classList.add('compact');

  const card = document.createElement('div');
  card.className = 'message-card';
  card.textContent = message.content;
  if (message.role === 'assistant') {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(message.content);
      showStatus('Copied response to clipboard.');
    });
    card.appendChild(copyBtn);
  }
  article.appendChild(card);
  return article;
}

function createDetourTag(lane) {
  const tag = document.createElement('button');
  tag.className = 'detour-tag';
  tag.type = 'button';
  tag.dataset.laneId = lane.id;

  const messageCount = lane.messageIds.length;
  const turns = Math.max(1, Math.ceil(messageCount / 2));
  tag.textContent = `${directionLabel(lane.direction)}: ${lane.title} · ${turns}`;
  tag.title = `Open ${directionLabel(lane.direction).toLowerCase()} detour`;
  tag.addEventListener('click', () => openLane(lane.id));
  return tag;
}

function renderDetourTags(container, originMessage) {
  const related = [...lanes.values()].filter(
    (lane) => lane.originMessageId === originMessage.id && lane.messageIds.length > 0,
  );

  if (!related.length) return;

  const label = document.createElement('span');
  label.className = 'detour-label';
  label.textContent = 'Detours';
  container.appendChild(label);

  related.forEach((lane) => container.appendChild(createDetourTag(lane)));
}

function renderMainAssistantLane(container, message) {
  const assistantFrag = assistantTemplate.content.cloneNode(true);
  const article = assistantFrag.querySelector('.message');
  article.dataset.id = message.id;
  article.querySelector('.message-content').textContent = message.content;

  const leftButton = article.querySelector('.side-branch.left');
  const rightButton = article.querySelector('.side-branch.right');
  if (findDetour(message.id, 'left')) leftButton.dataset.hasDetour = 'true';
  if (findDetour(message.id, 'right')) rightButton.dataset.hasDetour = 'true';
  leftButton.addEventListener('click', () => createOrOpenDetour(message.id, 'left'));
  rightButton.addEventListener('click', () => createOrOpenDetour(message.id, 'right'));

  const tags = article.querySelector('.detour-tags');
  renderDetourTags(tags, message);

  container.appendChild(assistantFrag);
}

function renderDetourLane(container, originMessage, direction) {
  const lane = findDetour(originMessage.id, direction);

  const header = document.createElement('div');
  header.className = 'detour-head';

  const back = document.createElement('button');
  back.className = 'back-main';
  back.type = 'button';
  back.textContent = '← Back to main';
  back.addEventListener('click', returnToMain);

  const title = document.createElement('div');
  title.className = 'detour-title';
  title.textContent = `${directionLabel(direction)} detour`;

  const origin = document.createElement('div');
  origin.className = 'detour-origin';
  origin.textContent = `From: ${originMessage.content.slice(0, 90)}`;

  header.append(back, title, origin);
  container.appendChild(header);

  if (!lane || lane.messageIds.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'detour-empty';
    empty.textContent = direction === 'left'
      ? 'Ask for an alternative interpretation, critique, or competing option.'
      : 'Ask to expand, deepen, or explore a related angle.';
    container.appendChild(empty);
    return;
  }

  const thread = document.createElement('div');
  thread.className = 'detour-thread';

  lane.messageIds
    .map(msgById)
    .filter(Boolean)
    .forEach((message) => thread.appendChild(createMessageElement(message, { compact: true })));

  container.appendChild(thread);
}

function renderAssistantBranchRow(message) {
  const rowFrag = branchRowTemplate.content.cloneNode(true);
  const row = rowFrag.querySelector('.branch-row');
  row.dataset.originId = message.id;
  row.dataset.active = state.activeOriginMessageId === message.id ? state.activeDirection : 'main';

  renderDetourLane(row.querySelector('.left-lane'), message, 'left');
  renderMainAssistantLane(row.querySelector('.main-lane'), message);
  renderDetourLane(row.querySelector('.right-lane'), message, 'right');

  return rowFrag;
}

function renderMainThread() {
  const mainLane = laneById(MAIN_LANE_ID);
  mainLane.messageIds
    .map(msgById)
    .filter(Boolean)
    .forEach((message) => {
      if (renderedMainMessageIds.has(message.id)) return;
      if (message.role === 'assistant') {
        const row = renderAssistantBranchRow(message);
        const rowEl = row.querySelector('.branch-row');
        branchRowByOriginId.set(message.id, rowEl);
        messageList.appendChild(row);
      } else {
        messageList.appendChild(createMessageElement(message));
      }
      renderedMainMessageIds.add(message.id);
    });
  branchRowByOriginId.forEach((row, originId) => {
    row.dataset.active = state.activeOriginMessageId === originId ? state.activeDirection : 'main';
  });
}

function render() {
  renderMainThread();
  updateBranchHint();
  updateContextPreview();
}

function scrollToConversationEnd() {
  requestAnimationFrame(() => {
    if (state.activeLaneId === MAIN_LANE_ID) {
      chatWindow.scrollTo({ top: chatWindow.scrollHeight, behavior: 'smooth' });
      return;
    }

    const lane = activeLane();
    getOriginRow(lane.originMessageId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function autoResizePrompt() {
  promptEl.style.height = 'auto';
  promptEl.style.height = `${Math.min(promptEl.scrollHeight, 180)}px`;
}

async function handleSend() {
  const text = promptEl.value.trim();
  if (!text) return;

  const lane = activeLane();
  const previousId = lane.messageIds.at(-1) || lane.originMessageId || null;

  const user = makeMessage({ role: 'user', content: text, laneId: lane.id, parentId: previousId });
  addMessage(user);
  lane.messageIds.push(user.id);

  const pendingAssistant = makeMessage({
    role: 'assistant',
    content: '…',
    laneId: lane.id,
    parentId: user.id,
  });
  pendingAssistant.pending = true;
  addMessage(pendingAssistant);
  lane.messageIds.push(pendingAssistant.id);

  promptEl.value = '';
  autoResizePrompt();
  showStatus('Assistant is thinking…');
  render();
  scrollToConversationEnd();

  await new Promise((resolve) => setTimeout(resolve, 320));
  const assistant = makeMessage({
    role: 'assistant', content: makeFakeAssistantReply(text, lane), laneId: lane.id, parentId: user.id,
  });
  assistant.id = pendingAssistant.id;
  messagesById.set(pendingAssistant.id, assistant);
  const index = messages.findIndex((msg) => msg.id === pendingAssistant.id);
  messages[index] = assistant;

  if (lane.id !== MAIN_LANE_ID && lane.messageIds.length === 2) {
    lane.title = summarizeDetourTitle(text);
  }

  showStatus('');
  render();
  scrollToConversationEnd();
}

function seedConversation() {
  const main = laneById(MAIN_LANE_ID);

  const user = makeMessage({
    role: 'user',
    content: 'Analyze this project carefully.',
    laneId: MAIN_LANE_ID,
  });

  const assistant = makeMessage({
    role: 'assistant',
    content: 'Here is a detailed UI review with a cleaner interaction model. Use the arrows on the left and right of this answer to create persistent horizontal detours.',
    laneId: MAIN_LANE_ID,
    parentId: user.id,
  });

  addMessage(user);
  addMessage(assistant);
  main.messageIds.push(user.id, assistant.id);
}

sendBtn.addEventListener('click', handleSend);
backToMainBtn.addEventListener('click', returnToMain);
el('toggleMetaBtn').addEventListener('click', () => el('metaPanel').classList.toggle('hidden'));
el('closeMetaBtn').addEventListener('click', () => el('metaPanel').classList.add('hidden'));

promptEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSend();
  }
});
promptEl.addEventListener('input', autoResizePrompt);

seedConversation();
render();
autoResizePrompt();
