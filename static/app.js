const promptEl = document.getElementById('prompt');
const sendBtn = document.getElementById('sendBtn');
const statusMsg = document.getElementById('statusMsg');
const messageList = document.getElementById('messageList');
const toggleMetaBtn = document.getElementById('toggleMetaBtn');
const closeMetaBtn = document.getElementById('closeMetaBtn');
const metaPanel = document.getElementById('metaPanel');
const contextPreview = document.getElementById('contextPreview');
const branchHint = document.getElementById('branchHint');
const backToMainBtn = document.getElementById('backToMainBtn');

const STORAGE_KEY = 'slimx-chat-canvas-state-v2';
const MAIN_LANE_ID = 'main';
const MAX_CONTEXT_MESSAGES = 24;

let idCounter = 0;
let isSending = false;
let activeLaneId = MAIN_LANE_ID;
let lanes = new Map([
  [MAIN_LANE_ID, { id: MAIN_LANE_ID, title: 'Main thread', messageIds: [], originMessageId: null }],
]);
let messages = [];

function activeLane() {
  return lanes.get(activeLaneId) || lanes.get(MAIN_LANE_ID);
}

function messageById(id) {
  return messages.find(message => message.id === id);
}

function makeMessage({ role, content, laneId, parentId = null }) {
  return {
    id: `msg_${++idCounter}`,
    role,
    content,
    laneId,
    parentId,
    pending: false,
    createdAt: new Date().toISOString(),
  };
}

function addMessage(message) {
  messages.push(message);
}

