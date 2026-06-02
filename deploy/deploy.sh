#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/slimx-chat-canvas}"
GHCR_OWNER="${GHCR_OWNER:?GHCR_OWNER is required}"
IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG is required}"
HOST_PORT="${HOST_PORT:-80}"
GRADIO_URL="${GRADIO_URL:-https://gpt.baby-gpt.com}"
GRADIO_MODEL_CHOICE="${GRADIO_MODEL_CHOICE:-babyGPT_152M_125h.llm}"
GRADIO_API_NAME="${GRADIO_API_NAME:-/gradio_interface}"
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

export GHCR_OWNER IMAGE_TAG HOST_PORT GRADIO_URL GRADIO_MODEL_CHOICE GRADIO_API_NAME

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
