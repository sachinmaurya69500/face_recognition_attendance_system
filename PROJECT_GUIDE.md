# FaceAttend Project Guide

FaceAttend is a GPU-backed face-recognition attendance system with a FastAPI backend, PostgreSQL/pgvector database, Nginx gateway, and Expo Android frontend.

## Architecture

```text
Expo Android APK -> Nginx -> FastAPI GPU API -> PostgreSQL/pgvector
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
mobile-expo/App.js        Expo UI and API client
mobile-expo/app.json      Expo configuration
mobile-expo/eas.json      EAS build profiles
```

## Docker ports

| Service | Container port | Typical host port |
|---|---:|---:|
| PostgreSQL | 5432 | 5436 |
| FastAPI | 8000 | 8011 |
| Nginx | 80 | 8081 |

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

```bash
cd ~/Face_recognition_attendance_system
docker compose down --remove-orphans
DB_HOST_PORT=5436 \
API_HOST_PORT=8011 \
NGINX_HOST_PORT=8081 \
docker compose up --build -d
```

Check it:

```bash
docker compose ps
curl http://localhost:8081/health
docker compose logs -f api
```

The API must report CUDA/ONNX providers and `/health` must respond.

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

## Expo frontend

The active frontend is `mobile-expo`. Its API URL is read from `EXPO_PUBLIC_API_URL` and embedded during build.

```bash
cd mobile-expo
npm install
npx expo start
```

Example environment values:

```env
# Android emulator
EXPO_PUBLIC_API_URL=http://10.0.2.2:8081
# Physical phone on same LAN
EXPO_PUBLIC_API_URL=http://192.168.1.10:8081
# Public deployment
EXPO_PUBLIC_API_URL=https://attendance.example.com
```

After changing the URL, build a new APK.

## EAS APK build

```bash
cd mobile-expo
npx expo-doctor
npx eas-cli@latest build --platform android --profile preview
```

For cloud builds, save the public backend URL in EAS:

```bash
npx eas-cli@latest env:create \
--name EXPO_PUBLIC_API_URL \
--value https://attendance.example.com \
--environment preview \
--visibility plaintext
```

Use `preview` for an installable internal APK and `production` for a store release.

## Public Nginx access

Nginx is enough if it has a public IP/domain and HTTPS. A local address is not globally reachable.

Temporary ngrok testing:

```bash
ngrok http 8081
```

Copy the generated HTTPS URL into `.env` and EAS, then rebuild. Free tunnel URLs can change when ngrok restarts.

Production is:

```text
VPS + domain + HTTPS -> Nginx -> FastAPI -> PostgreSQL
```

## Troubleshooting

Port conflicts:

```bash
sudo lsof -i :5436
sudo lsof -i :8011
sudo lsof -i :8081
```

GPU failure:

```bash
nvidia-smi
docker run --rm --gpus all nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04 nvidia-smi
```

API failure:

```bash
curl http://localhost:8081/health
docker compose logs --tail=100 api
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
DB_HOST_PORT=5436 API_HOST_PORT=8011 NGINX_HOST_PORT=8081 docker compose up --build -d
curl http://localhost:8081/health
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
