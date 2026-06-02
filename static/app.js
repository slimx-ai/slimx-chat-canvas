const messageEl = document.getElementById('message');
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
const selectionCommentBtn = document.getElementById('selectionCommentBtn');
const commentPanel = document.getElementById('commentPanel');

let idCounter = 0;

const MAIN_LANE_ID = 'main';
const SESSION_ID = crypto.randomUUID ? crypto.randomUUID() : `session_${Date.now()}`;

const lanes = new Map([
  [MAIN_LANE_ID, { id: MAIN_LANE_ID, title: 'Main thread', messageIds: [], originMessageId: null, parentLaneId: null }],
]);

const detoursByOriginId = new Map();
let activeLaneId = MAIN_LANE_ID;

const messages = [];

// --- Comment feature state -------------------------------------------------
// Comments are isolated margin-notes anchored to a text span inside an
// assistant message. They live OUTSIDE `messages`/`lanes` on purpose, so they
// can never leak into the main or detour context built by
// buildMessagesForBackend(). Each comment carries only its own Q&A thread.
const comments = [];
const commentsByMessageId = new Map(); // messageId -> [commentId, ...]
let activeCommentId = null;
let pendingSelection = null; // { messageId, quote, start, end }

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

function autoResizeMessageInput() {
  messageEl.style.height = 'auto';
  messageEl.style.height = `${Math.min(messageEl.scrollHeight, 240)}px`;
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

function cleanMessageContent(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function toApiMessage(message) {
  return {
    role: message.role,
    content: cleanMessageContent(message.content),
  };
}

function buildMessagesForBackend() {
  const lane = activeLane();
  const currentMessages = messageIdsForLane(lane).filter(message => !message.pending);

  let contextMessages = [];

  if (lane.id !== MAIN_LANE_ID && lane.originMessageId) {
    const originMessage = getMessage(lane.originMessageId);
    const parentLane = originMessage ? lanes.get(originMessage.laneId) : lanes.get(MAIN_LANE_ID);

    if (parentLane && originMessage) {
      const parentMessages = messageIdsForLane(parentLane).filter(message => !message.pending);
      const originIndex = parentMessages.findIndex(message => message.id === originMessage.id);
      const historyUntilOrigin = originIndex >= 0 ? parentMessages.slice(0, originIndex + 1) : [originMessage];
      contextMessages = contextMessages.concat(historyUntilOrigin);
    }

    contextMessages.push({
      role: 'system',
      content: 'Continue as a focused deep dive from the previous assistant answer. Answer only the new question in this deep-dive lane.',
    });
  }

  contextMessages = contextMessages.concat(currentMessages);

  return contextMessages
    .filter(message => message.role === 'system' || message.role === 'user' || message.role === 'assistant')
    .map(toApiMessage)
    .filter(message => message.content.length > 0);
}

function formatMessagesForPreview(apiMessages) {
  return apiMessages
    .map(message => `${message.role.toUpperCase()}: ${message.content}`)
    .join('\n\n');
}

function cleanModelReply(rawReply) {
  let text = String(rawReply ?? '').trim();

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

  article.dataset.messageId = message.id;
  content.textContent = message.content;
  decorateComments(content, message);

  const commentList = commentsForMessage(message.id);
  if (commentList.length) {
    const commentLabel = document.createElement('span');
    commentLabel.className = 'detour-label';
    commentLabel.textContent = 'Comments:';
    tags.appendChild(commentLabel);

    commentList.forEach(comment => {
      const chip = document.createElement('button');
      chip.className = 'detour-tag comment-tag';
      chip.type = 'button';
      chip.textContent = comment.title || 'Comment';
      chip.addEventListener('click', () => openCommentPanel(comment.id));
      tags.appendChild(chip);
    });
  }

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
  messageEl.focus();
}

function backToMain() {
  activeLaneId = MAIN_LANE_ID;
  render();
  scrollToConversationEnd();
}

async function postChat(body) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let details = '';
    try {
      const data = await response.json();
      details = data.detail ? `: ${data.detail}` : '';
    } catch {
      details = `: ${await response.text()}`;
    }
    throw new Error(`Network response failure ${response.status}${details}`);
  }

  const data = await response.json();
  return data.reply ?? data.text ?? data.message ?? '';
}

