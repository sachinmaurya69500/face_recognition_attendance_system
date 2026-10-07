# Pratyaksh Project Guide

Pratyaksh is a GPU-backed face-recognition attendance system with a FastAPI backend, PostgreSQL/pgvector database, and Nginx gateway.

## Architecture

```text
Client application -> Nginx -> FastAPI GPU API -> PostgreSQL/pgvector
                                      |
                                InsightFace/ONNX CUDA
```

The phone calls Nginx, not FastAPI directly.

## Repository

```text
backend/app/main.py       FastAPI routes, authentication, attendance
backend/app/models.py     InsightFace loading and GPU inference
backend/app/database.py   PostgreSQL connection helper
backend/Dockerfile.gpu    CUDA/ONNX Runtime GPU image
backend/requirements.txt  Python dependencies
backend/init.sql          Database schema
nginx/default.conf        Reverse proxy to api:8000
docker-compose.yml        Database, API, and Nginx services
```

## Runtime exposure

PostgreSQL, FastAPI, and Nginx are private Docker services. No host ports are
published. Public HTTPS is provided by Cloudflare Tunnel at
`https://attendai.sachinmaurya.me`.

PostgreSQL data is stored in the `pgdata` Docker volume.

## GPU requirements

The GPU image contains CUDA 12.4, cuDNN, Python, FastAPI, InsightFace, ONNX Runtime GPU, OpenCV, and the InsightFace model. The NVIDIA kernel driver cannot be packaged inside the image; every GPU host needs an NVIDIA driver and NVIDIA Container Toolkit.

Verify a new machine:

```bash
nvidia-smi
docker context use default
docker run --rm --gpus all nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04 nvidia-smi
```

## Run locally (without the API in Docker)

This is the quickest edit/debug loop: PostgreSQL stays in Docker, while
FastAPI and Expo run on the host. It requires CUDA inference by default.

```bash
cd /home/keplerearth/Pratyaksha
test -f backend/.env || cp backend/.env.example backend/.env
test -f backend/.env.local || cp backend/.env.local.example backend/.env.local
test -f mobile-expo/.env || cp mobile-expo/.env.example mobile-expo/.env

# Start only PostgreSQL and publish it to this computer, not the network.
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d db

# One-time Python setup, then start the API at http://127.0.0.1:8000.
python3 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
./scripts/run-backend-local.sh
```

In a second terminal, start the mobile client:

```bash
cd /home/keplerearth/Pratyaksha/mobile-expo
npm install
npx expo start --lan
```

`mobile-expo/.env.example` targets the Android emulator (`10.0.2.2`). For a
physical phone, change `EXPO_PUBLIC_API_URL` to your computer's LAN address,
for example `http://192.168.1.25:8000`, then restart Expo. Your firewall must
allow the selected development port on the LAN.

## Run entirely with Docker

Create `backend/.env` from `backend/.env.example`, set a unique `AUTH_SECRET`,
then start the GPU stack:

```bash
docker compose up -d --build
curl http://127.0.0.1:8080/health
docker compose logs -f api nginx db
```

The Docker gateway is bound to the host only at `127.0.0.1:8080`. To make only
Nginx reachable on your LAN for a phone test, start it explicitly as follows
and set the mobile URL to `http://YOUR_LAN_IP:8080`:

```bash
NGINX_BIND_ADDRESS=0.0.0.0 docker compose up -d --build
```

Do not expose PostgreSQL or FastAPI directly. For anything beyond a local test,
use the HTTPS tunnel/proxy deployment described below.

The standard Compose file uses the GPU image. It requires a working NVIDIA
driver and NVIDIA Container Toolkit; use `docker-compose.gpu.yml` only when a
separate GPU-specific Compose file is needed.

## Production backend

For the supported GPU deployment:

```bash
./scripts/start-quick-tunnel.sh
docker compose -f docker-compose.gpu.yml ps
docker compose -f docker-compose.gpu.yml logs --tail=100 api nginx cloudflared
curl https://attendai.sachinmaurya.me/health
```

