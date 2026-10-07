#!/usr/bin/env bash
set -Eeuo pipefail

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"

[[ -f backend/.env.local ]] || {
  echo 'Missing backend/.env.local. Copy backend/.env.local.example and set AUTH_SECRET.' >&2
  exit 1
}

# Read literal KEY=VALUE entries. Do not `source` an env file: valid values
# such as comma-separated provider lists may contain spaces and are not shell.
while IFS= read -r line || [[ -n "$line" ]]; do
  line=${line%$'\r'}
  [[ -z "$line" || "$line" == \#* ]] && continue
  if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    export "${BASH_REMATCH[1]}=${BASH_REMATCH[2]}"
  else
    echo "Ignoring invalid entry in backend/.env.local: $line" >&2
  fi
done < backend/.env.local

exec python3 -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port "${PORT:-8000}" --reload
