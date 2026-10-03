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

## Start backend

Create `backend/.env` from your secret-managed environment template and set a
unique `AUTH_SECRET`, database password, and production settings. Never commit
that file.

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
