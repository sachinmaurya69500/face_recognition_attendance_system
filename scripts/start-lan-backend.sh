#!/usr/bin/env bash
# Run the host-native FastAPI backend so devices on the local network can use it.
set -Eeuo pipefail

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)

if [[ ! -f "$project_root/backend/.env.local" ]]; then
  template="$project_root/backend/.env.local.example"
  [[ -f "$template" ]] || { echo "Missing $template" >&2; exit 1; }

  secret=$(openssl rand -hex 32)
  umask 077
  sed "s/^AUTH_SECRET=.*/AUTH_SECRET=$secret/" "$template" > "$project_root/backend/.env.local"
  echo "Created backend/.env.local with a generated development AUTH_SECRET."
fi

echo "Starting FastAPI on all network interfaces (port ${PORT:-8000})."
echo "Use ./scripts/configure-mobile-lan.sh before starting Expo."
exec "$project_root/scripts/run-backend-local.sh"
