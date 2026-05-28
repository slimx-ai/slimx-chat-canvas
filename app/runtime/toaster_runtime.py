import logging
import os
from pathlib import Path
from threading import Lock
from typing import Any

import numpy as np
import torch
import tiktoken

from config import ConfigHandler
from model import TransformerModel
from tokenizer_lib import gpt2_decode, gpt2_encode, init_gpt2_tokenizer


logger = logging.getLogger(__name__)


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)

    if value is None:
        return default

    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def safe_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return default


def safe_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except Exception:
        return default


def clean_model_output(text: str) -> str:
    """
    Clean raw continuation output from a small base GPT-style model.

    This does not make the model instruction-tuned, but it prevents the UI from
    showing repeated chat-template artifacts such as:
      Assistant: ...
      User: ...
      <|endoftext|>
    """

    if not text:
        return ""

    text = text.replace("<|endoftext|>", "")
    text = text.replace("<|endoftext|", "")
    text = text.replace("|endoftext|>", "")

    stop_markers = [
        "\nUser:",
        "\nHuman:",
        "\nQuestion:",
        "\nSystem:",
        "\n###",
    ]

    for marker in stop_markers:
        if marker in text:
            text = text.split(marker, 1)[0]

    lines: list[str] = []

    for line in text.splitlines():
        stripped = line.strip()

        if not stripped:
            continue

        if stripped.startswith("Assistant:"):
            stripped = stripped.replace("Assistant:", "", 1).strip()

        if stripped.startswith("Answer:"):
            stripped = stripped.replace("Answer:", "", 1).strip()

        if stripped:
            lines.append(stripped)

    cleaned_lines: list[str] = []
    previous = None

    for line in lines:
        if line == previous:
            continue

        cleaned_lines.append(line)
        previous = line

    return "\n".join(cleaned_lines).strip()


