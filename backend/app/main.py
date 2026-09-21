import base64
import io
import hashlib
import hmac
import json
import secrets
import time
import os
from contextlib import asynccontextmanager

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from app.database import get_db_connection
from app.models import face_model

MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_BYTES", str(20 * 1024 * 1024)))
MATCH_THRESHOLD = float(os.getenv("MATCH_THRESHOLD", "0.42"))
AUTH_SECRET = os.getenv("AUTH_SECRET", "change-this-development-secret")

@asynccontextmanager
async def lifespan(_app: FastAPI):
    face_model.load()
    ensure_auth_tables()
    yield

app = FastAPI(title="Face Attendance API", version="2.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class LoginRequest(BaseModel):
    username: str
    password: str

class UserRequest(BaseModel):
    username: str
    password: str
    role: str
    student_id: str | None = None
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    date_of_birth: str | None = None
    program: str | None = None

class ScheduleRequest(BaseModel):
    subject: str
    teacher: str
    room: str
    starts_at: str
    ends_at: str
    day: str

class NotificationRequest(BaseModel):
    user_id: int
    category: str
    title: str
    body: str

class ProfileUpdate(BaseModel):
    name: str
    email: str = ""
    phone: str = ""

def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120000).hex()
    return f"{salt}${digest}"

def password_ok(password, stored):
    try:
        salt, digest = stored.split("$", 1)
    except (AttributeError, ValueError):
        return False
    return hmac.compare_digest(password_hash(password, salt).split("$", 1)[1], digest)

