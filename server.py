import logging
import os
from threading import Lock

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from gradio_client import Client
from pydantic import BaseModel, Field

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("slimx-chat-canvas")

app = FastAPI()


class ChatRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=12000)


GRADIO_URL = os.getenv("GRADIO_URL", "https://gpt.baby-gpt.com")
GRADIO_MODEL_CHOICE = os.getenv("GRADIO_MODEL_CHOICE", "babyGPT_152M_125h.llm")
GRADIO_API_NAME = os.getenv("GRADIO_API_NAME", "/gradio_interface")
DEBUG_PROMPTS = os.getenv("DEBUG_PROMPTS", "false").lower() == "true"

gradio_client = None
gradio_client_lock = Lock()


def get_gradio_client():
    global gradio_client
    if gradio_client is not None:
        return gradio_client

    with gradio_client_lock:
        if gradio_client is None:
            logger.info("Initializing Gradio client for %s", GRADIO_URL)
            gradio_client = Client(GRADIO_URL)
            logger.info("Gradio client connection established")

    return gradio_client


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.post("/api/chat")
def chat_endpoint(payload: ChatRequest):
    prompt = payload.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=422, detail="Prompt cannot be blank.")

    logger.info("Received chat request. prompt_chars=%s", len(prompt))
    if DEBUG_PROMPTS:
        logger.info("Prompt payload: %s", prompt)

    try:
        client = get_gradio_client()
        logger.info("Forwarding request to upstream Gradio model")

        result = client.predict(
            prompt=prompt,
            model_choice=GRADIO_MODEL_CHOICE,
            api_name=GRADIO_API_NAME,
        )

        logger.info("Upstream response received. response_type=%s", type(result).__name__)
        return {"reply": str(result)}

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error during Gradio API prediction")
        raise HTTPException(status_code=503, detail="Model backend is unavailable. Please try again later.") from exc


app.mount("/", StaticFiles(directory="static", html=True), name="static")
