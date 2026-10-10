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
# Frontend lazy screen mounting

The Expo frontend defers mounting of the heaviest interactive screens until
the navigation transition has completed. `DeferredScreen` uses React Native's
`InteractionManager`, so camera, recognition-results, and report screens do
not compete with the initial dashboard transition for rendering time.

This is intentionally mount deferral rather than native dynamic imports:
Metro remains compatible with Android, iOS, and web, while screen behavior and
navigation state remain unchanged. The loading indicator is shown briefly if a
screen is opened before the interaction queue is idle.

Shared frontend utilities are kept outside `App.tsx` in
`mobile-expo/components/` and `mobile-expo/utils/`. Current extracted modules
include `DeferredScreen`, `UploadDonut`, date formatting, and navigation-tab
metadata. This incremental structure is ready for future screen-by-screen
bundle splitting without changing the current navigation behavior.

## Redis caching

The backend includes an optional Redis cache at `redis://redis:6379/0`.
Academic-section data is cached for five minutes and faculty session lists for
30 seconds. Attendance writes invalidate the related faculty-session cache.
Redis is best-effort: if Redis is unavailable, requests fall back to
PostgreSQL automatically and attendance remains fully functional. A healthy
Redis connection is reported as `cache: "ok"` by `/health`; `unavailable`
means the API is using the PostgreSQL fallback.

The API also creates indexes for student section lookups, teacher session
history, and attendance log session/student and timestamp queries during
startup. The `/health` response reports the configured cache state.

## Backend tests

Run the isolated cache tests without starting PostgreSQL, Redis, or the GPU:

```bash
cd backend
python -m pip install -r requirements-dev.txt
pytest -q tests/test_cache.py
```

Start the stack with:

```bash
docker compose -f docker-compose.gpu.yml up -d --build
```
