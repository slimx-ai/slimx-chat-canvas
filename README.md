# SlimX Chat Canvas

SlimX Chat Canvas is a FastAPI + static frontend chat app with branchable “deep dive” conversations from assistant answers.

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

Optional for private GHCR packages:

- `GHCR_USER` — GitHub username or bot account with package-read access.
- `GHCR_PAT` — GitHub PAT with `read:packages`.

## Deploy flow

Any push to `main` triggers `.github/workflows/build-and-deploy.yml` and deploys automatically. You can also run it manually from the Actions tab using **workflow_dispatch**.

The server-side deploy script accepts these optional environment variables:

- `APP_DIR` — defaults to `/opt/slimx-chat-canvas`.
- `HOST_PORT` — defaults to `80`.
- `HEALTHCHECK_URL` — defaults to `http://127.0.0.1:${HOST_PORT}/healthz`.
- `HEALTHCHECK_ATTEMPTS` — defaults to `30`.
- `GRADIO_URL` — defaults to `https://gpt.baby-gpt.com`.
- `GRADIO_MODEL_CHOICE` — defaults to `babyGPT_152M_125h.llm`.
- `GRADIO_API_NAME` — defaults to `/gradio_interface`.

## Local development

```bash
pip install -r requirements.txt
uvicorn server:app --reload --host 0.0.0.0 --port 8080
```

Then open `http://127.0.0.1:8080`.