async function callChatBackend(apiMessages, lane, userMessage) {
  return postChat({
    messages: apiMessages,
    conversation_id: SESSION_ID,
    lane_id: lane.id,
    parent_message_id: userMessage.parentId,
    mode: lane.id === MAIN_LANE_ID ? 'main' : 'deep',
  });
}

async function handleSend() {
  const text = messageEl.value.trim();
  if (!text) return;

  const lane = activeLane();
  const previousId = lane.messageIds.at(-1) || lane.originMessageId || null;

  const user = makeMessage({ role: 'user', content: text, laneId: lane.id, parentId: previousId });
  addMessage(user);
  lane.messageIds.push(user.id);

  if (lane.id !== MAIN_LANE_ID && lane.messageIds.length === 1) {
    lane.title = summarizeDetourTitle(text);
  }

  const apiMessages = buildMessagesForBackend();

  const pendingAssistant = makeMessage({
    role: 'assistant',
    content: '…',
    laneId: lane.id,
    parentId: user.id,
  });

  pendingAssistant.pending = true;
  addMessage(pendingAssistant);
  lane.messageIds.push(pendingAssistant.id);

  messageEl.value = '';
  autoResizeMessageInput();
  showStatus('Assistant is thinking…');
  render();
  scrollToConversationEnd();

  let replyText = '';
  try {
    const rawReply = await callChatBackend(apiMessages, lane, user);
    replyText = cleanModelReply(rawReply);
  } catch (err) {
    console.error(err);
    replyText = `Error: ${err.message}`;
  }

  pendingAssistant.content = replyText;
  pendingAssistant.pending = false;

  showStatus('');
  render();
  scrollToConversationEnd();
}

function updateContextPreview() {
  if (activeCommentId) {
    const comment = getComment(activeCommentId);
    if (comment) {
      contextPreview.textContent =
        '[ISOLATED COMMENT CONTEXT — not part of the main thread]\n\n' +
        formatMessagesForPreview(buildMessagesForComment(comment));
      return;
    }
  }
  contextPreview.textContent = formatMessagesForPreview(buildMessagesForBackend());
}

function toggleMetaPanel() {
  updateContextPreview();
  metaPanel.classList.toggle('hidden');
}

// --- Comments --------------------------------------------------------------

function getComment(id) {
  return comments.find(comment => comment.id === id);
}

function commentsForMessage(messageId) {
  return (commentsByMessageId.get(messageId) || []).map(getComment).filter(Boolean);
}

// Absolute character offset of (node, offset) within container.textContent.
// Walks every text node — including text inside existing <mark> highlights —
// so offsets stay consistent with the canonical message.content string.
function absoluteOffset(container, targetNode, targetOffset) {
  let offset = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node === targetNode) return offset + targetOffset;
    offset += node.textContent.length;
  }
  return offset;
}

function closestContent(node) {
  const el = node.nodeType === 1 ? node : node.parentElement;
  return el ? el.closest('.message-content') : null;
}

function clearSelectionButton() {
  selectionCommentBtn.classList.add('hidden');
  pendingSelection = null;
}

function evaluateSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    clearSelectionButton();
    return;
  }

  const range = selection.getRangeAt(0);
  if (!range.toString().trim()) {
    clearSelectionButton();
    return;
  }

  // Both ends must sit inside the same assistant message-content.
  const startContent = closestContent(range.startContainer);
  const endContent = closestContent(range.endContainer);
  const contentEl = startContent && startContent === endContent ? startContent : null;
  if (!contentEl) {
    clearSelectionButton();
    return;
  }

  const article = contentEl.closest('.message.assistant');
  const messageId = article?.dataset.messageId;
  const message = getMessage(messageId);
  if (!message || message.pending) {
    clearSelectionButton();
    return;
  }

  const start = absoluteOffset(contentEl, range.startContainer, range.startOffset);
  const end = absoluteOffset(contentEl, range.endContainer, range.endOffset);
  if (end <= start) {
    clearSelectionButton();
    return;
  }

  pendingSelection = { messageId, quote: message.content.slice(start, end), start, end };

  const rect = range.getBoundingClientRect();
  const top = Math.max(8, rect.top - 40);
  const left = Math.min(rect.left, window.innerWidth - 150);
  selectionCommentBtn.style.top = `${top}px`;
  selectionCommentBtn.style.left = `${left}px`;
  selectionCommentBtn.classList.remove('hidden');
}

function startCommentFromSelection() {
  if (!pendingSelection) return;
  const { messageId, quote, start, end } = pendingSelection;

  const comment = {
    id: `cmt_${++idCounter}`,
    messageId,
    quote,
    range: { start, end },
    thread: [],
    title: summarizeDetourTitle(quote),
    collapsed: false,
  };
  comments.push(comment);
  const list = commentsByMessageId.get(messageId) || [];
  list.push(comment.id);
  commentsByMessageId.set(messageId, list);

  activeCommentId = comment.id;
  window.getSelection()?.removeAllRanges();
  clearSelectionButton();
  render(); // paints the highlight + chip
  openCommentPanel(comment.id);
}

// Isolated context: selected excerpt + this comment's own Q&A only.
function buildMessagesForComment(comment) {
  const built = [
    {
      role: 'system',
      content:
        'The user selected the following excerpt from an earlier assistant message and is asking about it. ' +
        'Answer only about this excerpt. Do not assume any broader conversation context.',
    },
    { role: 'user', content: `Excerpt:\n"""${cleanMessageContent(comment.quote)}"""` },
  ];

  comment.thread
    .filter(message => !message.pending)
    .forEach(message => built.push({ role: message.role, content: cleanMessageContent(message.content) }));

  return built.filter(message => message.content.length > 0);
}

async function callCommentBackend(apiMessages, comment) {
  return postChat({
    messages: apiMessages,
    conversation_id: SESSION_ID,
    lane_id: `comment:${comment.id}`,
    mode: 'comment',
    anchor: {
      message_id: comment.messageId,
      quote: comment.quote,
      start: comment.range.start,
      end: comment.range.end,
    },
  });
}

function positionCommentPanel(comment) {
  const anchor =
    messageList.querySelector(`mark.comment-anchor[data-comment-id="${comment.id}"]`) ||
    messageList.querySelector(`[data-message-id="${comment.messageId}"]`);
  if (!anchor) return;

  const rect = anchor.getBoundingClientRect();
  const top = Math.min(rect.bottom + 8, window.innerHeight - 340);
  commentPanel.style.top = `${Math.max(12, top)}px`;
  commentPanel.style.left = `${Math.min(rect.left, window.innerWidth - 392)}px`;
}

function openCommentPanel(commentId) {
  const comment = getComment(commentId);
  if (!comment) return;

  activeCommentId = commentId;
  comment.collapsed = false;
  commentPanel.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'comment-head';
  const title = document.createElement('div');
  title.className = 'comment-title';
  title.textContent = 'Comment on selection';
  const collapseBtn = document.createElement('button');
  collapseBtn.className = 'ghost-btn small';
  collapseBtn.type = 'button';
  collapseBtn.textContent = 'Collapse';
  collapseBtn.addEventListener('click', () => collapseComment(commentId));
  head.append(title, collapseBtn);

  const quote = document.createElement('blockquote');
  quote.className = 'comment-quote';
  quote.textContent = comment.quote;

  const thread = document.createElement('div');
  thread.className = 'comment-thread';
  comment.thread.forEach(message => {
    const row = document.createElement('div');
    row.className = `comment-msg ${message.role}`;
    row.textContent = message.content;
    thread.appendChild(row);
  });

  const compose = document.createElement('div');
  compose.className = 'comment-compose';
  const input = document.createElement('textarea');
  input.rows = 1;
  input.placeholder = 'Ask about this selection…';
  const askBtn = document.createElement('button');
  askBtn.type = 'button';
  askBtn.textContent = 'Ask';
  askBtn.addEventListener('click', () => sendComment(commentId, input));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendComment(commentId, input);
    }
  });
  compose.append(input, askBtn);

  commentPanel.append(head, quote, thread, compose);
  commentPanel.classList.remove('hidden');
  positionCommentPanel(comment);

  if (metaPanel && !metaPanel.classList.contains('hidden')) updateContextPreview();
  input.focus();
}

