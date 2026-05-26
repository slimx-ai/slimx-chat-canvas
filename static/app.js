const promptEl = document.getElementById('prompt');
const sendBtn = document.getElementById('sendBtn');
const statusMsg = document.getElementById('statusMsg');
const messageList = document.getElementById('messageList');

let idCounter = 0;

const MAIN_LANE_ID = 'main';
const lanes = new Map([
  [MAIN_LANE_ID, { id: MAIN_LANE_ID, title: 'Main thread', messageIds: [], originMessageId: null }],
]);
let activeLaneId = MAIN_LANE_ID;

const messages = [];

function activeLane() {
  return lanes.get(activeLaneId);
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

function buildContextMessages() {
  const lane = activeLane();
  return lane.messageIds
    .map(id => messages.find(m => m.id === id))
    .filter(Boolean)
    .map(({ role, content }) => ({ role, content }));
}

function summarizeDetourTitle(text) {
  return text.length > 36 ? `${text.slice(0, 33)}...` : text;
}

function scrollToConversationEnd() {
  const chatWindow = document.getElementById('chatWindow');
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function render() {
  const lane = activeLane();
  messageList.innerHTML = '';

  lane.messageIds
    .map(id => messages.find(m => m.id === id))
    .filter(Boolean)
    .forEach(msg => {
      const article = document.createElement('article');
      article.className = `message ${msg.role}`;

      const card = document.createElement('div');
      card.className = 'message-card';

      const content = document.createElement('div');
      content.className = 'message-content';
      content.textContent = msg.content;

      card.appendChild(content);
      article.appendChild(card);
      messageList.appendChild(article);
    });
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

  const ctx = buildContextMessages();
  const formattedPrompt = `${ctx
    .map(m => (m.role === 'user' ? `User: ${m.content}` : `Assistant: ${m.content}`))
    .join('\n')}\nAssistant:`;

  let replyText = '';
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: formattedPrompt }),
    });

    if (!response.ok) throw new Error('Network response failure');

    const data = await response.json();
    replyText = data.reply;
  } catch (err) {
    console.error(err);
    replyText = 'Error: Failed to fetch response from the model backend.';
  }

  pendingAssistant.content = replyText;
  pendingAssistant.pending = false;

  if (lane.id !== MAIN_LANE_ID && lane.messageIds.length === 2) {
    lane.title = summarizeDetourTitle(text);
  }

  showStatus('');
  render();
  scrollToConversationEnd();
}

sendBtn.addEventListener('click', handleSend);
promptEl.addEventListener('input', autoResizePrompt);
promptEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSend();
  }
});

render();
autoResizePrompt();
