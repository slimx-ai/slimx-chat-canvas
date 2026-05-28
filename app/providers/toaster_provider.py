import os
from typing import Iterable, Sequence

from slimx.providers.base import Provider
from slimx.types import Result, StreamEvent, Usage
from slimx.tooling import ToolSpec

from app.runtime.toaster_runtime import ToasterRuntime


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def safe_int(value, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return default


class ToasterProvider(Provider):
    """
    Provider for babyGPT / llm_toaster.

    Important:
    This model is treated as a raw prompt-completion model, not a chat model.
    Therefore we pass only the latest user message as plain text.
    """

    name = "toaster"

    def __init__(
        self,
        runtime: ToasterRuntime | None = None,
        default_max_tokens: int | None = None,
        max_history_messages: int | None = None,
        **kwargs,
    ):
        self.runtime = runtime or ToasterRuntime()

        # Kept for compatibility with slimx_gateway.py.
        # For babyGPT raw completion mode, we do not really use history.
        self.max_history_messages = max_history_messages or safe_int(
            os.getenv("MAX_HISTORY_MESSAGES", "1"),
            1,
        )

        self.default_max_tokens = default_max_tokens or safe_int(
            os.getenv("LLM_MAX_TOKENS", os.getenv("TOASTER_MAX_NEW_TOKENS", "40")),
            40,
        )

    def _latest_user_text(self, req) -> str:
        for msg in reversed(req.messages):
            if msg.role == "user" and msg.content.strip():
                return msg.content.strip()
        return ""

    def _messages_to_prompt(self, req) -> str:
        """
        Convert Chat Canvas messages to the raw prompt format expected by babyGPT.
        """
        latest_user = self._latest_user_text(req)
        return latest_user

    def chat(self, req, *, tools: Sequence[ToolSpec] = ()) -> Result:
        prompt = self._messages_to_prompt(req)

        max_tokens = req.max_tokens or self.default_max_tokens

        text = self.runtime.generate(
            prompt,
            max_new_tokens=max_tokens,
            temperature=req.temperature,
            top_k=safe_int(os.getenv("TOASTER_TOP_K", "50"), 50),
            do_sample=env_bool("TOASTER_DO_SAMPLE", True),
            return_full_text=env_bool("TOASTER_RETURN_FULL_TEXT", False),
        )

        return Result(
            text=text,
            raw={
                "provider": self.name,
                "model": req.model,
                "prompt": prompt,
                "mode": "raw_completion",
            },
            usage=Usage(),
        )

    def stream(self, req, *, tools: Sequence[ToolSpec] = ()) -> Iterable[StreamEvent]:
        result = self.chat(req, tools=tools)

        if result.text:
            yield StreamEvent.text_delta(result.text)

        yield StreamEvent.done()


def toaster_factory(**kwargs):
    return ToasterProvider(**kwargs)