function collapseComment(commentId) {
  const comment = getComment(commentId);
  if (comment) comment.collapsed = true;
  if (activeCommentId === commentId) activeCommentId = null;
  commentPanel.classList.add('hidden');
  render(); // keeps the highlight + chip as the revisit marker
  if (metaPanel && !metaPanel.classList.contains('hidden')) updateContextPreview();
}

async function sendComment(commentId, input) {
  const comment = getComment(commentId);
  const text = input.value.trim();
  if (!comment || !text) return;

  comment.thread.push({ role: 'user', content: text });
  input.value = '';

  const apiMessages = buildMessagesForComment(comment);

  comment.thread.push({ role: 'assistant', content: '…', pending: true });
  openCommentPanel(commentId);

  let replyText = '';
  try {
    const rawReply = await callCommentBackend(apiMessages, comment);
    replyText = cleanModelReply(rawReply);
  } catch (err) {
    console.error(err);
    replyText = `Error: ${err.message}`;
  }

  comment.thread = comment.thread.filter(message => !message.pending);
  comment.thread.push({ role: 'assistant', content: replyText });

  if (activeCommentId === commentId) openCommentPanel(commentId);
}

// Re-applies comment highlights after each render. Offsets are stable because
// message content is immutable once generated.
function decorateComments(contentEl, message) {
  const list = commentsForMessage(message.id)
    .filter(comment => Number.isInteger(comment.range?.start) && comment.range.end > comment.range.start)
    .sort((a, b) => a.range.start - b.range.start);

  list.forEach(comment => highlightCommentRange(contentEl, comment));
}

function highlightCommentRange(container, comment) {
  const { start, end } = comment.range;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node;
  let pos = 0;
  let startNode = null;
  let startOffset = 0;
  let endNode = null;
  let endOffset = 0;

  while ((node = walker.nextNode())) {
    const len = node.textContent.length;
    if (startNode === null && pos + len > start) {
      startNode = node;
      startOffset = start - pos;
    }
    if (pos + len >= end) {
      endNode = node;
      endOffset = end - pos;
      break;
    }
    pos += len;
  }

  if (!startNode || !endNode) return;

  try {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);

    const mark = document.createElement('mark');
    mark.className = 'comment-anchor';
    mark.dataset.commentId = comment.id;
    mark.title = 'Open comment';
    range.surroundContents(mark);
    mark.addEventListener('click', (event) => {
      event.stopPropagation();
      openCommentPanel(comment.id);
    });
  } catch {
    // Overlapping/cross-element ranges can't be wrapped cleanly; skip silently.
  }
}

sendBtn.addEventListener('click', handleSend);
backToMainBtn.addEventListener('click', backToMain);
toggleMetaBtn.addEventListener('click', toggleMetaPanel);
closeMetaBtn.addEventListener('click', () => metaPanel.classList.add('hidden'));

messageEl.addEventListener('input', autoResizeMessageInput);
messageEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSend();
  }
});

// Comment selection wiring.
messageList.addEventListener('mouseup', () => setTimeout(evaluateSelection, 0));
document.addEventListener('selectionchange', () => {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) clearSelectionButton();
});
// Keep the text selection alive when pressing the floating button.
selectionCommentBtn.addEventListener('mousedown', (event) => event.preventDefault());
selectionCommentBtn.addEventListener('click', startCommentFromSelection);

render();
autoResizeMessageInput();
