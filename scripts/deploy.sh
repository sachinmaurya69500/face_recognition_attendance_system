#!/usr/bin/env bash
set -euo pipefail
compose_file=${COMPOSE_FILE:-docker-compose.gpu.yml}
[[ -f backend/.env ]] || { echo 'Missing backend/.env' >&2; exit 1; }
command -v docker >/dev/null || { echo 'Docker is required' >&2; exit 1; }
[[ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]] || { echo 'Set CLOUDFLARE_TUNNEL_TOKEN from your Cloudflare tunnel before deploying.' >&2; exit 1; }
docker compose -f "$compose_file" config >/dev/null
docker compose -f "$compose_file" build
docker compose -f "$compose_file" up -d
docker compose -f "$compose_file" ps
echo 'Check: curl https://attendai.sachinmaurya.me/health'
