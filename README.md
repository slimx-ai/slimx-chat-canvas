# SlimX Chat Canvas

## Automatic Build + Deploy on Contabo

This repository includes a GitHub Actions pipeline that:

1. Builds the Docker image from `Dockerfile`
2. Pushes image tags (`latest` + short SHA) to GHCR
3. SSHes into your Contabo VPS and runs a deployment script

### 1) Prepare your Contabo server (one-time)

Run this on the VPS:

```bash
sudo mkdir -p /opt/slimx-chat-canvas
sudo chown -R "$USER":"$USER" /opt/slimx-chat-canvas
```

Copy deployment files from this repo to the server:

```bash
scp deploy/docker-compose.prod.yml deploy/deploy.sh user@your-contabo-host:/opt/slimx-chat-canvas/
ssh user@your-contabo-host 'chmod +x /opt/slimx-chat-canvas/deploy.sh'
```

Login to GHCR on the server (PAT with `read:packages`):

```bash
echo "$GHCR_PAT" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

### 2) Add GitHub repository secrets

In **Repo → Settings → Secrets and variables → Actions**, add:

- `CONTABO_HOST` — VPS hostname/IP
- `CONTABO_USER` — SSH username
- `CONTABO_SSH_KEY` — private SSH key used by GitHub Actions

### 3) Deploy flow

Any push to `main` triggers `.github/workflows/build-and-deploy.yml` and deploys automatically.

You can also run it manually from the Actions tab using **workflow_dispatch**.