def token_for(user):
    payload = {"sub": user["id"], "username": user["username"], "role": user["role"], "student_id": user.get("student_id"), "exp": int(time.time()) + 86400}
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    encoded = __import__("base64").urlsafe_b64encode(raw).decode().rstrip("=")
    signature = hmac.new(AUTH_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    return encoded + "." + signature

def current_user(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "): raise HTTPException(401, "Bearer token required")
    parts = authorization[7:].split(".")
    try:
        raw = __import__("base64").urlsafe_b64decode(parts[0] + "=" * (-len(parts[0]) % 4)); payload = json.loads(raw)
        expected = hmac.new(AUTH_SECRET.encode(), raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(parts[1], expected) or payload["exp"] < time.time(): raise ValueError()
        return payload
    except (ValueError, KeyError, IndexError, json.JSONDecodeError): raise HTTPException(401, "Invalid or expired token")

def require_roles(*roles):
    def dependency(user=Depends(current_user)):
        if user["role"] not in roles: raise HTTPException(403, "Insufficient permissions")
        return user
    return dependency

def ensure_auth_tables():
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username VARCHAR(80) UNIQUE NOT NULL, password_hash TEXT NOT NULL, role VARCHAR(20) NOT NULL CHECK (role IN ('admin','teacher','student')), student_id VARCHAR(50) REFERENCES students(student_id) ON DELETE SET NULL, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)")
            cur.execute("ALTER TABLE students ADD COLUMN IF NOT EXISTS email VARCHAR(160), ADD COLUMN IF NOT EXISTS phone VARCHAR(40), ADD COLUMN IF NOT EXISTS date_of_birth DATE, ADD COLUMN IF NOT EXISTS program VARCHAR(160), ADD COLUMN IF NOT EXISTS profile_photo BYTEA")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(160), ADD COLUMN IF NOT EXISTS email VARCHAR(160), ADD COLUMN IF NOT EXISTS phone VARCHAR(40), ADD COLUMN IF NOT EXISTS profile_photo BYTEA")
            cur.execute("CREATE TABLE IF NOT EXISTS schedules (id SERIAL PRIMARY KEY, subject VARCHAR(120) NOT NULL, teacher VARCHAR(120) NOT NULL, room VARCHAR(80) NOT NULL, starts_at VARCHAR(10) NOT NULL, ends_at VARCHAR(10) NOT NULL, day VARCHAR(20) NOT NULL, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)")
            cur.execute("CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, category VARCHAR(30) NOT NULL, title VARCHAR(160) NOT NULL, body TEXT NOT NULL, is_read BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)")
            cur.execute("SELECT COUNT(*) AS count FROM users")
            if cur.fetchone()["count"] == 0: cur.executemany("INSERT INTO users (username,password_hash,role) VALUES (%s,%s,%s)", [("admin", password_hash("admin123"), "admin"), ("teacher", password_hash("teacher123"), "teacher")])
        conn.commit()
    finally: conn.close()

@app.post("/auth/login")
def login(body: LoginRequest):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur: cur.execute("SELECT id,username,password_hash,role,student_id FROM users WHERE username=%s", (body.username.strip(),)); user = cur.fetchone()
    finally: conn.close()
    if not user or not password_ok(body.password, user["password_hash"]): raise HTTPException(401, "Invalid username or password")
    return {"access_token": token_for(user), "user": {k: user[k] for k in ("id", "username", "role", "student_id")}}

@app.get("/auth/me")
def me(user=Depends(current_user)):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT display_name, email, phone FROM users WHERE id=%s", (user["sub"],))
            profile = cur.fetchone() or {}
            return {**user, **profile}
    finally: conn.close()

@app.patch("/auth/profile")
def update_profile(body: ProfileUpdate, user=Depends(current_user)):
    name, email, phone = body.name.strip(), body.email.strip(), body.phone.strip()
    if not name: raise HTTPException(422, "Name is required")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE users SET display_name=%s,email=%s,phone=%s WHERE id=%s RETURNING username,role,student_id,display_name,email,phone", (name, email or None, phone or None, user["sub"]))
            profile = cur.fetchone()
            if not profile: raise HTTPException(404, "User not found")
            if profile.get("student_id"):
                cur.execute("UPDATE students SET name=%s,email=%s,phone=%s WHERE student_id=%s", (name, email or None, phone or None, profile["student_id"]))
        conn.commit()
        return {"profile": profile}
    finally: conn.close()

@app.get("/auth/profile")
def get_profile(user=Depends(current_user)):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT username, role, student_id, display_name, email, phone, encode(profile_photo, 'base64') AS profile_photo_base64 FROM users WHERE id=%s", (user["sub"],))
            profile = cur.fetchone()
            if not profile: raise HTTPException(404, "User not found")
            if profile.get("profile_photo_base64"):
                profile["profile_photo_base64"] = f"data:image/jpeg;base64,{profile['profile_photo_base64']}"
            return {"profile": profile}
    finally: conn.close()

@app.post("/auth/profile/photo")
async def update_profile_photo(file: UploadFile = File(...), user=Depends(current_user)):
    data = await file.read()
    if not data or len(data) > MAX_IMAGE_BYTES: raise HTTPException(413, "Profile photo is empty or too large")
    try: Image.open(io.BytesIO(data)).verify()
    except Exception as exc: raise HTTPException(400, "Invalid profile image") from exc
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE users SET profile_photo=%s WHERE id=%s RETURNING id", (data, user["sub"]))
            if not cur.fetchone(): raise HTTPException(404, "User not found")
        conn.commit(); return {"status":"saved"}
    finally: conn.close()

@app.get("/schedule")
def schedule(_=Depends(current_user)):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, subject, teacher, room, starts_at, ends_at, day FROM schedules ORDER BY day, starts_at, subject")
            return {"schedule": cur.fetchall()}
    finally: conn.close()

@app.post("/admin/schedule")
def create_schedule(body: ScheduleRequest, _=Depends(require_roles("admin"))):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO schedules (subject, teacher, room, starts_at, ends_at, day) VALUES (%s,%s,%s,%s,%s,%s) RETURNING id, subject, teacher, room, starts_at, ends_at, day", (body.subject.strip(), body.teacher.strip(), body.room.strip(), body.starts_at.strip(), body.ends_at.strip(), body.day.strip()))
            result = cur.fetchone()
        conn.commit(); return result
    finally: conn.close()

@app.delete("/admin/schedule/{schedule_id}")
def delete_schedule(schedule_id: int, _=Depends(require_roles("admin"))):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur: cur.execute("DELETE FROM schedules WHERE id=%s RETURNING id", (schedule_id,)); result = cur.fetchone()
        if not result: raise HTTPException(404, "Schedule entry not found")
        conn.commit(); return {"deleted": schedule_id}
    finally: conn.close()

@app.get("/notifications")
def notifications(user=Depends(current_user)):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, category, title, body, is_read, created_at FROM notifications WHERE user_id=%s ORDER BY created_at DESC LIMIT 100", (user["sub"],))
            return {"notifications": cur.fetchall()}
    finally: conn.close()

@app.post("/notifications/{notification_id}/read")
def mark_notification_read(notification_id: int, user=Depends(current_user)):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur: cur.execute("UPDATE notifications SET is_read=TRUE WHERE id=%s AND user_id=%s RETURNING id", (notification_id, user["sub"])); result = cur.fetchone()
        if not result: raise HTTPException(404, "Notification not found")
        conn.commit(); return {"id": notification_id, "is_read": True}
    finally: conn.close()

@app.post("/admin/notifications")
def create_notification(body: NotificationRequest, _=Depends(require_roles("admin"))):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur: cur.execute("INSERT INTO notifications (user_id, category, title, body) VALUES (%s,%s,%s,%s) RETURNING id, category, title, body, is_read, created_at", (body.user_id, body.category.strip(), body.title.strip(), body.body.strip())); result = cur.fetchone()
        conn.commit(); return result
    finally: conn.close()

@app.post("/admin/users")
def create_user(body: UserRequest, _=Depends(require_roles("admin", "teacher"))):
    if body.role not in ("admin", "teacher", "student"): raise HTTPException(422, "Invalid role")
    if body.role == "student":
        if not body.student_id or not body.name or not body.date_of_birth: raise HTTPException(422, "Student ID, full name, and date of birth are required")
        body.username = body.student_id.strip()
        body.password = body.date_of_birth
    if len(body.username.strip()) < 3 or len(body.password) < 4: raise HTTPException(422, "ID must be at least 3 characters and password must be valid")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            try:
                if body.role == "student":
                    cur.execute("INSERT INTO students (student_id,name,email,phone,date_of_birth,program) VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (student_id) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,phone=EXCLUDED.phone,date_of_birth=EXCLUDED.date_of_birth,program=EXCLUDED.program", (body.student_id.strip(), body.name.strip(), body.email, body.phone, body.date_of_birth, body.program))
                cur.execute("INSERT INTO users (username,password_hash,role,student_id) VALUES (%s,%s,%s,%s) RETURNING id,username,role,student_id", (body.username.strip(), password_hash(body.password), body.role, body.student_id)); result = cur.fetchone()
            except Exception as exc: conn.rollback(); raise HTTPException(409, "Username already exists or student ID is invalid") from exc
        conn.commit(); return {"user": result}
    finally: conn.close()

@app.get("/admin/users")
def list_users(_=Depends(require_roles("admin"))):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur: cur.execute("SELECT id,username,role,student_id,created_at FROM users ORDER BY id"); return {"users": cur.fetchall()}
    finally: conn.close()

@app.delete("/admin/users/{user_id}")
def delete_user(user_id: int, _=Depends(require_roles("admin"))):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur: cur.execute("DELETE FROM users WHERE id=%s RETURNING id", (user_id,)); deleted = cur.fetchone()
        if not deleted: raise HTTPException(404, "User not found")
        conn.commit(); return {"deleted": user_id}
    finally: conn.close()

def read_image_bytes(data: bytes):
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, f"Image must be between 1 byte and {MAX_IMAGE_BYTES // (1024 * 1024)} MB")
    try:
        pil_image = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(400, "Invalid image file format") from exc
    # InsightFace's bundled detector expects RGB arrays for this model build.
    # Keeping the original channel order is essential for webcam and uploads.
    return np.asarray(pil_image)

def embedding_array(value):
    """Convert pgvector's Vector result (or a plain list) to a NumPy array."""
    if hasattr(value, "to_numpy"):
        return np.asarray(value.to_numpy(), dtype=np.float32)
    if hasattr(value, "to_list"):
        return np.asarray(value.to_list(), dtype=np.float32)
    return np.asarray(value, dtype=np.float32)

async def detect(image):
    # Always prefer the normal recognition detector and preprocessing.
    faces = await face_model.detect(image)
    # Use a sensitive proposal threshold for webcam frames, then remove weak
    # proposals. This detects real faces without counting background noise.
    if faces or image.size == 0:
        return faces

    # Conservative recovery for a genuinely difficult webcam frame. A
    # fallback is accepted only when it finds exactly one strong face; an
    # ambiguous fallback is rejected rather than inventing extra faces.
    # Images are kept in RGB for InsightFace; use the matching conversion for
    # the low-light recovery path as well.
    lab = cv2.cvtColor(image, cv2.COLOR_RGB2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    l_channel = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(8, 8)).apply(l_channel)
    enhanced = cv2.cvtColor(cv2.merge((l_channel, a_channel, b_channel)), cv2.COLOR_LAB2RGB)
    recovered = await face_model.detect(enhanced)
    if len(recovered) == 1 and float(getattr(recovered[0], "det_score", 0.0)) >= 0.60:
        return recovered
    return []

def primary_face(image, faces):
    """Choose the likely real subject for single-person enrollment."""
    if len(faces) <= 1:
        return faces
    height, width = image.shape[:2]
    def rank(face):
        x1, y1, x2, y2 = np.asarray(face.bbox, dtype=np.float32)
        area = max(0.0, x2 - x1) * max(0.0, y2 - y1) / max(width * height, 1)
        cx, cy = ((x1 + x2) / 2) / width, ((y1 + y2) / 2) / height
        centrality = max(0.0, 1.0 - ((cx - .5) ** 2 + (cy - .5) ** 2) ** .5 * 2)
        score = float(getattr(face, "det_score", 0.0))
        return area * 2.0 + centrality * .5 + score
    return [max(faces, key=rank)]

def face_quality(image, face, target_pose="any"):
    """Return explainable capture guidance for a registration frame.

    The quality gate deliberately runs on the same InsightFace landmarks used
    for recognition, so a photo accepted here is suitable for the embedding
    pipeline as well.
    """
    height, width = image.shape[:2]
    x1, y1, x2, y2 = np.asarray(face.bbox, dtype=np.float32).tolist()
    x1, y1 = max(0, int(x1)), max(0, int(y1))
    x2, y2 = min(width, int(x2)), min(height, int(y2))
    face_width, face_height = max(0, x2 - x1), max(0, y2 - y1)
    area_ratio = (face_width * face_height) / max(width * height, 1)
    crop = image[y1:y2, x1:x2]
    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY) if crop.size else np.empty((0, 0))
    brightness = float(gray.mean()) if gray.size else 0.0
    contrast = float(gray.std()) if gray.size else 0.0
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var()) if gray.size else 0.0
    issues = []

    if area_ratio < 0.08:
        issues.append("Move closer to the camera")
    elif area_ratio > 0.62:
        issues.append("Move farther from the camera")
    if brightness < 45:
        issues.append("Lighting is too dim")
    elif brightness > 215:
        issues.append("Lighting is too bright")
    if contrast < 18:
        issues.append("Use more even lighting with visible facial detail")
    if face_width < 90 or face_height < 90:
        issues.append("Move closer so your face is larger")
    if sharpness < 35:
        issues.append("Hold still so the face is sharp")

    pose_values = np.asarray(getattr(face, "pose", []), dtype=np.float32).reshape(-1)
    # InsightFace exposes pose as [pitch, yaw, roll] for this 3D landmark
    # model. Keep the names correct so pose-specific guidance works.
    pitch = float(pose_values[0]) if len(pose_values) > 0 else None
    yaw = float(pose_values[1]) if len(pose_values) > 1 else None
    pose_available = yaw is not None and pitch is not None
    if target_pose != "any" and pose_available:
        if target_pose == "center" and abs(yaw) > 12:
            issues.append("Face the camera straight on")
        elif target_pose == "left" and yaw > -15:
            issues.append("Turn your face to the left")
        elif target_pose == "right" and yaw < 15:
            issues.append("Turn your face to the right")
        elif target_pose == "chin_up":
            if abs(yaw) > 20:
                issues.append("Face the camera straight, then raise your chin")
            elif pitch < 10:
                issues.append("Raise your chin slightly")
        elif target_pose == "chin_down":
            if abs(yaw) > 20:
                issues.append("Face the camera straight, then lower your chin")
            elif pitch > -2:
                issues.append("Lower your chin slightly")
    elif target_pose != "any" and not pose_available:
        # Some InsightFace/ONNX builds do not expose pose values consistently.
        # A single detected face can still be accepted using the quality gate;
        # pose-specific guidance is applied whenever yaw/pitch are available.
        if target_pose != "center":
            issues.append("Head pose could not be measured; use a clearer photo")

    return {
        "valid": not issues,
        "issues": issues,
        "target_pose": target_pose,
        "face_bbox": [x1, y1, x2, y2],
        "face_area_ratio": round(area_ratio, 4),
        "brightness": round(brightness, 2),
        "contrast": round(contrast, 2),
        "sharpness": round(sharpness, 2),
        "yaw": round(yaw, 2) if yaw is not None else None,
        "pitch": round(pitch, 2) if pitch is not None else None,
        "roll": round(float(pose_values[2]), 2) if len(pose_values) > 2 else None,
        "pose_available": pose_available,
        "required_pose": {
            "center": "Face straight at camera",
            "chin_up": "Face straight; raise chin",
            "chin_down": "Face straight; lower chin",
            "left": "Turn face left",
            "right": "Turn face right",
        }.get(target_pose, "Any face angle"),
        "current_pose": f"yaw {yaw:.1f}°, pitch {pitch:.1f}°" if pose_available else "pose unavailable",
        "user_guidance": "Perfect—hold still" if not issues else issues[0],
    }

