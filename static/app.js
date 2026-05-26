const promptEl = document.getElementById('prompt');
const sendBtn = document.getElementById('sendBtn');
const statusMsg = document.getElementById('statusMsg');
const messageList = document.getElementById('messageList');
const branchHint = document.getElementById('branchHint');
const backToMainBtn = document.getElementById('backToMainBtn');
const toggleMetaBtn = document.getElementById('toggleMetaBtn');
const closeMetaBtn = document.getElementById('closeMetaBtn');
const metaPanel = document.getElementById('metaPanel');
const contextPreview = document.getElementById('contextPreview');
const assistantTemplate = document.getElementById('assistantTemplate');

let idCounter = 0;

const MAIN_LANE_ID = 'main';
const lanes = new Map([
  [MAIN_LANE_ID, { id: MAIN_LANE_ID, title: 'Main thread', messageIds: [], originMessageId: null, parentLaneId: null }],
]);
const detoursByOriginId = new Map();
let activeLaneId = MAIN_LANE_ID;

const messages = [];

function activeLane() {
  return lanes.get(activeLaneId);
}

function getMessage(id) {
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
  };
}

function addMessage(message) {
  messages.push(message);
}

function autoResizePrompt() {
  promptEl.style.height = 'auto';
  promptEl.style.height = `${Math.min(promptEl.scrollHeight, 240)}px`;
}

function showStatus(text) {
  statusMsg.textContent = text;
}

function summarizeDetourTitle(text) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  return compact.length > 36 ? `${compact.slice(0, 33)}...` : compact || 'Deep dive';
}

function scrollToConversationEnd() {
  const chatWindow = document.getElementById('chatWindow');
  requestAnimationFrame(() => {
    chatWindow.scrollTop = chatWindow.scrollHeight;
  });
}

function messageIdsForLane(lane) {
  return lane.messageIds
    .map(id => getMessage(id))
    .filter(Boolean);
}