function saveState() {
  const state = {
    idCounter,
    activeLaneId,
    lanes: Array.from(lanes.entries()),
    messages: messages.filter(message => !message.pending),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;

  const state = JSON.parse(saved);
  idCounter = Number.isInteger(state.idCounter) ? state.idCounter : 0;
  messages = Array.isArray(state.messages) ? state.messages : [];
  lanes = new Map(Array.isArray(state.lanes) ? state.lanes : []);

  if (!lanes.has(MAIN_LANE_ID)) {
    lanes.set(MAIN_LANE_ID, { id: MAIN_LANE_ID, title: 'Main thread', messageIds: [], originMessageId: null });
  }

  activeLaneId = lanes.has(state.activeLaneId) ? state.activeLaneId : MAIN_LANE_ID;
}

function autoResizePrompt() {
  promptEl.style.height = 'auto';
  promptEl.style.height = `${Math.min(promptEl.scrollHeight, 240)}px`;
}

function setSending(nextSending) {
  isSending = nextSending;
  sendBtn.disabled = nextSending;
  promptEl.disabled = nextSending;
  sendBtn.textContent = nextSending ? 'Sending…' : 'Send';
}

function showStatus(text, isError = false) {
  statusMsg.textContent = text;
  statusMsg.dataset.error = isError ? 'true' : 'false';
}

function buildContextMessages(lane = activeLane()) {
  return lane.messageIds
    .map(messageById)
    .filter(message => message && !message.pending)
    .slice(-MAX_CONTEXT_MESSAGES)
    .map(({ role, content }) => ({ role, content }));
}

function formatPrompt(contextMessages) {
  return `${contextMessages
    .map(message => (message.role === 'user' ? `User: ${message.content}` : `Assistant: ${message.content}`))
    .join('\n')}\nAssistant:`;
}

function summarizeDetourTitle(text) {
  const trimmed = text.trim();
  return trimmed.length > 36 ? `${trimmed.slice(0, 33)}...` : trimmed || 'Deep dive';
}

function scrollToConversationEnd() {
  const chatWindow = document.getElementById('chatWindow');
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function detoursForMessage(messageId) {
  return Array.from(lanes.values()).filter(lane => lane.originMessageId === messageId);
}

function createMessageArticle(message, { branchable = false } = {}) {
  const article = document.createElement('article');
  article.className = `message ${message.role}${branchable ? ' branchable' : ''}`;

  if (branchable) {
    const detours = detoursForMessage(message.id);
    const deepBranch = document.createElement('button');
    deepBranch.className = 'deep-branch';
    deepBranch.type = 'button';
    deepBranch.textContent = detours.length ? 'Open dive' : 'Dig deeper';
    deepBranch.title = 'Dig deeper from this answer';
    deepBranch.setAttribute('aria-label', 'Dig deeper from this answer');
    deepBranch.dataset.messageId = message.id;
    deepBranch.dataset.hasDetour = String(detours.length > 0);
    article.appendChild(deepBranch);
  }

  const card = document.createElement('div');
  card.className = 'message-card';

  const content = document.createElement('div');
  content.className = 'message-content';
  content.textContent = message.content;

  card.appendChild(content);

  if (branchable) {
    const detours = detoursForMessage(message.id);
    if (detours.length) {
      const tags = document.createElement('div');
      tags.className = 'detour-tags';
      tags.setAttribute('aria-label', 'Collapsed deep dives');

      const label = document.createElement('span');
      label.className = 'detour-label';
      label.textContent = 'Deep dives:';
      tags.appendChild(label);

      detours.forEach(detour => {
        const tag = document.createElement('button');
        tag.className = 'detour-tag';
        tag.type = 'button';
        tag.textContent = detour.title;
        tag.dataset.laneId = detour.id;
        tags.appendChild(tag);
      });

      card.appendChild(tags);
    }
  }

  article.appendChild(card);
  return article;
}

function renderDetourHeader(lane) {
  const header = document.createElement('section');
  header.className = 'detour-head';

  const back = document.createElement('button');
  back.className = 'back-main';
  back.type = 'button';
  back.textContent = '← Back';
  back.dataset.goMain = 'true';

  const title = document.createElement('div');
  title.className = 'detour-title';
  title.textContent = lane.title;

  const origin = document.createElement('div');
  origin.className = 'detour-origin';
  const originMessage = messageById(lane.originMessageId);
  origin.textContent = originMessage ? `From: ${originMessage.content}` : 'Deep dive';

  header.append(back, title, origin);
  return header;
}

function renderLaneMessages(lane, container, { compact = false } = {}) {
  lane.messageIds
    .map(messageById)
    .filter(Boolean)
    .forEach(message => {
      container.appendChild(createMessageArticle(message, {
        branchable: !compact && message.role === 'assistant' && !message.pending,
      }));
    });
}

function updateMetaPanel() {
  const lane = activeLane();
  branchHint.textContent = lane.title;
  backToMainBtn.classList.toggle('hidden', lane.id === MAIN_LANE_ID);

  const contextMessages = buildContextMessages(lane);
  contextPreview.textContent = contextMessages.length
    ? contextMessages.map(message => `${message.role.toUpperCase()}: ${message.content}`).join('\n\n')
    : 'No context has been sent yet.';
}

function render() {
  const lane = activeLane();
  messageList.innerHTML = '';

  if (lane.id !== MAIN_LANE_ID) {
    const detour = document.createElement('section');
    detour.className = 'detour-lane';
    detour.appendChild(renderDetourHeader(lane));

    const thread = document.createElement('div');
    thread.className = 'detour-thread';
    renderLaneMessages(lane, thread, { compact: true });

    if (!lane.messageIds.length) {
      const empty = document.createElement('div');
      empty.className = 'detour-empty';
      empty.textContent = 'Ask a focused follow-up to start this deep dive.';
      thread.appendChild(empty);
    }

    detour.appendChild(thread);
    messageList.appendChild(detour);
  } else {
    renderLaneMessages(lane, messageList);
  }

  updateMetaPanel();
}

function openDetour(originMessageId) {
  const originMessage = messageById(originMessageId);
  if (!originMessage) return;

  let lane = detoursForMessage(originMessageId)[0];
  if (!lane) {
    lane = {
      id: `lane_${++idCounter}`,
      title: summarizeDetourTitle(originMessage.content),
      messageIds: [],
      originMessageId,
    };
    lanes.set(lane.id, lane);
    saveState();
  }

  activeLaneId = lane.id;
  render();
  scrollToConversationEnd();
  promptEl.focus();
}

function goToMain() {
  activeLaneId = MAIN_LANE_ID;
  saveState();
  render();
  scrollToConversationEnd();
}

async function handleSend() {
  if (isSending) return;

  const text = promptEl.value.trim();
  if (!text) return;

  const lane = activeLane();
  const previousId = lane.messageIds.at(-1) || lane.originMessageId || null;

  const user = makeMessage({ role: 'user', content: text, laneId: lane.id, parentId: previousId });
  addMessage(user);
  lane.messageIds.push(user.id);

  if (lane.id !== MAIN_LANE_ID && lane.messageIds.length === 1) {
    lane.title = summarizeDetourTitle(text);
  }

  const contextMessages = buildContextMessages(lane);
  const formattedPrompt = formatPrompt(contextMessages);

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
  setSending(true);
  showStatus('Assistant is thinking…');
  render();
  scrollToConversationEnd();

  let replyText = '';
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: formattedPrompt }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.detail || 'Network response failure');
    }

    const data = await response.json();
    replyText = data.reply || 'No response returned.';
  } catch (err) {
    console.error(err);
    replyText = 'Error: Failed to fetch response from the model backend.';
    showStatus(err.message || 'Failed to fetch response from the model backend.', true);
  }

  pendingAssistant.content = replyText;
  pendingAssistant.pending = false;

  if (statusMsg.dataset.error !== 'true') {
    showStatus('');
  }

  setSending(false);
  saveState();
  render();
  scrollToConversationEnd();
  promptEl.focus();
}

messageList.addEventListener('click', event => {
  const branchButton = event.target.closest('.deep-branch');
  if (branchButton) {
    openDetour(branchButton.dataset.messageId);
    return;
  }

  const detourTag = event.target.closest('.detour-tag');
  if (detourTag && lanes.has(detourTag.dataset.laneId)) {
    activeLaneId = detourTag.dataset.laneId;
    saveState();
    render();
    scrollToConversationEnd();
    return;
  }

  if (event.target.closest('[data-go-main="true"]')) {
    goToMain();
  }
});

sendBtn.addEventListener('click', handleSend);
promptEl.addEventListener('input', autoResizePrompt);
promptEl.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSend();
  }
});

toggleMetaBtn.addEventListener('click', () => {
  metaPanel.classList.toggle('hidden');
  updateMetaPanel();
});
closeMetaBtn.addEventListener('click', () => metaPanel.classList.add('hidden'));
backToMainBtn.addEventListener('click', goToMain);

try {
  loadState();
} catch (err) {
  console.warn('Failed to restore saved chat state', err);
  localStorage.removeItem(STORAGE_KEY);
}

render();
autoResizePrompt();
