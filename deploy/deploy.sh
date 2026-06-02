#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/slimx-chat-canvas}"
GHCR_OWNER="${GHCR_OWNER:?GHCR_OWNER is required}"
IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG is required}"
HOST_PORT="${HOST_PORT:-80}"
SLIMX_MODEL="${SLIMX_MODEL:-openai:gpt-4.1-nano}"
SLIMX_TEMPERATURE="${SLIMX_TEMPERATURE:-0.2}"
SLIMX_MAX_TOKENS="${SLIMX_MAX_TOKENS:-1024}"
SLIMX_TIMEOUT="${SLIMX_TIMEOUT:-60}"
SLIMX_RETRIES="${SLIMX_RETRIES:-2}"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
OPENAI_BASE_URL="${OPENAI_BASE_URL:-}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL:-}"
ANTHROPIC_VERSION="${ANTHROPIC_VERSION:-}"
OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:${HOST_PORT}/healthz}"
HEALTHCHECK_ATTEMPTS="${HEALTHCHECK_ATTEMPTS:-30}"

mkdir -p "$APP_DIR"
cd "$APP_DIR"

if [[ ! -f docker-compose.prod.yml ]]; then
  echo "Missing docker-compose.prod.yml in $APP_DIR" >&2
  exit 1
fi

if [[ -n "${GHCR_USER:-}" && -n "${GHCR_PAT:-}" ]]; then
  echo "Logging in to GHCR as ${GHCR_USER}"
  echo "${GHCR_PAT}" | docker login ghcr.io -u "${GHCR_USER}" --password-stdin
fi

export GHCR_OWNER IMAGE_TAG HOST_PORT SLIMX_MODEL SLIMX_TEMPERATURE SLIMX_MAX_TOKENS SLIMX_TIMEOUT SLIMX_RETRIES
export OPENAI_API_KEY OPENAI_BASE_URL ANTHROPIC_API_KEY ANTHROPIC_BASE_URL ANTHROPIC_VERSION OLLAMA_BASE_URL

echo "Pulling ghcr.io/${GHCR_OWNER}/slimx-chat-canvas:${IMAGE_TAG}"
docker compose -f docker-compose.prod.yml pull

echo "Starting updated container"
docker compose -f docker-compose.prod.yml up -d --remove-orphans

echo "Waiting for health check at ${HEALTHCHECK_URL}"
for attempt in $(seq 1 "$HEALTHCHECK_ATTEMPTS"); do
  if curl --fail --silent --show-error "$HEALTHCHECK_URL" >/dev/null; then
    echo "Deployment healthy"
    docker image prune -f
    echo "Deployment complete"
    exit 0
  fi

  echo "Health check attempt ${attempt}/${HEALTHCHECK_ATTEMPTS} failed; retrying..."
  sleep 2
done

echo "Deployment failed health check. Recent container logs:" >&2
docker compose -f docker-compose.prod.yml logs --tail=100 slimx-chat-canvas >&2
exit 1