function escapeContextContent(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function buildPromptForBackend() {
  const lane = activeLane();
  const currentMessages = messageIdsForLane(lane).filter(message => !message.pending);

  let contextMessages = [];

  if (lane.id !== MAIN_LANE_ID && lane.originMessageId) {
    const originMessage = getMessage(lane.originMessageId);
    const parentLane = originMessage ? lanes.get(originMessage.laneId) : lanes.get(MAIN_LANE_ID);

    if (parentLane && originMessage) {
      const parentMessages = messageIdsForLane(parentLane);
      const originIndex = parentMessages.findIndex(message => message.id === originMessage.id);
      const historyUntilOrigin = originIndex >= 0 ? parentMessages.slice(0, originIndex + 1) : [originMessage];
      contextMessages = contextMessages.concat(historyUntilOrigin.filter(message => !message.pending));
    }

    contextMessages.push({
      role: 'user',
      content: 'Continue as a focused deep dive from the previous assistant answer. Answer only the new question.',
    });
  }

  contextMessages = contextMessages.concat(currentMessages);

  return `${contextMessages
    .map(message => `${message.role === 'user' ? 'User' : 'Assistant'}: ${escapeContextContent(message.content)}`)
    .join('\n')}\nAssistant:`;
}

function cleanModelReply(rawReply, sentPrompt) {
  let text = String(rawReply ?? '').trim();

  if (sentPrompt && text.startsWith(sentPrompt)) {
    text = text.slice(sentPrompt.length).trim();
  }

  const assistantMarkers = ['\nAssistant:', 'Assistant:'];
  for (const marker of assistantMarkers) {
    const index = text.lastIndexOf(marker);
    if (index > -1) {
      text = text.slice(index + marker.length).trim();
      break;
    }
  }

  text = text
    .replace(/^Assistant:\s*/i, '')
    .replace(/^User:\s.*$/gmi, '')
    .trim();

  return text || '(No response returned.)';
}

function createBasicMessage(message) {
  const article = document.createElement('article');
  article.className = `message ${message.role}`;

  const card = document.createElement('div');
  card.className = 'message-card';

  const content = document.createElement('div');
  content.className = 'message-content';
  content.textContent = message.content;

  card.appendChild(content);
  article.appendChild(card);

  return article;
}

function createAssistantMessage(message, { branchable = true } = {}) {
  if (!branchable || !assistantTemplate) {
    return createBasicMessage(message);
  }

  const fragment = assistantTemplate.content.cloneNode(true);
  const article = fragment.querySelector('.message');
  const content = fragment.querySelector('.message-content');
  const deepButton = fragment.querySelector('.deep-branch');
  const tags = fragment.querySelector('.detour-tags');

  content.textContent = message.content;

  const existingLaneId = detoursByOriginId.get(message.id);
  if (existingLaneId) {
    deepButton.dataset.hasDetour = 'true';
    deepButton.textContent = 'Open deep dive';

    const label = document.createElement('span');
    label.className = 'detour-label';
    label.textContent = 'Deep dive:';
    tags.appendChild(label);

    const tag = document.createElement('button');
    tag.className = 'detour-tag';
    tag.type = 'button';
    tag.textContent = lanes.get(existingLaneId)?.title || 'Open';
    tag.addEventListener('click', () => openDetour(message.id));
    tags.appendChild(tag);
  }

  deepButton.addEventListener('click', () => openDetour(message.id));

  return article;
}

function createDetourHeader(lane) {
  const origin = getMessage(lane.originMessageId);

  const header = document.createElement('div');
  header.className = 'detour-head';

  const backButton = document.createElement('button');
  backButton.className = 'back-main';
  backButton.type = 'button';
  backButton.textContent = '← Back to main';
  backButton.addEventListener('click', backToMain);

  const title = document.createElement('div');
  title.className = 'detour-title';
  title.textContent = lane.title || 'Deep dive';

  const originEl = document.createElement('div');
  originEl.className = 'detour-origin';
  originEl.textContent = origin ? `From: ${summarizeDetourTitle(origin.content)}` : 'Deep dive';

  header.appendChild(backButton);
  header.appendChild(title);
  header.appendChild(originEl);

  return header;
}

function renderMainLane() {
  const lane = lanes.get(MAIN_LANE_ID);

  messageIdsForLane(lane).forEach(message => {
    if (message.role === 'assistant') {
      messageList.appendChild(createAssistantMessage(message, { branchable: !message.pending }));
    } else {
      messageList.appendChild(createBasicMessage(message));
    }
  });
}

function renderDetourLane(lane) {
  const panel = document.createElement('section');
  panel.className = 'detour-lane';

  panel.appendChild(createDetourHeader(lane));

  if (lane.messageIds.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'detour-empty';
    empty.textContent = 'Ask a follow-up here. This deep dive will stay attached to the original answer.';
    panel.appendChild(empty);
  }

  const thread = document.createElement('div');
  thread.className = 'detour-thread';

  messageIdsForLane(lane).forEach(message => {
    thread.appendChild(
      message.role === 'assistant'
        ? createAssistantMessage(message, { branchable: false })
        : createBasicMessage(message)
    );
  });

  panel.appendChild(thread);
  messageList.appendChild(panel);
}

function updateComposerState() {
  const lane = activeLane();

  branchHint.textContent = lane.id === MAIN_LANE_ID ? 'Main thread' : `Deep dive: ${lane.title || 'Untitled'}`;
  backToMainBtn.classList.toggle('hidden', lane.id === MAIN_LANE_ID);
}

function render() {
  const lane = activeLane();
  messageList.innerHTML = '';

  if (lane.id === MAIN_LANE_ID) {
    renderMainLane();
  } else {
    renderDetourLane(lane);
  }

  updateComposerState();
}

function openDetour(originMessageId) {
  let laneId = detoursByOriginId.get(originMessageId);
  const originMessage = getMessage(originMessageId);

  if (!laneId) {
    laneId = `lane_${++idCounter}`;
    lanes.set(laneId, {
      id: laneId,
      title: 'Deep dive',
      messageIds: [],
      originMessageId,
      parentLaneId: originMessage?.laneId || MAIN_LANE_ID,
    });
    detoursByOriginId.set(originMessageId, laneId);
  }

  activeLaneId = laneId;
  render();
  scrollToConversationEnd();
  promptEl.focus();
}

function backToMain() {
  activeLaneId = MAIN_LANE_ID;
  render();
  scrollToConversationEnd();
}

async function handleSend() {
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

  const formattedPrompt = buildPromptForBackend();

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

  let replyText = '';
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: formattedPrompt }),
    });

    if (!response.ok) {
      throw new Error(`Network response failure: ${response.status}`);
    }

    const data = await response.json();
    replyText = cleanModelReply(data.reply, formattedPrompt);
  } catch (err) {
    console.error(err);
    replyText = 'Error: Failed to fetch response from the model backend.';
  }

  pendingAssistant.content = replyText;
  pendingAssistant.pending = false;

  showStatus('');
  render();
  scrollToConversationEnd();
}

function updateContextPreview() {
  contextPreview.textContent = buildPromptForBackend();
}

function toggleMetaPanel() {
  updateContextPreview();
  metaPanel.classList.toggle('hidden');
}

sendBtn.addEventListener('click', handleSend);
backToMainBtn.addEventListener('click', backToMain);
toggleMetaBtn.addEventListener('click', toggleMetaPanel);
closeMetaBtn.addEventListener('click', () => metaPanel.classList.add('hidden'));

promptEl.addEventListener('input', autoResizePrompt);
promptEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSend();
  }
});

render();
autoResizePrompt();
