from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1)


class CommentAnchor(BaseModel):
    message_id: str | None = None
    quote: str | None = None
    start: int | None = None
    end: int | None = None


class ChatRequest(BaseModel):
    # Preferred SlimX Chat Canvas payload.
    messages: list[ChatMessage] | None = None

    # Backward-compatible/simple payload.
    prompt: str | None = None

    conversation_id: str | None = None
    lane_id: str | None = None
    branch_id: str | None = None
    parent_message_id: str | None = None
    mode: Literal["main", "deep", "comment"] = "main"

    # Comment feature: optional anchor describing the selected excerpt a comment
    # is attached to. Used for logging/analytics only; context isolation is
    # enforced client-side by sending a self-contained `messages` payload.
    anchor: CommentAnchor | None = None

    # Generation controls.
    max_tokens: int | None = None
    max_new_tokens: int | None = None
    temperature: float | None = None
    top_k: int | None = None
    do_sample: bool | None = None
    return_full_text: bool | None = None


class ChatResponse(BaseModel):
    reply: str
    text: str
    backend: str
    model: str | None = None
    elapsed_ms: int | None = None
    prompt_chars: int | None = None