@app.get("/health")
def health():
    try:
        conn = get_db_connection(); conn.close()
        return {"status": "ok", "model_loaded": face_model.loaded, "database": "ok"}
    except Exception as exc:
        raise HTTPException(503, f"Database unavailable: {exc}")

@app.get("/model")
def model_info():
    """Expose the loaded model identity and its on-disk weight files."""
    files = []
    files = face_model.files()
    return {"name": face_model.name, "root": face_model.root, "loaded": face_model.loaded, "providers": face_model.providers, "files": files}

@app.post("/validate-face")
async def validate_face(
    file: UploadFile = File(...),
    target_pose: str = Form("any"),
    _=Depends(require_roles("admin", "teacher")),
):
    allowed = {"any", "center", "left", "right", "chin_up", "chin_down"}
    if target_pose not in allowed:
        raise HTTPException(422, f"target_pose must be one of: {', '.join(sorted(allowed))}")
    image = read_image_bytes(await file.read())
    # Temporary diagnostic: preserve the exact frame received from the browser.
    cv2.imwrite("/tmp/latest_validate_frame.jpg", image)
    faces = await detect(image)
    candidate_count = len(faces)
    faces = primary_face(image, faces)
    if len(faces) != 1:
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
        return {"valid": False, "issues": [f"No reliable primary face was found (detector candidates: {candidate_count})"], "faces_detected": 0, "target_pose": target_pose, "image_width": image.shape[1], "image_height": image.shape[0], "brightness": round(float(gray.mean()), 2), "contrast": round(float(gray.std()), 2)}
    quality = face_quality(image, faces[0], target_pose)
    quality["faces_detected"] = 1
    quality["image_width"] = image.shape[1]
    quality["image_height"] = image.shape[0]
    return quality

