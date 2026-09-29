# Cloudflare Tunnel deployment

The production path is:

`React Native APK → https://attendai.sachinmaurya.me → Cloudflare → Cloudflare Tunnel → cloudflared → Nginx → Gunicorn/FastAPI → PostgreSQL/pgvector + local AI models`.

No router port forwarding is required. Nginx, the API, PostgreSQL, and model files are not published on host ports. `cloudflared` is the only ingress service and makes outbound connections to Cloudflare.

## Cloudflare account setup (manual)

1. Add `sachinmaurya.me` to Cloudflare and change the domain nameservers at the registrar if Cloudflare requests it.
2. In Cloudflare Zero Trust, open **Networks → Tunnels → Create a tunnel**.
3. Name it, for example, `attendai-production`, choose Docker, and copy the tunnel token. Keep the token private.
4. Add a public hostname:
   - Hostname: `attendai.sachinmaurya.me`
   - Service type: HTTP
   - Service URL: `http://nginx:80` when cloudflared is run in the Compose service, or `http://127.0.0.1:80` only when cloudflared is installed directly on the host.
5. The Cloudflare dashboard creates the tunnel DNS record. Do not create an A record pointing to the server and do not expose the server public IP.

## Start the GPU deployment

From the repository root, export the token only in the current shell or place it in an ignored local `.env` file:

```sh
export CLOUDFLARE_TUNNEL_TOKEN='PASTE_YOUR_CLOUDFLARE_TUNNEL_TOKEN'
./scripts/deploy.sh
```

The script defaults to `docker-compose.gpu.yml`. It validates Compose, builds the GPU image, and starts PostgreSQL, the GPU API, Nginx, and cloudflared. For CPU deployment, use `COMPOSE_FILE=docker-compose.yml ./scripts/deploy.sh`.

Check the services:

```sh
docker compose -f docker-compose.gpu.yml ps
docker compose -f docker-compose.gpu.yml logs --tail=100 cloudflared nginx api
```

The API is only reachable inside Docker at `api:8000`; Nginx is only reachable inside Docker at `nginx:80`. PostgreSQL remains private at `db:5432`.

## Verification

Local Nginx test from the host is intentionally not available because no host port is published. Test the internal path safely:

```sh
docker compose -f docker-compose.gpu.yml exec -T nginx wget -qO- http://api:8000/health
```

Test the public path from a device outside the LAN:

```sh
curl https://attendai.sachinmaurya.me/health
```

Expected response:

```json
{"status":"ok","model_loaded":true,"database":"ok"}
```

## Mobile APK

The production API URL is already configured as:

```text
https://attendai.sachinmaurya.me
```

Build with:

```sh
cd mobile-expo
EXPO_PUBLIC_API_URL=https://attendai.sachinmaurya.me eas build -p android --profile production
```

## Firewall and router

Do not configure router port forwarding, DMZ, UPnP, or public application ports. Cloudflare Tunnel uses outbound connections. A host firewall may remain restrictive; only local Docker communication and outbound HTTPS/DNS for cloudflared are required.

## Troubleshooting

- `cloudflared` exits immediately: verify `CLOUDFLARE_TUNNEL_TOKEN` and inspect `docker compose -f docker-compose.gpu.yml logs cloudflared`.
- Cloudflare returns 502: verify the tunnel service is `http://nginx:80`, the service is on the same Compose network, and Nginx can reach `api:8000`.
- API health reports database failure: inspect `docker compose -f docker-compose.gpu.yml logs db api`; do not delete volumes.
- Never publish 5432, 8000, 8010, or any model/vector service port.