class ToasterRuntime:
    def __init__(self) -> None:
        self.lock = Lock()
        self.loaded = False

        self.model: TransformerModel | None = None
        self.device: str = "cpu"
        self.seq_len: int = 1024
        self.eot_id: int | None = None
        self.tokenizer = None

    def load(self) -> None:
        if self.loaded:
            return

        logger.info("Loading Toaster model")

        self.device = self._select_device()
        logger.info("Device: %s", self.device)

        config_path = os.getenv(
            "TOASTER_CONFIG_PATH",
            "/app/model/babyGPT/babyGPT_152M_config",
        )

        checkpoint_path = os.getenv(
            "TOASTER_CHECKPOINT_PATH",
            "/models/babyGPT_152M",
        )

        logger.info("Config: %s", config_path)
        logger.info("Checkpoint: %s", checkpoint_path)

        if not Path(config_path).exists():
            raise FileNotFoundError(f"Config file not found: {config_path}")

        if not Path(checkpoint_path).exists():
            raise FileNotFoundError(f"Checkpoint file not found: {checkpoint_path}")

        init_gpt2_tokenizer()
        self.tokenizer = tiktoken.get_encoding("gpt2")
        self.eot_id = self.tokenizer._special_tokens.get("<|endoftext|>")

        config = self._load_config(config_path)

        raw_state = self._load_checkpoint(checkpoint_path)
        state_dict = self._extract_state_dict(raw_state)
        state_dict = self._normalize_state_dict_keys(state_dict)

        architecture = self._resolve_architecture(config, state_dict)

        vocab_size = architecture["vocab_size"]
        n_embd = architecture["n_embd"]
        n_head = architecture["n_head"]
        self.seq_len = architecture["seq_len"]
        n_blocks = architecture["n_blocks"]
        dropout_rate = architecture["dropout_rate"]

        logger.info(
            "Architecture: vocab_size=%s n_embd=%s n_head=%s seq_len=%s n_blocks=%s dropout=%s",
            vocab_size,
            n_embd,
            n_head,
            self.seq_len,
            n_blocks,
            dropout_rate,
        )

        self.model = TransformerModel(
            n_head=n_head,
            vocab_size=vocab_size,
            n_embd=n_embd,
            seq_len=self.seq_len,
            device=self.device,
            dropout_rate=dropout_rate,
            n_blocks=n_blocks,
            decoder=True,
        )

        strict_load = env_bool("TOASTER_STRICT_LOAD", True)

        missing, unexpected = self.model.load_state_dict(
            state_dict,
            strict=False,
        )

        if missing or unexpected:
            message = (
                "Checkpoint does not perfectly match model architecture.\n"
                f"Missing keys count: {len(missing)}\n"
                f"Unexpected keys count: {len(unexpected)}\n"
                f"First missing keys: {missing[:20]}\n"
                f"First unexpected keys: {unexpected[:20]}"
            )

            if strict_load:
                raise RuntimeError(message)

            logger.warning(message)

        del raw_state
        del state_dict

        self.model.to(self.device)
        self.model.eval()

        torch.set_num_threads(safe_int(os.getenv("TORCH_NUM_THREADS", "2"), 2))

        self.loaded = True
        logger.info("Toaster model loaded successfully")

    def generate(
        self,
        prompt: str,
        *,
        max_new_tokens: int | None = None,
        temperature: float | None = None,
        top_k: int | None = None,
        do_sample: bool | None = None,
        return_full_text: bool | None = None,
    ) -> str:
        if not self.loaded:
            self.load()

        if self.model is None:
            raise RuntimeError("Model is not loaded")

        max_new_tokens = max_new_tokens or safe_int(
            os.getenv("TOASTER_MAX_NEW_TOKENS", os.getenv("LLM_MAX_TOKENS", 128)),
            128,
        )

        temperature = (
            temperature
            if temperature is not None
            else safe_float(
                os.getenv("TOASTER_TEMPERATURE", os.getenv("LLM_TEMPERATURE", 0.8)),
                0.8,
            )
        )

        top_k = (
            top_k
            if top_k is not None
            else safe_int(os.getenv("TOASTER_TOP_K", 35), 35)
        )

        do_sample = (
            do_sample
            if do_sample is not None
            else env_bool("TOASTER_DO_SAMPLE", True)
        )

        return_full_text = (
            return_full_text
            if return_full_text is not None
            else env_bool("TOASTER_RETURN_FULL_TEXT", False)
        )

        stop_on_eot = env_bool("TOASTER_STOP_ON_EOT", True)

        with self.lock:
            self.model.eval()

            input_ids_np = gpt2_encode(prompt, dtype=np.int32)
            input_ids = (
                torch.tensor(input_ids_np, dtype=torch.long)
                .unsqueeze(0)
                .to(self.device)
            )

            if input_ids.size(1) > self.seq_len:
                input_ids = input_ids[:, -self.seq_len :]

            original_len = input_ids.size(1)
            generated = input_ids

            with torch.inference_mode():
                for _ in range(max_new_tokens):
                    model_input = generated[:, -self.seq_len :]
                    logits = self.model(model_input)

                    next_token = self.sample_next_token(
                        logits,
                        temperature=temperature,
                        top_k=top_k,
                        do_sample=do_sample,
                    )

                    generated = torch.cat([generated, next_token], dim=1)

                    if (
                        stop_on_eot
                        and self.eot_id is not None
                        and int(next_token.item()) == int(self.eot_id)
                    ):
                        break

            tokens = generated[0].detach().cpu().tolist()

            if return_full_text:
                decoded = self.decode(tokens)
            else:
                new_tokens = tokens[original_len:]
                decoded = self.decode(new_tokens)

            return clean_model_output(decoded)

    def sample_next_token(
        self,
        logits: torch.Tensor,
        *,
        temperature: float,
        top_k: int,
        do_sample: bool,
    ) -> torch.Tensor:
        logits = logits[:, -1, :]

        if temperature <= 0:
            return torch.argmax(logits, dim=-1, keepdim=True)

        logits = logits / max(temperature, 1e-5)

        if top_k and top_k > 0:
            top_k = min(top_k, logits.size(-1))
            values, indices = torch.topk(logits, top_k, dim=-1)

            if do_sample:
                probs = torch.softmax(values, dim=-1)
                sampled = torch.multinomial(probs, num_samples=1)
                return torch.gather(indices, 1, sampled)

            best = torch.argmax(values, dim=-1, keepdim=True)
            return torch.gather(indices, 1, best)

        if do_sample:
            probs = torch.softmax(logits, dim=-1)
            return torch.multinomial(probs, num_samples=1)

        return torch.argmax(logits, dim=-1, keepdim=True)

    def decode(self, tokens: list[int]) -> str:
        if not tokens:
            return ""

        if self.tokenizer is not None:
            return self.tokenizer.decode(tokens)

        if self.eot_id is not None and tokens[0] != self.eot_id:
            return gpt2_decode([self.eot_id] + tokens)

        return gpt2_decode(tokens)

    def _select_device(self) -> str:
        requested = os.getenv("TOASTER_DEVICE", "auto").strip().lower()

        if requested in {"cpu", "cuda", "mps"}:
            return requested

        if torch.cuda.is_available():
            return "cuda"

        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"

        return "cpu"

    def _load_config(self, config_path: str) -> Any:
        if hasattr(ConfigHandler, "from_yaml"):
            return ConfigHandler.from_yaml(config_path)

        if hasattr(ConfigHandler, "load"):
            return ConfigHandler.load(config_path)

        raise RuntimeError("ConfigHandler has neither from_yaml(...) nor load(...)")

    def _load_checkpoint(self, checkpoint_path: str) -> Any:
        try:
            return torch.load(
                checkpoint_path,
                map_location="cpu",
                weights_only=True,
            )
        except TypeError:
            return torch.load(
                checkpoint_path,
                map_location="cpu",
            )

    def _extract_state_dict(self, checkpoint: Any) -> dict[str, torch.Tensor]:
        if isinstance(checkpoint, dict):
            for key in [
                "model_state_dict",
                "state_dict",
                "model",
                "net",
            ]:
                value = checkpoint.get(key)

                if isinstance(value, dict):
                    return value

            if all(isinstance(k, str) for k in checkpoint.keys()):
                tensor_values = [
                    value for value in checkpoint.values() if torch.is_tensor(value)
                ]

                if tensor_values:
                    return checkpoint

        raise RuntimeError("Could not extract state_dict from checkpoint")

    def _normalize_state_dict_keys(
        self,
        state_dict: dict[str, torch.Tensor],
    ) -> dict[str, torch.Tensor]:
        normalized: dict[str, torch.Tensor] = {}

        for key, value in state_dict.items():
            new_key = key

            if new_key.startswith("module."):
                new_key = new_key[len("module.") :]

            if new_key.startswith("_orig_mod."):
                new_key = new_key[len("_orig_mod.") :]

            normalized[new_key] = value

        return normalized

    def _resolve_architecture(
        self,
        config: Any,
        state_dict: dict[str, torch.Tensor],
    ) -> dict[str, Any]:
        training = getattr(config, "training", config)

        vocab_size = self._get_config_value(training, "vocab_size", None)
        n_embd = self._get_config_value(training, "n_embd", None)
        n_head = self._get_config_value(training, "n_head", None)
        seq_len = self._get_config_value(training, "seq_len", None)
        n_blocks = self._get_config_value(training, "n_blocks", None)
        dropout_rate = self._get_config_value(training, "dropout_rate", 0.0)

        if vocab_size is None:
            if "token_embeddings.weight" in state_dict:
                vocab_size = state_dict["token_embeddings.weight"].shape[0]
            elif "lm_head.weight" in state_dict:
                vocab_size = state_dict["lm_head.weight"].shape[0]
            else:
                vocab_size = 50304

        if n_embd is None:
            if "token_embeddings.weight" in state_dict:
                n_embd = state_dict["token_embeddings.weight"].shape[1]
            elif "lm_head.weight" in state_dict:
                n_embd = state_dict["lm_head.weight"].shape[1]
            else:
                n_embd = 768

        if seq_len is None:
            if "position_embeddings.weight" in state_dict:
                seq_len = state_dict["position_embeddings.weight"].shape[0]
            else:
                seq_len = 1024

        if n_blocks is None:
            block_ids = set()

            for key in state_dict.keys():
                if key.startswith("TransformerBlocks."):
                    parts = key.split(".")
                    if len(parts) > 1 and parts[1].isdigit():
                        block_ids.add(int(parts[1]))

            n_blocks = max(block_ids) + 1 if block_ids else 16

        if n_head is None:
            n_head = 8

        return {
            "vocab_size": int(vocab_size),
            "n_embd": int(n_embd),
            "n_head": int(n_head),
            "seq_len": int(seq_len),
            "n_blocks": int(n_blocks),
            "dropout_rate": float(dropout_rate),
        }

    def _get_config_value(self, obj: Any, name: str, default: Any) -> Any:
        if obj is None:
            return default

        if hasattr(obj, name):
            value = getattr(obj, name)

            if value is not None:
                return value

        if isinstance(obj, dict):
            return obj.get(name, default)

        return default