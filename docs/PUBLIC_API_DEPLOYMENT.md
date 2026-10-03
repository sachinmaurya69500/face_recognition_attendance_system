# Public API deployment

Production API: `https://attendai.sachinmaurya.me`

This project uses Cloudflare Tunnel. Cloudflare terminates HTTPS and sends traffic through the outbound `cloudflared` container to internal Nginx. The API and PostgreSQL database have no published host ports. No router port forwarding, public IP, self-signed certificate, or Certbot setup is required.

For the complete setup, follow [`CLOUDFLARE_TUNNEL_DEPLOYMENT.md`](CLOUDFLARE_TUNNEL_DEPLOYMENT.md).

## Required Cloudflare setup

In Cloudflare Zero Trust:

1. Create or select the tunnel for this server and copy its tunnel token.
2. Add a public hostname:
   - Hostname: `attendai.sachinmaurya.me`
   - Service: `http://nginx:80`
3. Ensure the hostname is attached to the same Cloudflare-managed zone.

The token is a secret. Do not commit it or place it in tracked files.

## GPU deployment

From the project root, export the token and deploy:

```sh
./scripts/start-quick-tunnel.sh
```

The default deployment is GPU. The script builds `backend/Dockerfile.gpu`, starts PostgreSQL, API, Nginx, and cloudflared, and verifies the Compose configuration. It does not open inbound ports.

Check the services and tunnel logs:

```sh
docker compose -f docker-compose.gpu.yml ps
docker compose -f docker-compose.gpu.yml logs --tail=100 cloudflared nginx api
```

## Verification

Test the internal route:

```sh
docker compose -f docker-compose.gpu.yml exec -T nginx wget -qO- http://api:8000/health
```

Test the public route from any network:

```sh
curl -i https://attendai.sachinmaurya.me/health
```

Expected result: HTTP `200` with the API health response.

## Mobile build

```sh
cd mobile-expo
EXPO_PUBLIC_API_URL=https://attendai.sachinmaurya.me eas build -p android --profile production
```

Never use `localhost`, a LAN IP, an HTTP API URL, or a direct API port in the production APK.

Do not run `docker compose down -v` or prune commands; persistent database and model data must remain intact.
