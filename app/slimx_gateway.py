from __future__ import annotations

import os
from functools import lru_cache
from typing import Iterable

from slimx import ChatRequest, Client, Message
from slimx.providers import get_provider, register

from app.providers.toaster_provider import toaster_factory


SYSTEM_PROMPT = os.getenv(
    "SYSTEM_PROMPT",
    "You are SlimX Chat Canvas assistant. Answer clearly and practically. Use only the active conversation path.",
)


def register_custom_providers() -> None:
    register("toaster", toaster_factory)


def provider_kwargs(provider_name: str) -> dict:
    if provider_name == "toaster":
        return {
            "max_history_messages": int(os.getenv("MAX_HISTORY_MESSAGES", "8")),
            "default_max_tokens": int(os.getenv("LLM_MAX_TOKENS", "128")),
        }
    if provider_name == "openai":
        return {
            "api_key": os.getenv("OPENAI_API_KEY"),
            "base_url": os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        }
    if provider_name == "ollama":
        return {"base_url": os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")}
    return {}


@lru_cache(maxsize=1)
def get_client() -> Client:
    register_custom_providers()
    provider_name = os.getenv("LLM_PROVIDER", "toaster").lower()
    provider = get_provider(provider_name, **provider_kwargs(provider_name))
    return Client(provider, timeout=float(os.getenv("LLM_TIMEOUT", "120")), retries=int(os.getenv("LLM_RETRIES", "1")))


def to_message(item: dict) -> Message:
    role = item.get("role", "user")
    content = str(item.get("content") or "").strip()
    if role == "system":
        return Message.system(content)
    if role == "assistant":
        return Message.assistant(content)
    return Message.user(content)


def build_chat_request(messages: list[dict], *, max_tokens: int | None = None, temperature: float | None = None) -> ChatRequest:
    slimx_messages = [Message.system(SYSTEM_PROMPT)]
    for item in messages:
        content = str(item.get("content") or "").strip()
        if content:
            slimx_messages.append(to_message(item))
    return ChatRequest(
        model=os.getenv("LLM_MODEL", "babygpt-152m"),
        messages=slimx_messages,
        temperature=temperature if temperature is not None else float(os.getenv("LLM_TEMPERATURE", "0.8")),
        max_tokens=max_tokens or int(os.getenv("LLM_MAX_TOKENS", "128")),
    )


def complete(messages: list[dict], *, max_tokens: int | None = None, temperature: float | None = None) -> str:
    client = get_client()
    req = build_chat_request(messages, max_tokens=max_tokens, temperature=temperature)
    return client.chat(req).text


def stream_complete(messages: list[dict], *, max_tokens: int | None = None, temperature: float | None = None) -> Iterable[str]:
    client = get_client()
    req = build_chat_request(messages, max_tokens=max_tokens, temperature=temperature)
    for event in client.stream(req):
        if event.type == "text_delta" and event.text:
            yield event.text
        elif event.type == "error" and event.error:
            yield f"\n[Error: {event.error}]"
