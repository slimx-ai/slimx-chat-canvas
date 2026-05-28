from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Generator

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from app.schemas import ChatMessage, ChatRequest, ChatResponse

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("slimx-chat-canvas")


def normalize_messages(payload: ChatRequest) -> list[dict]:
    if payload.messages:
        return [m.model_dump() for m in payload.messages]
    if payload.prompt and payload.prompt.strip():
        return [{"role": "user", "content": payload.prompt.strip()}]
    raise HTTPException(status_code=400, detail="Request must include messages or prompt.")


def messages_to_prompt(messages: list[dict]) -> str:
    lines: list[str] = []
    for message in messages:
        role = message.get("role", "user")
        content = " ".join(str(message.get("content") or "").split()).strip()
        if not content:
            continue
        if role == "system":
            lines.append(f"System: {content}")
        elif role == "assistant":
            lines.append(f"Assistant: {content}")
        else:
            lines.append(f"User: {content}")
    lines.append("Assistant:")
    return "\n".join(lines)


async def call_http_model_backend(payload: ChatRequest, messages: list[dict]) -> str:
    url = os.getenv("MODEL_HTTP_URL")
    if not url:
        raise HTTPException(status_code=500, detail="MODEL_HTTP_URL is not configured.")
    body = {
        "messages": messages,
        "prompt": messages_to_prompt(messages),
        "max_tokens": payload.max_tokens or payload.max_new_tokens,
        "max_new_tokens": payload.max_new_tokens or payload.max_tokens,
        "temperature": payload.temperature,
        "top_k": payload.top_k,
        "do_sample": payload.do_sample,
        "return_full_text": payload.return_full_text,
        "conversation_id": payload.conversation_id,
        "lane_id": payload.lane_id,
        "branch_id": payload.branch_id,
        "parent_message_id": payload.parent_message_id,
        "mode": payload.mode,
    }
    timeout = float(os.getenv("MODEL_HTTP_TIMEOUT", "120"))
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, json=body)
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Model backend returned {response.status_code}: {response.text}")
    data = response.json()
    return str(data.get("reply") or data.get("text") or data.get("message") or "")


def call_slimx_backend(payload: ChatRequest, messages: list[dict]) -> str:
    from app.slimx_gateway import complete
    return complete(messages, max_tokens=payload.max_tokens or payload.max_new_tokens, temperature=payload.temperature)


def call_direct_toaster_backend(payload: ChatRequest, messages: list[dict]) -> str:
    from app.runtime.toaster_runtime import ToasterRuntime

    if not hasattr(call_direct_toaster_backend, "runtime"):
        call_direct_toaster_backend.runtime = ToasterRuntime()  # type: ignore[attr-defined]

    runtime: ToasterRuntime = call_direct_toaster_backend.runtime  # type: ignore[attr-defined]

    prompt = next(
        (m.get("content", "").strip() for m in reversed(messages) if m.get("role") == "user"),
        "",
    )

    return runtime.generate(
        prompt,
        max_new_tokens=payload.max_new_tokens or payload.max_tokens,
        temperature=payload.temperature,
        top_k=payload.top_k,
        do_sample=payload.do_sample,
        return_full_text=payload.return_full_text,
    )


def call_echo_backend(messages: list[dict]) -> str:
    last_user = next((m.get("content", "") for m in reversed(messages) if m.get("role") == "user"), "")
    return (
        "Backend is running without Gradio. The frontend is sending structured messages.\n\n"
        f"Last user message: {last_user}\n\n"
        "To use the local PyTorch model, run with MODEL_BACKEND=slimx and LLM_PROVIDER=toaster."
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    backend = os.getenv("MODEL_BACKEND", "echo").lower()
    if backend in {"slimx", "toaster"}:
        from app.slimx_gateway import get_client
        get_client()
    elif backend in {"direct_toaster", "direct-toaster"}:
        from app.runtime.toaster_runtime import ToasterRuntime
        runtime = ToasterRuntime()
        runtime.load()
        call_direct_toaster_backend.runtime = runtime  # type: ignore[attr-defined]
    yield


app = FastAPI(title="SlimX Chat Canvas", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "backend": os.getenv("MODEL_BACKEND", "echo"),
        "llm_provider": os.getenv("LLM_PROVIDER", "toaster"),
        "llm_model": os.getenv("LLM_MODEL", "babygpt-152m"),
        "gradio": "removed",
    }


@app.post("/api/chat", response_model=ChatResponse)
async def chat_endpoint(payload: ChatRequest) -> ChatResponse:
    messages = normalize_messages(payload)
    backend = os.getenv("MODEL_BACKEND", "echo").lower()
    start = time.time()
    try:
        if backend == "http":
            reply = await call_http_model_backend(payload, messages)
        elif backend in {"slimx", "toaster"}:
            reply = call_slimx_backend(payload, messages)
        elif backend in {"direct_toaster", "direct-toaster"}:
            reply = call_direct_toaster_backend(payload, messages)
        elif backend == "echo":
            reply = call_echo_backend(messages)
        else:
            raise HTTPException(status_code=500, detail=f"Unknown MODEL_BACKEND: {backend}")
        return ChatResponse(
            reply=reply,
            text=reply,
            backend=backend,
            model=os.getenv("LLM_MODEL", "babygpt-152m"),
            elapsed_ms=int((time.time() - start) * 1000),
            prompt_chars=len(messages_to_prompt(messages)),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Chat request failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/generate", response_model=ChatResponse)
async def generate_endpoint(payload: ChatRequest) -> ChatResponse:
    return await chat_endpoint(payload)


@app.post("/api/chat/stream")
def chat_stream(payload: ChatRequest):
    def gen() -> Generator[str, None, None]:
        import anyio
        response = anyio.run(chat_endpoint, payload)
        yield response.text

    return StreamingResponse(gen(), media_type="text/plain; charset=utf-8", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# Static UI. Keep this after API routes.
static_dir = Path(os.getenv("STATIC_DIR", "static"))
app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