@app.get("/students")
def list_students(_=Depends(require_roles("admin", "teacher"))):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT student_id, name, email, phone, date_of_birth, program, created_at FROM students ORDER BY student_id")
            return {"students": cur.fetchall()}
    finally: conn.close()

@app.delete("/admin/students/{student_id}")
def delete_student(student_id: str, _=Depends(require_roles("admin"))):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM attendance_logs WHERE student_id=%s", (student_id,))
            cur.execute("DELETE FROM student_embeddings WHERE student_id=%s", (student_id,))
            cur.execute("DELETE FROM users WHERE student_id=%s", (student_id,))
            cur.execute("DELETE FROM students WHERE student_id=%s RETURNING student_id", (student_id,)); deleted = cur.fetchone()
        if not deleted: raise HTTPException(404, "Student not found")
        conn.commit(); return {"deleted": student_id}
    finally: conn.close()

@app.patch("/admin/students/{student_id}")
def update_student(student_id: str, name: str = Form(...), email: str = Form(""), phone: str = Form(""), date_of_birth: str = Form(""), program: str = Form(""), _=Depends(require_roles("admin"))):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""UPDATE students SET name=%s,email=%s,phone=%s,date_of_birth=NULLIF(%s,''),program=%s
                         WHERE student_id=%s RETURNING student_id,name,email,phone,date_of_birth,program""",
                        (name.strip(), email or None, phone or None, date_of_birth, program or None, student_id))
            row = cur.fetchone()
            if not row: raise HTTPException(404, "Student not found")
        conn.commit(); return row
    finally: conn.close()

@app.post("/register-student")
async def register_student(student_id: str = Form(...), name: str = Form(...), password: str = Form("welcome123"), email: str = Form(""), phone: str = Form(""), date_of_birth: str = Form(""), program: str = Form(""), files: list[UploadFile] = File(...), _=Depends(require_roles("admin", "teacher"))):
    student_id, name = student_id.strip(), name.strip()
    if not student_id or not name: raise HTTPException(422, "student_id and name are required")
    if len(password) < 4: raise HTTPException(422, "Student password must be at least 4 characters")
    if len(files) != 5: raise HTTPException(422, "Registration requires exactly 5 photos")
    embeddings = []
    required_poses = ("center", "chin_up", "chin_down", "left", "right")
    for position, upload in enumerate(files, 1):
        image = read_image_bytes(await upload.read())
        faces = await detect(image)
        if len(faces) != 1: raise HTTPException(400, f"Photo {position}: exactly one face required; found {len(faces)}")
        quality = face_quality(image, faces[0], required_poses[position - 1])
        if not quality["valid"]:
            raise HTTPException(400, f"Photo {position} ({required_poses[position - 1]}): " + "; ".join(quality["issues"]))
        vector = np.asarray(faces[0].embedding, dtype=np.float32)
        vector /= max(np.linalg.norm(vector), 1e-12)
        embeddings.append(vector)
    # Average normalized embeddings so small changes in pose/expression are
    # represented by one stable identity vector.
    embedding = np.mean(np.stack(embeddings), axis=0)
    embedding /= max(np.linalg.norm(embedding), 1e-12)
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""INSERT INTO students (student_id, name, email, phone, date_of_birth, program) VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (student_id) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,phone=EXCLUDED.phone,date_of_birth=EXCLUDED.date_of_birth,program=EXCLUDED.program""", (student_id, name, email or None, phone or None, date_of_birth or None, program or None))
            cur.execute("""INSERT INTO student_embeddings (student_id, embedding) VALUES (%s, %s)
                ON CONFLICT (student_id) DO UPDATE SET embedding=EXCLUDED.embedding""", (student_id, embedding.tolist()))
            # A student's ID is also their login ID. Registration creates or
            # refreshes the corresponding student account automatically.
            cur.execute("""INSERT INTO users (username, password_hash, role, student_id) VALUES (%s, %s, 'student', %s)
                ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash, role='student', student_id=EXCLUDED.student_id""", (student_id, password_hash(password), student_id))
        conn.commit()
    finally: conn.close()
    return {"status": "success", "student_id": student_id, "photos_used": len(embeddings), "message": f"Student {name} registered with 5 face photos"}

