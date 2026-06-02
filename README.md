# SlimX Chat Canvas + Toaster Runtime

SlimX Chat Canvas is a FastAPI + vanilla-JavaScript web app for **non-linear LLM
conversations**: a vertical main thread, persistent horizontal **deep dives**
branched from any assistant answer, and isolated **selected-text comments**
anchored to a span of a response.

The backend serves the static UI and exposes chat/inference endpoints. It runs
without Gradio and calls a local `llm_toaster` PyTorch model through a custom
[SlimX](https://github.com/slimx-ai/slimx) provider, with pluggable backends for
testing and for external/provider-served models.

## Project structure

```text
.
├── app/
│   ├── main.py                   # FastAPI app: /api/chat, /generate, /api/chat/stream, /health, static UI
│   ├── schemas.py                # Request/response Pydantic models
│   ├── slimx_gateway.py          # Provider switching + chat requests through SlimX
│   ├── providers/
│   │   └── toaster_provider.py   # Custom SlimX provider: "toaster"
│   └── runtime/
│       └── toaster_runtime.py    # Loads/runs the PyTorch checkpoint
├── config/                       # llm_toaster config loader
├── model/                        # llm_toaster model code + babyGPT config
├── tokenizer_lib/                # GPT-2 tokenizer helpers
├── static/                       # Chat Canvas frontend (index.html, app.js, styles.css)
├── server.py                     # uvicorn entrypoint (re-exports app.main:app)
├── tests/                        # pytest suite (runs in echo mode)
├── deploy/                       # docker-compose.prod.yml + deploy.sh
└── .github/workflows/            # Build + deploy pipeline (GHCR + Contabo)
```

## Backends

```text
MODEL_BACKEND=echo            # test UI/API only, no model needed
MODEL_BACKEND=http            # call an external model HTTP service (MODEL_HTTP_URL)
MODEL_BACKEND=slimx           # use a SlimX provider, usually LLM_PROVIDER=toaster
MODEL_BACKEND=direct_toaster  # bypass SlimX and call the runtime directly (debug)
```

Use `MODEL_BACKEND=slimx` with `LLM_PROVIDER=toaster` for the recommended
architecture.

## Important: the large model file

The `babyGPT_152M` checkpoint is intentionally **not** committed (it is ignored
by `.gitignore`/`.dockerignore`). Keep only the small config in git:

```text
model/babyGPT/babyGPT_152M_config
```

Provide the checkpoint at runtime:

1. Local development — place it at `model/babyGPT/babyGPT_152M` (or point
   `TOASTER_CHECKPOINT_PATH` elsewhere).
2. Docker/production — mount it read-only and set `TOASTER_CHECKPOINT_PATH`
   (see `deploy/docker-compose.prod.yml`).

## Run locally

Echo mode (no model):

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
MODEL_BACKEND=echo uvicorn server:app --host 0.0.0.0 --port 8080 --reload
# open http://localhost:8080
```

Toaster mode (local PyTorch model):

```bash
pip install -r requirements-toaster-cpu.txt
MODEL_BACKEND=slimx \
LLM_PROVIDER=toaster \
TOASTER_CONFIG_PATH=model/babyGPT/babyGPT_152M_config \
TOASTER_CHECKPOINT_PATH=model/babyGPT/babyGPT_152M \
uvicorn server:app --host 0.0.0.0 --port 8080
```

## Run with Docker

Echo mode:

```bash
docker build -t slimx-chat-canvas .
docker run --rm -p 8080:8080 -e MODEL_BACKEND=echo slimx-chat-canvas
```

Toaster mode with an external model mount:

```bash
docker run --rm -p 8080:8080 \
  -e MODEL_BACKEND=slimx -e LLM_PROVIDER=toaster \
  -e TOASTER_CONFIG_PATH=/models/babyGPT_152M_config \
  -e TOASTER_CHECKPOINT_PATH=/models/babyGPT_152M \
  -v /path/on/host/with/model:/models:ro \
  slimx-chat-canvas
```

The image runs as a non-root user and ships a `HEALTHCHECK` that polls `/health`.

## API

Preferred request (structured messages):

```json
{
  "messages": [
    {"role": "system", "content": "optional system context"},
    {"role": "user", "content": "Hello"}
  ],
  "mode": "main",
  "max_new_tokens": 128,
  "temperature": 0.8
}
```

`mode` is one of `main`, `deep`, or `comment`. A legacy `prompt` string is still
accepted for simple clients. Comment requests may include an optional `anchor`
(`message_id`, `quote`, `start`, `end`) — it is metadata only; the model context
is always the explicit `messages` array.

Response:

```json
{
  "reply": "...",
  "text": "...",
  "backend": "slimx",
  "model": "babygpt-152m",
  "elapsed_ms": 123,
  "prompt_chars": 456
}
```

Both `reply` and `text` carry the same answer (kept until all clients migrate to
one field).

## Tests

```bash
pip install -r requirements-dev.txt
python -m pytest
```

The suite runs in echo mode, so it needs no checkpoint, torch, or SlimX
provider. It covers routing, request validation, the `comment` mode, and the
message-normalization helpers.

## Deployment (GHCR + Contabo)

`.github/workflows/build-and-deploy.yml` runs on pushes to `main` (and manual
dispatch):

1. Builds the Docker image and pushes immutable commit-SHA **and** `latest` tags
   to GitHub Container Registry (GHCR), using the GitHub Actions build cache.
2. Copies `deploy/docker-compose.prod.yml` and `deploy/deploy.sh` to the host.
3. SSHes in and runs `deploy.sh`, deploying the **exact commit-SHA image**.
4. `deploy.sh` polls `/health` and only declares success once the container is
   healthy; on failure it prints recent container logs and exits non-zero.

### One-time host setup

Install Docker + the Compose plugin, then:

```bash
sudo mkdir -p /opt/slimx-chat-canvas
sudo chown -R "$USER":"$USER" /opt/slimx-chat-canvas
```

Place the model files on the host (default `/root/llm-toster-model`, override
with `MODEL_DIR`) so the read-only mount in compose can find
`babyGPT_152M_config` and the `.llm` checkpoint.

### Configuration

`deploy.sh` requires `GHCR_OWNER` and `IMAGE_TAG` (prefer an immutable SHA). It
optionally logs in to GHCR when `GHCR_USER`/`GHCR_PAT` are set, and passes these
runtime variables through to compose (each falls back to a default):

```text
HOST_PORT                 host port to publish (default 8080)
MODEL_DIR                 host dir mounted read-only at /models
MODEL_BACKEND             slimx | echo | http | direct_toaster
LLM_PROVIDER              toaster | openai | ollama | ...
LLM_MODEL                 model name reported in responses
LLM_MAX_TOKENS            max new tokens
TOASTER_CONFIG_PATH       config path inside the container
TOASTER_CHECKPOINT_PATH   checkpoint path inside the container
```

In GitHub Actions, set host/SSH/GHCR values as **secrets**
(`CONTABO_HOST`, `CONTABO_USER`, `CONTABO_SSH_KEY`, `GHCR_USER`, `GHCR_PAT`) and
the runtime knobs above as repo/environment **variables**.

See `AGENTS.md` for the full architecture, security, and contribution rules.
