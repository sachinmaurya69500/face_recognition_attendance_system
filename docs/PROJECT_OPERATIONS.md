# Pratyaksh Project Operations

## GPU backend

```bash
cd /home/keplerearth/Pratyaksha
docker compose -f docker-compose.gpu.yml up -d --build
docker compose -f docker-compose.gpu.yml ps
curl -i http://127.0.0.1:8080/health
```

Expected health: `status=ok`, `model_loaded=true`, `database=ok`.

Logs and shutdown:

```bash
docker compose -f docker-compose.gpu.yml logs --tail=100 api nginx db
docker compose -f docker-compose.gpu.yml down
```

Verify GPU:

```bash
nvidia-smi
docker run --rm --gpus all nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04 nvidia-smi
```

## Face settings

Private settings are in `backend/.env`:

```ini
MATCH_THRESHOLD=0.65
MAX_IMAGE_BYTES=20971520
MAX_FACES=300
FACE_DET_THRESHOLD=0.70
FACE_DET_SIZE=1600
```

## Mobile and production APK

```bash
cd /home/keplerearth/Pratyaksha/mobile-expo
npm install
npm run typecheck
npx expo start
EAS_NO_VCS=1 eas build --platform android --profile production --non-interactive
```

## Test accounts

```text
Admin: admin / admin123
Demo teacher: demo.teacher / DemoTeacher123!
Demo student: DEMO-STUDENT / 2000-01-01
```

Change these before production use.

## Academic hierarchy

`School → Faculty → Department → Program → Semester`

Teacher access uses progressive selection. Group-photo attendance loads students in the selected scope, marks recognized students Present, and allows remaining students in that scope to be finalized Absent.

## External API

```bash
curl -i https://cair-ms-7e06.tail49e3b1.ts.net/health
```

Tailscale Funnel must forward to local port `8080`.

## Security

Never commit `backend/.env`. Do not expose ports `5432` or `8000` publicly. Keep secrets and EAS credentials private.
