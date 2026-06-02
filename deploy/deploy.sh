#!/usr/bin/env bash
#
# Pull and (re)start the SlimX Chat Canvas container on the deployment host.
#
# Required:
#   GHCR_OWNER   GitHub org/user that owns the GHCR image.
#   IMAGE_TAG    Image tag to deploy. Prefer an immutable commit SHA over the
#                mutable "latest" so a redeploy is reproducible.
#
# Optional (passed through to docker-compose.prod.yml):
#   HOST_PORT, MODEL_DIR, MODEL_BACKEND, LLM_PROVIDER, LLM_MODEL, LLM_MAX_TOKENS,
#   TOASTER_CONFIG_PATH, TOASTER_CHECKPOINT_PATH, TOASTER_* tuning vars.
#   GHCR_USER / GHCR_PAT  -> log in to GHCR before pulling (for private images).
#   HEALTHCHECK_URL / HEALTHCHECK_ATTEMPTS / HEALTHCHECK_DELAY -> startup probe.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/slimx-chat-canvas}"
GHCR_OWNER="${GHCR_OWNER:?GHCR_OWNER is required}"
IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG is required (prefer an immutable commit SHA)}"
HOST_PORT="${HOST_PORT:-8080}"

HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:${HOST_PORT}/health}"
HEALTHCHECK_ATTEMPTS="${HEALTHCHECK_ATTEMPTS:-60}"
HEALTHCHECK_DELAY="${HEALTHCHECK_DELAY:-3}"

mkdir -p "$APP_DIR"
cd "$APP_DIR"

if [[ ! -f docker-compose.prod.yml ]]; then
  echo "Missing docker-compose.prod.yml in $APP_DIR" >&2
  exit 1
fi

# Optional GHCR login for private images.
if [[ -n "${GHCR_USER:-}" && -n "${GHCR_PAT:-}" ]]; then
  echo "Logging in to GHCR as ${GHCR_USER}"
  echo "${GHCR_PAT}" | docker login ghcr.io -u "${GHCR_USER}" --password-stdin
fi

# Export everything compose may interpolate. Unset optional vars fall back to the
# defaults declared in docker-compose.prod.yml.
export GHCR_OWNER IMAGE_TAG HOST_PORT
export MODEL_DIR="${MODEL_DIR:-}"
export MODEL_BACKEND="${MODEL_BACKEND:-}"
export LLM_PROVIDER="${LLM_PROVIDER:-}"
export LLM_MODEL="${LLM_MODEL:-}"
export LLM_MAX_TOKENS="${LLM_MAX_TOKENS:-}"
export TOASTER_CONFIG_PATH="${TOASTER_CONFIG_PATH:-}"
export TOASTER_CHECKPOINT_PATH="${TOASTER_CHECKPOINT_PATH:-}"

echo "Pulling ghcr.io/${GHCR_OWNER}/slimx-chat-canvas:${IMAGE_TAG}"
docker compose -f docker-compose.prod.yml pull

echo "Starting updated container"
docker compose -f docker-compose.prod.yml up -d --remove-orphans

echo "Waiting for health check at ${HEALTHCHECK_URL}"
for attempt in $(seq 1 "$HEALTHCHECK_ATTEMPTS"); do
  if curl --fail --silent --show-error "$HEALTHCHECK_URL" >/dev/null 2>&1; then
    echo "Deployment healthy"
    docker image prune -f
    echo "Deployment complete"
    exit 0
  fi
  echo "Health check attempt ${attempt}/${HEALTHCHECK_ATTEMPTS} failed; retrying in ${HEALTHCHECK_DELAY}s..."
  sleep "$HEALTHCHECK_DELAY"
done

# Do not prune or hide diagnostics when the deploy fails the health check.
echo "Deployment failed health check. Recent container logs:" >&2
docker compose -f docker-compose.prod.yml logs --tail=100 slimx-chat-canvas >&2 || true
exit 1
