# Mobile device access

There are two supported ways for a phone to use a backend that runs on this computer.

## Devices on the same Wi-Fi or Ethernet network

This is for development only. The phone and computer must be on the same LAN; a guest Wi-Fi network that isolates clients will not work.

From the project root, start the backend using the LAN launcher, rather than `uvicorn app.main:app` directly:

```bash
./scripts/start-lan-backend.sh
```

In a second terminal, generate the mobile development URL and run Metro:

```bash
./scripts/configure-mobile-lan.sh
cd mobile-expo
npx expo start --lan --clear
```

The configuration command writes an ignored `mobile-expo/.env.local` file such as:

```text
EXPO_PUBLIC_API_URL=http://192.168.1.25:8000
```

The development client must be rebuilt only if it was built without the existing Android debug cleartext setting. The normal Expo development build in this repository already allows HTTP for debug builds. Never use an HTTP/LAN URL in a production APK.

Allow TCP ports `8000` (API) and `8081` (Expo/Metro) through the computer firewall on the private/home network only. Confirm from the phone browser that `http://COMPUTER_LAN_IP:8000/health` returns JSON before opening the app.

If this project is run inside WSL2 or a virtual machine, use the LAN IP of the Windows/macOS/Linux host—not the guest-only address Metro happens to print. Configure host-to-guest port forwarding, or prefer the HTTPS option below.

## Devices from any network

Use the existing Cloudflare Tunnel deployment. It provides an HTTPS address without opening router ports and is the required option for a distributable APK:

```bash
./scripts/start-quick-tunnel.sh
```

Set `EXPO_PUBLIC_API_URL` to the resulting `https://…trycloudflare.com` URL for a development session, or configure the permanent Cloudflare hostname before creating a production APK. Keep the tunnel process and backend running while clients are connected. The database and FastAPI port must not be exposed directly to the internet.

For the permanent deployment instructions, see [CLOUDFLARE_TUNNEL_DEPLOYMENT.md](CLOUDFLARE_TUNNEL_DEPLOYMENT.md).