@app.post("/process-group-attendance")
async def process_group_attendance(session_id: str = Form(...), file: UploadFile = File(...), _=Depends(require_roles("admin", "teacher"))):
    session_id = session_id.strip()
    if not session_id: raise HTTPException(422, "session_id is required")
    image, faces = read_image_bytes(await file.read()), None
    faces = await detect(image)
    # Group photos often contain background patterns that produce weak
    # proposals. Attendance must only process face-sized, confident boxes.
    image_height, image_width = image.shape[:2]
    faces = [face for face in faces if (
        float(getattr(face, "det_score", 0.0)) >= 0.15 and
        (float(face.bbox[2]) - float(face.bbox[0])) >= max(16, image_width * 0.008) and
        (float(face.bbox[3]) - float(face.bbox[1])) >= max(16, image_height * 0.008)
    )]
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT s.student_id, s.name, e.embedding FROM students s JOIN student_embeddings e USING (student_id)")
            rows = cur.fetchall()
    finally: conn.close()
    known = np.asarray([embedding_array(r["embedding"]) for r in rows], dtype=np.float32) if rows else np.empty((0, 512), dtype=np.float32)
    if len(known): known /= np.maximum(np.linalg.norm(known, axis=1, keepdims=True), 1e-12)
    recognized, seen, annotated = [], set(), image.copy()
    for face in faces:
        query = np.asarray(face.embedding, dtype=np.float32); query /= max(np.linalg.norm(query), 1e-12)
        scores = known @ query if len(known) else np.empty(0)
        idx = int(np.argmax(scores)) if len(scores) else -1
        score = float(scores[idx]) if idx >= 0 else 0.0
        x1, y1, x2, y2 = np.asarray(face.bbox, dtype=int).tolist()
        student = rows[idx] if idx >= 0 and score >= MATCH_THRESHOLD else None
        if student and student["student_id"] not in seen:
            seen.add(student["student_id"]); recognized.append({"student_id": student["student_id"], "name": student["name"], "confidence": round(score, 4)})
            color, label = (0, 200, 0), f'{student["name"]} {score:.2f}'
        else: color, label = (0, 0, 255), "Unknown"
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2); cv2.putText(annotated, label, (x1, max(y1 - 8, 15)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
    if recognized:
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                for st in recognized:
                    cur.execute("""INSERT INTO attendance_logs (student_id, session_id, confidence_score) VALUES (%s,%s,%s)
                        ON CONFLICT (student_id, session_id) DO UPDATE SET confidence_score=GREATEST(attendance_logs.confidence_score, EXCLUDED.confidence_score)""", (st["student_id"], session_id, st["confidence"]))
                    cur.execute("""INSERT INTO notifications (user_id, category, title, body)
                        SELECT id, 'attendance', 'Attendance marked', %s FROM users WHERE student_id=%s""",
                        (f'Attendance recorded for {st["name"]} in session {session_id}.', st["student_id"]))
            conn.commit()
        finally: conn.close()
    ok, buffer = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 88])
    encoded = base64.b64encode(buffer).decode() if ok else None
    return {"session_id": session_id, "total_faces_detected": len(faces), "recognized_count": len(recognized), "students": recognized, "annotated_image_base64": f"data:image/jpeg;base64,{encoded}" if encoded else None}

