# SlimX Chat Canvas

SlimX Chat Canvas is a FastAPI + static frontend chat app with branchable “deep dive” conversations from assistant answers. The backend uses the [SlimX](https://github.com/slimx-ai/slimx) Python stack for LLM calls instead of Gradio or a hand-rolled HTTP adapter.

## SlimX backend configuration

The app uses SlimX's high-level `llm(...)` API. Configure the runtime with environment variables:

- `SLIMX_MODEL` — SlimX model string, default `openai:gpt-4.1-nano`. Examples: `openai:gpt-4.1-nano`, `anthropic:claude-3-5-haiku-latest`, `ollama:llama3.2`.
- `SLIMX_TEMPERATURE` — generation temperature, default `0.2`.
- `SLIMX_MAX_TOKENS` — maximum output tokens, default `1024`.
- `SLIMX_TIMEOUT` — provider request timeout in seconds, default `60`.
- `SLIMX_RETRIES` — SlimX retry count, default `2`.
- `DEBUG_PROMPTS` — set to `true` only for local debugging; prompts are otherwise not logged.

Provider credentials use SlimX's provider environment variables:

- OpenAI: `OPENAI_API_KEY`; optional `OPENAI_BASE_URL`.
- Anthropic: `ANTHROPIC_API_KEY`; optional `ANTHROPIC_BASE_URL`, `ANTHROPIC_VERSION`.
- Ollama: `OLLAMA_BASE_URL`.

## Automatic Build + Deploy on Contabo

This repository includes a GitHub Actions pipeline that:

1. Builds the Docker image from `Dockerfile`.
2. Pushes immutable commit-SHA and `latest` tags to GitHub Container Registry (GHCR).
3. Copies the production deployment files to your Contabo VPS.
4. SSHes into the VPS and deploys the exact image built for that commit.
5. Verifies `/healthz` before declaring the deployment complete.

## One-time Contabo setup

Install Docker and the Docker Compose plugin on the VPS, then create the app directory:

```bash
sudo mkdir -p /opt/slimx-chat-canvas
sudo chown -R "$USER":"$USER" /opt/slimx-chat-canvas
```

If your GHCR package is private, create a GitHub PAT with `read:packages` and provide it as `GHCR_PAT` in GitHub Actions secrets. The deploy workflow will log in to GHCR on the VPS automatically when both `GHCR_USER` and `GHCR_PAT` are configured.

## Required GitHub Actions secrets

In **Repo → Settings → Secrets and variables → Actions**, add:

- `CONTABO_HOST` — VPS hostname/IP.
- `CONTABO_USER` — SSH username.
- `CONTABO_SSH_KEY` — private SSH key used by GitHub Actions.
- Provider credential for your selected `SLIMX_MODEL`, for example `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.

Optional secrets/variables:

- Repository variable `SLIMX_MODEL` — model string; defaults to `openai:gpt-4.1-nano`.
- Repository variable `SLIMX_TEMPERATURE` — generation temperature.
- Repository variable `SLIMX_MAX_TOKENS` — max output tokens.
- Repository variable `SLIMX_TIMEOUT` — provider timeout in seconds.
- Repository variable `SLIMX_RETRIES` — SlimX retry count.
- Repository variable `OPENAI_BASE_URL` — custom OpenAI-compatible base URL.
- Repository variables `ANTHROPIC_BASE_URL` and `ANTHROPIC_VERSION` — Anthropic overrides.
- Repository variable `OLLAMA_BASE_URL` — Ollama base URL.
- `GHCR_USER` — GitHub username or bot account with package-read access for private GHCR packages.
- `GHCR_PAT` — GitHub PAT with `read:packages` for private GHCR packages.

## Deploy flow

Any push to `main` triggers `.github/workflows/build-and-deploy.yml` and deploys automatically. You can also run it manually from the Actions tab using **workflow_dispatch**.

The server-side deploy script accepts these optional environment variables:

- `APP_DIR` — defaults to `/opt/slimx-chat-canvas`.
- `HOST_PORT` — defaults to `80`.
- `HEALTHCHECK_URL` — defaults to `http://127.0.0.1:${HOST_PORT}/healthz`.
- `HEALTHCHECK_ATTEMPTS` — defaults to `30`.
- `SLIMX_MODEL`, `SLIMX_TEMPERATURE`, `SLIMX_MAX_TOKENS`, `SLIMX_TIMEOUT`, `SLIMX_RETRIES` — SlimX runtime configuration.
- Provider credentials and base URLs listed above.

## Local development

```bash
pip install -r requirements.txt
OPENAI_API_KEY="..." SLIMX_MODEL="openai:gpt-4.1-nano" uvicorn server:app --reload --host 0.0.0.0 --port 8080
```

Then open `http://127.0.0.1:8080`.

Use `GET /healthz` for process health and `GET /readyz` to confirm the active SlimX model configuration.
