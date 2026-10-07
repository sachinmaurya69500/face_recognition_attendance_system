#!/usr/bin/env bash
# Point the Expo development app at this computer's FastAPI server.
set -Eeuo pipefail

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)

lan_ip=${1:-}
if [[ -z "$lan_ip" ]] && command -v ip >/dev/null 2>&1; then
  lan_ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") {print $(i + 1); exit}}' || true)
fi
if [[ -z "$lan_ip" ]]; then
  lan_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
fi

if [[ ! "$lan_ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "Could not determine a LAN IPv4 address." >&2
  echo "Run: $0 YOUR_COMPUTER_LAN_IP" >&2
  exit 1
fi

env_file="$project_root/mobile-expo/.env.local"
umask 077
printf 'EXPO_PUBLIC_API_URL=http://%s:8000\n' "$lan_ip" >"$env_file"

echo "Mobile development API: http://$lan_ip:8000"
echo "Wrote $env_file"
echo "Restart Expo with: cd $project_root/mobile-expo && npx expo start --lan --clear"