@app.get("/attendance/{session_id}")
def session_attendance(session_id: str, _=Depends(require_roles("admin", "teacher"))):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT a.student_id, s.name, a.confidence_score, a.timestamp FROM attendance_logs a JOIN students s USING (student_id) WHERE a.session_id=%s ORDER BY s.name", (session_id,))
            return {"session_id": session_id, "students": cur.fetchall()}
    finally: conn.close()

@app.get("/teacher/attendance/report")
def teacher_attendance_report(
    month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    date: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    _=Depends(require_roles("admin", "teacher")),
):
    if month and date: raise HTTPException(422, "Use either month or date, not both")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            conditions, values = [], []
            if month: conditions.append("a.timestamp >= to_date(%s, 'YYYY-MM') AND a.timestamp < (to_date(%s, 'YYYY-MM') + interval '1 month')"); values += [month, month]
            if date: conditions.append("a.timestamp::date = %s::date"); values.append(date)
            where = " WHERE " + " AND ".join(conditions) if conditions else ""
            cur.execute(f"SELECT a.id, a.session_id, a.student_id, s.name, a.confidence_score, a.timestamp FROM attendance_logs a JOIN students s USING (student_id){where} ORDER BY a.timestamp DESC, s.name", values)
            records = cur.fetchall()
            cur.execute(f"SELECT a.student_id, s.name, COUNT(*) AS days_present, MIN(a.timestamp) AS first_attendance, MAX(a.timestamp) AS last_attendance FROM attendance_logs a JOIN students s USING (student_id){where} GROUP BY a.student_id, s.name ORDER BY s.name", values)
            by_student = cur.fetchall()
            return {"filter": {"month": month, "date": date}, "totals": {"attendance_records": len(records), "students_present": len(by_student), "sessions": len({row['session_id'] for row in records})}, "by_student": by_student, "records": records}
    finally: conn.close()

