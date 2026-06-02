import logging
import os
from threading import Lock
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from slimx import llm

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("slimx-chat-canvas")

app = FastAPI()


class ChatRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=12000)


def env_value(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def env_float(name: str, default: float) -> float:
    raw_value = env_value(name, str(default))
    try:
        return float(raw_value)
    except ValueError:
        logger.warning("Invalid %s=%r; using default %s", name, raw_value, default)
        return default


def env_int(name: str, default: int) -> int:
    raw_value = env_value(name, str(default))
    try:
        return int(raw_value)
    except ValueError:
        logger.warning("Invalid %s=%r; using default %s", name, raw_value, default)
        return default


SLIMX_MODEL = env_value("SLIMX_MODEL", "openai:gpt-4.1-nano")
SLIMX_TEMPERATURE = env_float("SLIMX_TEMPERATURE", 0.2)
SLIMX_MAX_TOKENS = env_int("SLIMX_MAX_TOKENS", 1024)
SLIMX_TIMEOUT = env_float("SLIMX_TIMEOUT", 60.0)
SLIMX_RETRIES = env_int("SLIMX_RETRIES", 2)
DEBUG_PROMPTS = env_value("DEBUG_PROMPTS", "false").lower() == "true"

slimx_model: Any = None
slimx_model_lock = Lock()


def create_slimx_model():
    return llm(
        SLIMX_MODEL,
        temperature=SLIMX_TEMPERATURE,
        max_tokens=SLIMX_MAX_TOKENS,
        timeout=SLIMX_TIMEOUT,
        retries=SLIMX_RETRIES,
    )


def get_slimx_model():
    global slimx_model
    if slimx_model is not None:
        return slimx_model

    with slimx_model_lock:
        if slimx_model is None:
            logger.info("Initializing SlimX model. model=%s", SLIMX_MODEL)
            slimx_model = create_slimx_model()
            logger.info("SlimX model initialized")

    return slimx_model


def call_model(prompt: str) -> str:
    try:
        result = get_slimx_model()(prompt)
    except Exception as exc:
        logger.exception("SlimX model call failed")
        raise HTTPException(status_code=503, detail="AI backend is unavailable. Please try again later.") from exc

    text = getattr(result, "text", None)
    if text is None:
        text = str(result)

    return str(text)


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/readyz")
def readyz():
    return {
        "status": "ok" if SLIMX_MODEL else "not_configured",
        "slimx_model": SLIMX_MODEL,
        "slimx_configured": bool(SLIMX_MODEL),
    }


@app.post("/api/chat")
def chat_endpoint(payload: ChatRequest):
    prompt = payload.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=422, detail="Prompt cannot be blank.")

    logger.info("Received chat request. prompt_chars=%s", len(prompt))
    if DEBUG_PROMPTS:
        logger.info("Prompt payload: %s", prompt)

    reply = call_model(prompt)
    logger.info("SlimX response received. reply_chars=%s", len(reply))
    return {"reply": reply}


app.mount("/", StaticFiles(directory="static", html=True), name="static")