The API must report CUDA/ONNX providers and the public health endpoint must
respond with HTTP 200.

## Database and face flow

Main tables are `students`, `student_embeddings`, `attendance_logs`, `users`, `schedules`, and `notifications`.

```text
Camera image -> quality validation -> InsightFace detection
-> ArcFace embedding -> cosine match -> identity/confidence
-> attendance validation -> attendance_logs
```

## How the mobile app and backend communicate

`mobile-expo/App.tsx` creates one Axios client using
`EXPO_PUBLIC_API_URL`. It sends JSON requests such as `POST /auth/login` and
stores the returned signed bearer token in AsyncStorage. Every later protected
request adds `Authorization: Bearer <token>`. Camera/profile images are sent as
multipart uploads to FastAPI routes such as `/validate-face` and
`/process-group-attendance`.

For native development the client calls FastAPI directly on port `8000`. In
Docker and production it calls Nginx on port `8080` (or the public HTTPS
hostname); Nginx proxies every path to `api:8000`. FastAPI authenticates the
token, reads/writes PostgreSQL through `app/database.py`, and uses InsightFace
in `app/models.py` to create and compare face embeddings. PostgreSQL is never
contacted by the mobile application.

The backend requires CUDA when `REQUIRE_GPU=1`; it intentionally fails instead of silently switching to CPU.

## API routes

```text
POST /auth/login
GET  /auth/me                         Authenticated user
GET  /health
POST /register-student                Admin/teacher face registration
POST /validate-face                   Admin/teacher
POST /process-group-attendance        Admin/teacher
GET  /teacher/attendance/report       Admin/teacher
GET  /student/attendance              Student read-only attendance
GET  /student/attendance/overview     Student dashboard data
GET  /schedule                        Authenticated users
GET  /notifications                   Authenticated users
GET  /admin/users                     Admin
POST /admin/users                     Admin/teacher student entry
GET  /admin/attendance                Admin
```

Students only view attendance. Teachers/admins register students and record attendance.

## Student account rules

Teachers/admins enter Student ID, name, email, phone, date of birth, program, and face photos. The system creates:

```text
Username = Student ID
Initial password = Date of birth
```

That same Student ID links login, profile, face embedding, and attendance records.

## Public access

Production is:

```text
APK -> Cloudflare HTTPS -> Cloudflare Tunnel -> Nginx -> FastAPI -> PostgreSQL
```

See `docs/CLOUDFLARE_TUNNEL_DEPLOYMENT.md` for tunnel creation and APK
configuration. Do not configure router port forwarding or expose database/API
ports.

## Troubleshooting

GPU failure:

```bash
nvidia-smi
docker run --rm --gpus all nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04 nvidia-smi
```

API failure:

```bash
docker compose -f docker-compose.gpu.yml logs --tail=100 api nginx cloudflared
curl https://attendai.sachinmaurya.me/health
```

APK crash logs:

```bash
adb logcat -c
adb shell monkey -p com.faceattend.mobile 1
adb logcat -d -t 500 | grep -i -E "FATAL EXCEPTION|AndroidRuntime|faceattend|reactnative"
```

Database reset (destructive):

```bash
docker compose down -v
```

## Rebuild on another PC

Install Git, Docker, NVIDIA driver/toolkit, and Node. Then:

```bash
git clone YOUR_REPOSITORY_URL
cd Face_recognition_attendance_system
nvidia-smi
./scripts/start-quick-tunnel.sh
curl https://attendai.sachinmaurya.me/health
```

No host Python virtual environment is required; the GPU Dockerfile installs backend dependencies and downloads the model during image build.

## Security checklist

- Replace development `AUTH_SECRET` with a long random secret.
- Use HTTPS for public API traffic.
- Never expose PostgreSQL publicly.
- Do not commit `.env` files or tokens.
- Back up the PostgreSQL volume.
- Force students to change initial passwords.
- Limit retention and access to biometric embeddings.