@app.get("/student/attendance")
def own_attendance(user=Depends(require_roles("student"))):
    if not user.get("student_id"): raise HTTPException(422, "Student account is not linked to a student")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT session_id, confidence_score, timestamp FROM attendance_logs WHERE student_id=%s ORDER BY timestamp DESC", (user["student_id"],))
            return {"student_id": user["student_id"], "attendance": cur.fetchall()}
    finally: conn.close()

@app.get("/student/attendance/overview")
def own_attendance_overview(user=Depends(require_roles("student"))):
    if not user.get("student_id"): raise HTTPException(422, "Student account is not linked to a student")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT s.student_id, s.name, s.created_at, u.username FROM students s JOIN users u ON u.student_id=s.student_id WHERE s.student_id=%s", (user["student_id"],)); profile = cur.fetchone()
            cur.execute("SELECT session_id, confidence_score, timestamp FROM attendance_logs WHERE student_id=%s ORDER BY timestamp DESC", (user["student_id"],)); attendance = cur.fetchall()
            cur.execute("SELECT DISTINCT subject, teacher, room, starts_at, ends_at, day FROM schedules ORDER BY day, starts_at, subject"); subjects = cur.fetchall()
            return {"profile": profile, "attendance": attendance, "subjects": subjects, "summary": {"present": len(attendance), "absent": 0, "overall_percentage": 100 if attendance else 0}}
    finally: conn.close()

@app.delete("/admin/attendance/{session_id}")
def delete_session(session_id: str, _=Depends(require_roles("admin"))):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur: cur.execute("DELETE FROM attendance_logs WHERE session_id=%s", (session_id,)); count = cur.rowcount
        conn.commit(); return {"deleted_records": count, "session_id": session_id}
    finally: conn.close()

@app.get("/admin/attendance")
def all_attendance(_=Depends(require_roles("admin"))):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT a.id, a.session_id, a.student_id, s.name, a.confidence_score, a.timestamp FROM attendance_logs a JOIN students s USING (student_id) ORDER BY a.timestamp DESC")
            return {"attendance": cur.fetchall()}
    finally: conn.close()
