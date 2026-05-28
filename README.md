# SlimX Chat Canvas + Toaster Runtime

This project serves the SlimX Chat Canvas UI without Gradio and can call a local `llm_toaster` PyTorch model through a custom SlimX provider.

## Project structure

```text
.
├── app/
│   ├── main.py                  # FastAPI app: /api/chat, /generate, /health, static UI
│   ├── schemas.py               # Request/response schemas
│   ├── slimx_gateway.py          # Provider switching through SlimX
│   ├── providers/
│   │   └── toaster_provider.py   # Custom SlimX provider: toaster
│   └── runtime/
│       └── toaster_runtime.py    # Loads/runs the PyTorch checkpoint
├── model/                        # Copied llm_toaster model code
├── tokenizer_lib/                # Copied llm_toaster GPT-2 tokenizer helpers
├── config/                       # Copied/adapted llm_toaster config loader
├── model/babyGPT/                # Put config/checkpoint here, or mount checkpoint externally
├── static/                       # Chat Canvas frontend
├── server.py                     # uvicorn compatibility entrypoint
└── toaster_inference_server.py   # compatibility entrypoint
```

## Important: large model file

The large `babyGPT_152M` checkpoint is intentionally not required inside the zip and is ignored by `.gitignore` and `.dockerignore`.

Keep the small config file:

```text
model/babyGPT/babyGPT_152M_config
```

Provide the large checkpoint in one of two ways:

1. Local development: place it at:

```text
model/babyGPT/babyGPT_152M
```

2. Docker/production: mount it and set:

```text
TOASTER_CHECKPOINT_PATH=/models/babyGPT_152M
```

## Local test: echo mode

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
MODEL_BACKEND=echo uvicorn server:app --host 0.0.0.0 --port 8080 --reload
```

Open:

```text
http://localhost:8080
```

## Local test: Toaster mode

Install PyTorch dependencies:

```bash
pip install -r requirements-toaster-cpu.txt
```

Run:

```bash
MODEL_BACKEND=slimx \
LLM_PROVIDER=toaster \
TOASTER_CONFIG_PATH=model/babyGPT/babyGPT_152M_config \
TOASTER_CHECKPOINT_PATH=model/babyGPT/babyGPT_152M \
uvicorn server:app --host 0.0.0.0 --port 8080
```

## Docker test: echo mode

```bash
docker build -t slimx-toaster .
docker run --rm -p 8000:8080 -e MODEL_BACKEND=echo slimx-toaster
```

Open:

```text
http://localhost:8000
```

## Docker test: Toaster mode with external model mount

```bash
docker run --rm -p 8000:8080 \
  -e MODEL_BACKEND=slimx \
  -e LLM_PROVIDER=toaster \
  -e TOASTER_CONFIG_PATH=/app/model/babyGPT/babyGPT_152M_config \
  -e TOASTER_CHECKPOINT_PATH=/models/babyGPT_152M \
  -v /path/on/host/with/model:/models:ro \
  slimx-toaster
```

## API

Preferred request format:

```json
{
  "messages": [
    {"role": "user", "content": "Hello"}
  ],
  "max_new_tokens": 128
}
```

Response:

```json
{
  "reply": "...",
  "text": "...",
  "backend": "slimx",
  "model": "babygpt-152m"
}
```

## Backends

```text
MODEL_BACKEND=echo            # test UI/API only
MODEL_BACKEND=http            # call an external model HTTP service
MODEL_BACKEND=slimx           # use SlimX provider, usually LLM_PROVIDER=toaster
MODEL_BACKEND=direct_toaster  # bypass SlimX and call runtime directly
```

Use `MODEL_BACKEND=slimx` for the final recommended architecture.
