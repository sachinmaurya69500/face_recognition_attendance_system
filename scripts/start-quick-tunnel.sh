#!/usr/bin/env bash
set -Eeuo pipefail

compose_file=${COMPOSE_FILE:-docker-compose.gpu.yml}
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"

[[ -f backend/.env ]] || { echo 'Missing backend/.env' >&2; exit 1; }
command -v docker >/dev/null || { echo 'Docker is required' >&2; exit 1; }

docker compose -f "$compose_file" up -d db api nginx
docker compose -f "$compose_file" rm -sf cloudflared >/dev/null 2>&1 || true
docker compose -f "$compose_file" up -d cloudflared

echo 'Waiting for the temporary trycloudflare.com URL...'
url=''
for _ in $(seq 1 60); do
  url=$(docker compose -f "$compose_file" logs cloudflared 2>/dev/null \
    | grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -n 1 || true)
  [[ -n "$url" ]] && break
  sleep 1
done

if [[ -z "$url" ]]; then
  echo 'Cloudflare did not provide a URL. Inspect:' >&2
  echo "docker compose -f $compose_file logs cloudflared" >&2
  exit 1
fi

echo "Temporary API URL: $url"

umask 077
printf 'EXPO_PUBLIC_API_URL=%s\n' "$url" > mobile-expo/.env.local

echo 'Mobile API configuration written to mobile-expo/.env.local.'
echo 'Restart Expo after running this command so it reads the new URL.'
echo 'Keep the tunnel running while testing the APK.'
echo "Logs: docker compose -f $compose_file logs -f cloudflared"
