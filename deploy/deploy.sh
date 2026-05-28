#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/slimx-chat-canvas}"
GHCR_OWNER="${GHCR_OWNER:?GHCR_OWNER is required}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

mkdir -p "$APP_DIR"
cd "$APP_DIR"

if [[ ! -f docker-compose.prod.yml ]]; then
  echo "Missing docker-compose.prod.yml in $APP_DIR" >&2
  exit 1
fi

export GHCR_OWNER IMAGE_TAG

echo "Pulling ghcr.io/${GHCR_OWNER}/slimx-chat-canvas:${IMAGE_TAG}"
docker compose -f docker-compose.prod.yml pull

echo "Starting updated container"
docker compose -f docker-compose.prod.yml up -d --remove-orphans

echo "Pruning unused images"
docker image prune -f

echo "Deployment complete"