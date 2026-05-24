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
const contextPreview = el('contextPreview');
const metaPanel = el('metaPanel');

const MAIN_LANE_ID = 'main';
const DETOUR_DIRECTION = 'deep';

const messages = [];
const messagesById = new Map();
const lanes = new Map();

const uid = () => (
  globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
);

const session = {
  id: uid(),
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
};

function msgById(id) {
  return messagesById.get(id) || null;
}

function laneById(id) {
  return lanes.get(id) || null;
}

function activeLane() {
  return laneById(state.activeLaneId) || laneById(MAIN_LANE_ID);
}

function transition(patch) {
  Object.assign(state, patch);
}

function directionLabel(direction) {
  return direction === DETOUR_DIRECTION ? 'Dig deeper' : 'Main thread';
}

function summarizeDetourTitle(text) {
  const cleaned = text
    .replace(/[?.!]/g, '')
    .replace(/^(can you|please|explain|tell me|what about|show me|give me|go deeper|dig deeper)\s+/i, '')
    .trim();

  return cleaned.split(/\s+/).slice(0, 4).join(' ') || 'Deep dive';
}

function findDetour(originMessageId) {
  return [...lanes.values()].find(
    (lane) => lane.originMessageId === originMessageId && lane.direction === DETOUR_DIRECTION,
  ) || null;
}

function getOriginRow(originMessageId) {
  return messageList.querySelector(`[data-origin-id="${originMessageId}"]`);
}

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

  contextPreview.textContent = [
    `Session: ${session.title}`,
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
  const originSnippet = origin?.content?.slice(0, 70) || 'selected answer';
  branchHint.textContent = `Deep dive from: ${originSnippet}`;
  backToMainBtn.classList.remove('hidden');
  promptEl.placeholder = 'Ask a deeper follow-up...';
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
  return `Deep dive: ${text.slice(0, 120)}`;
}

function createOrOpenDetour(originMessageId) {
  const origin = msgById(originMessageId);

  if (!origin || origin.role !== 'assistant') {
    showStatus('You can only dig deeper from an assistant answer.');
    return;
  }

  let lane = findDetour(originMessageId);

  if (!lane) {
    lane = {
      id: uid(),
      originMessageId,
      direction: DETOUR_DIRECTION,
      title: 'Deep dive',
      messageIds: [],
      parentLaneId: MAIN_LANE_ID,
      collapsed: false,
    };
    lanes.set(lane.id, lane);
  }

  lane.collapsed = false;
  transition({ activeLaneId: lane.id, activeOriginMessageId: originMessageId });

  showStatus('Deep dive opened.');
  render();

  requestAnimationFrame(() => {
    getOriginRow(originMessageId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    promptEl.focus();
  });
}

function openLane(laneId) {
  const lane = laneById(laneId);
  if (!lane || lane.id === MAIN_LANE_ID) return;

  lane.collapsed = false;
  transition({ activeLaneId: lane.id, activeOriginMessageId: lane.originMessageId });

  showStatus('Deep dive opened.');
  render();

  requestAnimationFrame(() => {
    getOriginRow(lane.originMessageId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    promptEl.focus();
  });
}

function returnToMain() {
  const lane = activeLane();
  if (lane && lane.id !== MAIN_LANE_ID) lane.collapsed = true;

  transition({ activeLaneId: MAIN_LANE_ID, activeOriginMessageId: null });

  showStatus('');
  render();
}

function createMessageElement(message, options = {}) {
  const article = document.createElement('article');
  article.className = `message ${message.role}`;
  if (options.compact) article.classList.add('compact');

  const card = document.createElement('div');
  card.className = 'message-card';

  const content = document.createElement('div');
  content.className = 'message-content';
  content.textContent = message.content;
  card.appendChild(content);

  if (message.role === 'assistant') {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(message.content);
        showStatus('Copied response to clipboard.');
      } catch {
        showStatus('Copy failed. Select the text manually.');
      }
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
  tag.textContent = `${lane.title} · ${turns} turn${turns === 1 ? '' : 's'}`;
  tag.title = 'Open deep dive';
  tag.addEventListener('click', () => openLane(lane.id));
  return tag;
}

function renderDetourTags(container, originMessage) {
  const lane = findDetour(originMessage.id);
  if (!lane || lane.messageIds.length === 0) return;

  const label = document.createElement('span');
  label.className = 'detour-label';
  label.textContent = 'Deep dive';
  container.append(label, createDetourTag(lane));
}

function renderMainAssistantLane(container, message) {
  const assistantFrag = assistantTemplate.content.cloneNode(true);
  const article = assistantFrag.querySelector('.message');
  article.dataset.id = message.id;
  article.querySelector('.message-content').textContent = message.content;

  const deepButton = article.querySelector('.deep-branch');
  if (findDetour(message.id)) deepButton.dataset.hasDetour = 'true';
  deepButton.addEventListener('click', () => createOrOpenDetour(message.id));

  const tags = article.querySelector('.detour-tags');
  renderDetourTags(tags, message);

  container.appendChild(assistantFrag);
}

function renderDetourLane(container, originMessage) {
  const lane = findDetour(originMessage.id);

  const header = document.createElement('div');
  header.className = 'detour-head';

  const back = document.createElement('button');
  back.className = 'back-main';
  back.type = 'button';
  back.textContent = '← Back to main';
  back.addEventListener('click', returnToMain);

  const title = document.createElement('div');
  title.className = 'detour-title';
  title.textContent = lane?.title || 'Deep dive';

  const origin = document.createElement('div');
  origin.className = 'detour-origin';
  origin.textContent = `From: ${originMessage.content.slice(0, 90)}`;

  header.append(back, title, origin);
  container.appendChild(header);

  if (!lane || lane.messageIds.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'detour-empty';
    empty.textContent = 'Continue from this answer. Your next message will stay inside this deep dive.';
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
  row.dataset.active = state.activeOriginMessageId === message.id && state.activeLaneId !== MAIN_LANE_ID
    ? 'detour'
    : 'main';

  renderDetourLane(row.querySelector('.detour-lane'), message);
  renderMainAssistantLane(row.querySelector('.main-lane'), message);

  return rowFrag;
}

function renderMainThread() {
  const mainLane = laneById(MAIN_LANE_ID);
  const fragment = document.createDocumentFragment();

  mainLane.messageIds
    .map(msgById)
    .filter(Boolean)
    .forEach((message) => {
      if (message.role === 'assistant') {
        fragment.appendChild(renderAssistantBranchRow(message));
      } else {
        fragment.appendChild(createMessageElement(message));
      }
    });

  messageList.replaceChildren(fragment);
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
    role: 'assistant',
    content: makeFakeAssistantReply(text, lane),
    laneId: lane.id,
    parentId: user.id,
  });
  assistant.id = pendingAssistant.id;
  messagesById.set(pendingAssistant.id, assistant);

  const index = messages.findIndex((msg) => msg.id === pendingAssistant.id);
  if (index !== -1) messages[index] = assistant;

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
    content: 'Here is a detailed UI review with a cleaner interaction model. Use the Dig deeper button on the left of this answer to create a persistent horizontal detour.',
    laneId: MAIN_LANE_ID,
    parentId: user.id,
  });

  addMessage(user);
  addMessage(assistant);
  main.messageIds.push(user.id, assistant.id);
}

sendBtn.addEventListener('click', handleSend);
backToMainBtn.addEventListener('click', returnToMain);
el('toggleMetaBtn').addEventListener('click', () => metaPanel.classList.toggle('hidden'));
el('closeMetaBtn').addEventListener('click', () => metaPanel.classList.add('hidden'));

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
