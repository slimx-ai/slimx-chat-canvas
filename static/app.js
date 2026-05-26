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

  // ==================== REAL API CALL FOR CONTABO ====================
  const ctx = buildContextMessages();
  const formattedPrompt = ctx.map(m => {
    return m.role === 'user' ? `User: ${m.content}` : `Assistant: ${m.content}`;
  }).join('\n') + '\nAssistant:';

  let replyText = '';
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: formattedPrompt })
    });
    
    if (!response.ok) throw new Error('Network response failure');
    
    const data = await response.json();
    replyText = data.reply;
  } catch (err) {
    console.error(err);
    replyText = 'Error: Failed to fetch response from the model backend.';
  }

  // Directly update the properties of the placeholder object to preserve references
  pendingAssistant.content = replyText;
  pendingAssistant.pending = false;
  // ===================================================================

  // Update thread title if this is a sub-lane detour establishing its first pair
  if (typeof MAIN_LANE_ID !== 'undefined' && lane.id !== MAIN_LANE_ID && lane.messageIds.length === 2) {
    lane.title = summarizeDetourTitle(text);
  }

  showStatus('');
  render();
  scrollToConversationEnd();
}

