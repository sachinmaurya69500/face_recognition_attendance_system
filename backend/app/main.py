import base64
import io
import hashlib
import hmac
import json
import logging
import warnings
import secrets
import time
import os
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image as PdfImage, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from app.pdf_services import (
    build_session_attendance_pdf,
    generate_complete_student_details_pdf,
    generate_course_wise_face_pdf,
    generate_student_text_only_pdf,
)
from app.database import get_db_connection
from app.cache import (
    cache_available,
    cache_delete,
    cache_delete_pattern,
    cache_get,
    cache_get_or_compute,
    cache_mget,
    cache_mset,
    cache_rate_limit,
    cache_set,
    cache_stats,
)
from app.session_manager import (
    create_user_session,
    decode_and_validate_token,
    delete_attendance_live_state,
    get_attendance_live_state,
    get_batch_progress,
    get_user_session,
    init_attendance_live_state,
    is_user_disabled,
    list_user_sessions,
    redis_lock,
    revoke_all_user_sessions,
    revoke_user_session,
    set_attendance_live_status,
    set_batch_progress,
    set_user_account_status,
    update_attendance_live_counters,
    update_batch_progress_step,
)
from app.models import face_model
from app.student_photos import student_photo_data_uri
from app.photo_storage import get_safe_photo_path, save_student_photo, PHOTO_STORAGE_DIR
from app.visitor_services import (
    VALID_ID_TYPES,
    VALID_PURPOSES,
    build_visitor_qr_payload,
    generate_qr_code_bytes,
    generate_qr_code_data_uri,
    generate_visitor_id,
    hash_identification_number,
    mask_identification_number,
    validate_email_format,
)

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())
warnings.filterwarnings(
    "ignore",
    message=r"`rcond` parameter will change to the default",
    category=FutureWarning,
    module=r"insightface\.utils\.transform",
)

MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_BYTES", str(20 * 1024 * 1024)))
MAX_BATCH_FILES = int(os.getenv("MAX_BATCH_FILES", "10"))
# Keep proposal generation permissive (configured in FaceModel), then enforce
# strict acceptance at the API boundary. This avoids high detector thresholds
# preventing InsightFace from producing an embedding at all.
MATCH_THRESHOLD = float(os.getenv("MATCH_THRESHOLD", "0.60"))
# Detector scores are proposal confidence, not recognition confidence. Phone
# frames commonly produce valid embeddings around 0.35-0.65.
MIN_FACE_CONFIDENCE = float(os.getenv("FACE_MIN_CONFIDENCE", "0.35"))
MIN_GROUP_FACE_CONFIDENCE = float(os.getenv("GROUP_FACE_MIN_CONFIDENCE", "0.45"))
# Blank-frame guard: mean luma and 99th-percentile luma (0-255) below which a
# capture is treated as an empty/black camera frame.
BLANK_MEAN_MAX = float(os.getenv("BLANK_FRAME_MEAN_MAX", "8"))
BLANK_P99_MAX = float(os.getenv("BLANK_FRAME_P99_MAX", "25"))
AUTH_SECRET = os.getenv("AUTH_SECRET", "change-this-development-secret")
CORS_ORIGINS = [x.strip() for x in os.getenv("CORS_ORIGINS", "").split(",") if x.strip()]
logger = logging.getLogger("pratyaksh.api")

_logged_initial_health_api = False
_logged_initial_health_access = False


class HealthCheckAccessFilter(logging.Filter):
    """Filter out repeated 200 OK /health access logs after the initial check."""

    def filter(self, record: logging.LogRecord) -> bool:
        global _logged_initial_health_access
        if getattr(record, "_is_initial_health_log", False):
            return True

        try:
            if record.args and len(record.args) >= 5:
                path = str(record.args[2])
                status_code = int(record.args[4])
                if path in ("/health", "/health/") and status_code < 400:
                    if not _logged_initial_health_access:
                        _logged_initial_health_access = True
                        record._is_initial_health_log = True
                        return True
                    return False
            else:
                msg = record.getMessage()
                if "GET /health" in msg or "GET /health/" in msg:
                    if any(err in msg for err in (" 40", " 41", " 42", " 43", " 44", " 49", " 50", " 500", " 502", " 503")):
                        return True
                    if not _logged_initial_health_access:
                        _logged_initial_health_access = True
                        record._is_initial_health_log = True
                        return True
                    return False
        except Exception:
            return True
        return True


_health_access_filter = HealthCheckAccessFilter()
for _logger_name in ("uvicorn.access", "gunicorn.access"):
    logging.getLogger(_logger_name).addFilter(_health_access_filter)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    for _logger_name in ("uvicorn.access", "gunicorn.access"):
        _log_obj = logging.getLogger(_logger_name)
        if _health_access_filter not in _log_obj.filters:
            _log_obj.addFilter(_health_access_filter)
        for _handler in _log_obj.handlers:
            if _health_access_filter not in _handler.filters:
                _handler.addFilter(_health_access_filter)
    logger.info("starting API")
    face_model.load()
    ensure_auth_tables()
    logger.info("API ready: model=%s providers=%s", face_model.name, face_model.providers)
    yield
    logger.info("stopping API")

app = FastAPI(title="Pratyaksh Attendance API", version="2.0.0", lifespan=lifespan)

@app.middleware("http")
async def request_logging(request: Request, call_next):
    """Emit useful operational logs without recording biometric or auth data."""
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("request_failed id=%s method=%s path=%s", request_id, request.method, request.url.path)
        raise
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    response.headers["X-Request-ID"] = request_id

    # Filter out repeated successful health check logs after the initial check
    if request.url.path in ("/health", "/health/") and response.status_code < 400:
        global _logged_initial_health_api
        if not _logged_initial_health_api:
            _logged_initial_health_api = True
            logger.info(
                "request id=%s method=%s path=%s status=%s duration_ms=%s",
                request_id, request.method, request.url.path, response.status_code, elapsed_ms,
            )
        return response

    logger.info(
        "request id=%s method=%s path=%s status=%s duration_ms=%s",
        request_id, request.method, request.url.path, response.status_code, elapsed_ms,
    )
    return response
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS if CORS_ORIGINS else ["*"],
    allow_origin_regex=r"^https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEFAULT_STUDENT_PASSWORD = "dsvv@123#"

class LoginRequest(BaseModel):
    username: str
    password: str
    role: str | None = None

class ResetPasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str
    username: str | None = None

class VisitorRegisterRequest(BaseModel):
    full_name: str
    email: str
    phone: str
    purpose_of_visit: str
    purpose_other: str | None = None
    expected_check_in: str
    expected_check_out: str
    identification_type: str
    identification_number: str
    password: str
    confirm_password: str
    photo_base64: str | None = None

class VisitorLoginRequest(BaseModel):
    email: str
    password: str

class UserRequest(BaseModel):
    username: str
    password: str = ""
    role: str
    student_id: str | None = None
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    date_of_birth: str | None = None
    program: str | None = None
    section_id: int | None = None
    roll_number: str | None = None
    academic_section_ids: list[int] = []

class ScheduleRequest(BaseModel):
    subject: str
    teacher: str
    room: str
    starts_at: str
    ends_at: str
    day: str

class AttendanceSessionRequest(BaseModel):
    title: str
    course: str
    school: str
    faculty: str
    department: str
    program: str
    semester: str
    section_id: int | None = None
    room: str = ""
    event_date: str
    starts_at: str
    ends_at: str
    notes: str = ""
    academic_scope: dict[str, Any] = {}
    section_ids: list[int] = []

class SessionStatusRequest(BaseModel):
    status: str

class SessionUpdateRequest(BaseModel):
    """Editable lecture metadata. The academic scope stays immutable once created."""
    title: str | None = None
    course: str | None = None
    room: str | None = None
    event_date: str | None = None
    starts_at: str | None = None
    ends_at: str | None = None
    notes: str | None = None

class StudentUpdateRequest(BaseModel):
    """Editable profile fields sent by the administrator as JSON."""
    name: str
    email: str = ""
    phone: str = ""
    date_of_birth: str = ""
    program: str = ""
    department: str = ""
    semester: str = ""
    gpa: str = ""
    enrollment_year: str = ""
    roll_number: str = ""

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

def token_for(user: dict, client_ip: str | None = None, user_agent: str | None = None) -> str:
    token, _sid = create_user_session(user, client_ip=client_ip, user_agent=user_agent)
    return token

def current_user(authorization: str | None = Header(default=None)):
    try:
        return decode_and_validate_token(authorization)
    except ValueError as exc:
        raise HTTPException(401, str(exc))

def get_photo_user(
    authorization: str | None = Header(default=None),
    token: str | None = Query(default=None),
):
    header_val = authorization
    if not header_val and token:
        header_val = f"Bearer {token}" if not token.startswith("Bearer ") else token
    if not header_val:
        raise HTTPException(401, "Authentication required to access student photos")
    try:
        return decode_and_validate_token(header_val)
    except ValueError as exc:
        raise HTTPException(401, str(exc))

@app.get("/student-photos/{filename}")
@app.get("/student_photos/{filename}")
def serve_student_photo(
    filename: str,
    user=Depends(get_photo_user),
):
    safe_path = get_safe_photo_path(filename)
    if not safe_path:
        raise HTTPException(400, "Invalid photo filename")
    if not safe_path.exists() or not safe_path.is_file():
        raise HTTPException(404, "Student photo not found")

    ext = safe_path.suffix.lower()
    media_types = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }
    media_type = media_types.get(ext, "image/jpeg")
    return FileResponse(
        str(safe_path),
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=86400, immutable"},
    )

def normalize_role(role: str) -> str:
    r = str(role or "").lower().strip()
    if r in ("teacher", "faculty"):
        return "faculty"
    if r in ("others", "other"):
        return "others"
    return r

def require_roles(*roles):
    normalized_allowed = set()
    for r in roles:
        norm = normalize_role(r)
        normalized_allowed.add(norm)
        if norm == "faculty":
            normalized_allowed.add("teacher")
            normalized_allowed.add("faculty")
        elif norm == "others":
            normalized_allowed.add("others")
            normalized_allowed.add("other")
        else:
            normalized_allowed.add(str(r).lower().strip())

    def dependency(user=Depends(current_user)):
        user_role = str(user.get("role", "")).lower().strip()
        if user_role not in normalized_allowed and normalize_role(user_role) not in normalized_allowed:
            raise HTTPException(403, "Insufficient permissions")
        return user
    return dependency

def session_section_ids(session: dict) -> list[int]:
    """Return the primary and any additional sections attached to a session."""
    scope = session.get("academic_scope") or {}
    if isinstance(scope, str):
        try: scope = json.loads(scope)
        except json.JSONDecodeError: scope = {}
    raw_ids = [session.get("section_id"), *(scope.get("section_ids", []) if isinstance(scope, dict) else [])]
    return list(dict.fromkeys(int(section_id) for section_id in raw_ids if section_id is not None))

def ensure_auth_tables():
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Docker's PostgreSQL entrypoint runs init.sql automatically. A
            # native PostgreSQL instance does not, so apply the same
            # idempotent base schema before adding the application tables.
            schema_path = Path(__file__).resolve().parents[1] / "init.sql"
            # Only run the bundled bootstrap script for a genuinely new
            # database.  Replaying init.sql on every API restart would
            # reinsert its demo roster after an administrator removes it.
            cur.execute("SELECT to_regclass('public.users')")
            schema_probe = cur.fetchone()
            if schema_probe["to_regclass"] is None:
                cur.execute(schema_path.read_text(encoding="utf-8"))
            cur.execute("CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username VARCHAR(80) UNIQUE NOT NULL, password_hash TEXT NOT NULL, role VARCHAR(20) NOT NULL CHECK (role IN ('admin','teacher','student','faculty','others','other')), student_id VARCHAR(50) REFERENCES students(student_id) ON DELETE SET NULL, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)")
            cur.execute("""
                DO $$
                BEGIN
                    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
                    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'teacher', 'faculty', 'student', 'others', 'other'));
                EXCEPTION WHEN OTHERS THEN NULL;
                END $$;
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS visitors (
                    id SERIAL PRIMARY KEY,
                    visitor_id VARCHAR(50) UNIQUE NOT NULL,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    full_name VARCHAR(160) NOT NULL,
                    email VARCHAR(160) UNIQUE NOT NULL,
                    phone VARCHAR(40) NOT NULL,
                    purpose_of_visit VARCHAR(160) NOT NULL,
                    purpose_other TEXT,
                    expected_check_in TIMESTAMPTZ NOT NULL,
                    expected_check_out TIMESTAMPTZ NOT NULL,
                    identification_type VARCHAR(80) NOT NULL,
                    identification_number_masked VARCHAR(50) NOT NULL,
                    identification_number_hash VARCHAR(128),
                    registration_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    status VARCHAR(30) NOT NULL DEFAULT 'REGISTERED',
                    qr_payload JSONB,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS visitors_visitor_id_idx ON visitors(visitor_id);
                CREATE INDEX IF NOT EXISTS visitors_user_id_idx ON visitors(user_id);
                CREATE INDEX IF NOT EXISTS visitors_email_idx ON visitors(LOWER(email));
            """)
            cur.execute("ALTER TABLE students ADD COLUMN IF NOT EXISTS email VARCHAR(160), ADD COLUMN IF NOT EXISTS phone VARCHAR(40), ADD COLUMN IF NOT EXISTS date_of_birth DATE, ADD COLUMN IF NOT EXISTS program VARCHAR(160), ADD COLUMN IF NOT EXISTS semester VARCHAR(80), ADD COLUMN IF NOT EXISTS department VARCHAR(160), ADD COLUMN IF NOT EXISTS gpa VARCHAR(30), ADD COLUMN IF NOT EXISTS enrollment_year VARCHAR(10), ADD COLUMN IF NOT EXISTS profile_photo BYTEA, ADD COLUMN IF NOT EXISTS profile_photo_thumbnail TEXT")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(160), ADD COLUMN IF NOT EXISTS email VARCHAR(160), ADD COLUMN IF NOT EXISTS phone VARCHAR(40), ADD COLUMN IF NOT EXISTS profile_photo BYTEA, ADD COLUMN IF NOT EXISTS profile_picture VARCHAR(255), ADD COLUMN IF NOT EXISTS must_reset_password BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN IF NOT EXISTS profile_photo_thumbnail TEXT")
            cur.execute("ALTER TABLE visitors ADD COLUMN IF NOT EXISTS profile_photo BYTEA, ADD COLUMN IF NOT EXISTS profile_picture VARCHAR(255), ADD COLUMN IF NOT EXISTS profile_photo_thumbnail TEXT")
            try:
                cur.execute("SELECT student_id, profile_photo FROM students WHERE profile_photo IS NOT NULL AND profile_photo_thumbnail IS NULL LIMIT 200")
                for ut in cur.fetchall():
                    t_uri = student_photo_data_uri(ut["profile_photo"])
                    if t_uri:
                        cur.execute("UPDATE students SET profile_photo_thumbnail = %s WHERE student_id = %s", (t_uri, ut["student_id"]))
                        cur.execute("UPDATE users SET profile_photo_thumbnail = %s WHERE student_id = %s", (t_uri, ut["student_id"]))
            except Exception:
                pass
            cur.execute("CREATE TABLE IF NOT EXISTS schedules (id SERIAL PRIMARY KEY, subject VARCHAR(120) NOT NULL, teacher VARCHAR(120) NOT NULL, room VARCHAR(80) NOT NULL, starts_at VARCHAR(10) NOT NULL, ends_at VARCHAR(10) NOT NULL, day VARCHAR(20) NOT NULL, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)")
            cur.execute("""CREATE TABLE IF NOT EXISTS attendance_sessions (
                session_id VARCHAR(50) PRIMARY KEY, teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                title VARCHAR(160) NOT NULL, course VARCHAR(160) NOT NULL, school VARCHAR(160) NOT NULL,
                faculty VARCHAR(160) NOT NULL, department VARCHAR(160) NOT NULL, program VARCHAR(160) NOT NULL,
                semester VARCHAR(80) NOT NULL, section_id INTEGER, room VARCHAR(80), event_date DATE NOT NULL,
                starts_at TIME NOT NULL, ends_at TIME NOT NULL, notes TEXT,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)""")
            cur.execute("ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS section_id INTEGER")
            cur.execute("ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS academic_scope JSONB")
            cur.execute("ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'")
            cur.execute("ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ")
            cur.execute("CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, category VARCHAR(30) NOT NULL, title VARCHAR(160) NOT NULL, body TEXT NOT NULL, is_read BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)")
            cur.execute("CREATE TABLE IF NOT EXISTS academic_sections (id SERIAL PRIMARY KEY, school VARCHAR(160) NOT NULL, faculty VARCHAR(160) NOT NULL, department VARCHAR(160) NOT NULL, program VARCHAR(160) NOT NULL, semester VARCHAR(80) NOT NULL, section VARCHAR(80) NOT NULL, UNIQUE(school, faculty, department, program, semester, section))")
            cur.execute("SELECT COUNT(*) AS count FROM academic_sections")
            # Seed the bundled catalogue only for an empty database. Running
            # the bulk upsert on every API restart delayed readiness without
            # changing an already-populated hierarchy.
            if cur.fetchone()["count"] == 0 and os.getenv("SEED_CATALOG", "").lower() == "true":
                catalog = [
                    ("School of Technology, Communication and Management", "Faculty of Technology and Management", "Department of Computer Sciences", "B.Sc. Information Technology (Honors)"),
                    ("School of Technology, Communication and Management", "Faculty of Technology and Management", "Department of Computer Sciences", "Bachelor of Computer Application (Honors)"),
                    ("School of Technology, Communication and Management", "Faculty of Technology and Management", "Department of Computer Sciences", "Master of Computer Application (Data Science)"),
                    ("School of Technology, Communication and Management", "Faculty of Technology and Management", "Department of Computer Sciences", "Ph. D. Computer Science"),
                    ("School of Technology, Communication and Management", "Faculty of Technology and Management", "Department of Mathematics", "B.Sc. Mathematics (Honors)"),
                    ("School of Technology, Communication and Management", "Faculty of Technology and Management", "Department of Tourism Management", "B.B.A Tourism & Travel Management (Honors)"),
                    ("School of Technology, Communication and Management", "Faculty of Technology and Management", "Department of Tourism Management", "B.A. Tourism & Travel Management (Honors)"),
                    ("School of Technology, Communication and Management", "Faculty of Technology and Management", "Department of Tourism Management", "M.B.A. Tourism & Travel Management"),
                    ("School of Technology, Communication and Management", "Faculty of Technology and Management", "Department of Tourism Management", "Ph. D. Tourism Management"),
                    ("School of Technology, Communication and Management", "Faculty of Communication", "Department of Journalism & Mass Communication", "B.A. Journalism and Mass Communication (Honors)"),
                    ("School of Technology, Communication and Management", "Faculty of Communication", "Department of Journalism & Mass Communication", "M.A. Journalism and Mass Communication"),
                    ("School of Technology, Communication and Management", "Faculty of Communication", "Department of Journalism & Mass Communication", "Ph. D. Journalism and Mass Communication"),
                    ("School of Technology, Communication and Management", "Faculty of Communication", "Department of Animation and Visual Effects", "B.Voc. (Bachelor of Vocation) in 3D Animation and VFX (Honors)"),
                    ("School of Biological Sciences and Sustainability", "Faculty of Rural Studies and Sustainability", "Department of Rural Studies and Sustainability", "Bachelor of Rural Studies (Honors)"),
                    ("School of Humanities, Social Sciences and Foundation Courses", "Faculty of Humanities and Social Sciences", "Department of English", "B.A. English (Honors)"),
                    ("School of Humanities, Social Sciences and Foundation Courses", "Faculty of Humanities and Social Sciences", "Department of Education", "B.Ed. (Bachelor of Education)"),
                    ("School of Humanities, Social Sciences and Foundation Courses", "Faculty of Humanities and Social Sciences", "Department of Education", "M.A. Education"),
                    ("School of Humanities, Social Sciences and Foundation Courses", "Faculty of Humanities and Social Sciences", "Department of Education", "Ph. D. Education"),
                    ("School of Humanities, Social Sciences and Foundation Courses", "Faculty of Humanities and Social Sciences", "Department of Psychology", "B.A. Psychology (Honors)"),
                    ("School of Humanities, Social Sciences and Foundation Courses", "Faculty of Humanities and Social Sciences", "Department of Psychology", "M.A. Clinical Psychology"),
                    ("School of Humanities, Social Sciences and Foundation Courses", "Faculty of Humanities and Social Sciences", "Department of Psychology", "M.Sc. Clinical Psychology"),
                    ("School of Humanities, Social Sciences and Foundation Courses", "Faculty of Humanities and Social Sciences", "Department of Psychology", "P.G. Diploma Guidance & Counseling"),
                    ("School of Humanities, Social Sciences and Foundation Courses", "Faculty of Humanities and Social Sciences", "Department of Psychology", "Ph. D. Psychology"),
                    ("School of Humanities, Social Sciences and Foundation Courses", "Faculty of Foundation Courses", "Department of Life Management", "Life Management - Compulsory Subject for PG and UG"),
                    ("School of Humanities, Social Sciences and Foundation Courses", "Faculty of Foundation Courses", "Department of Scientific Spirituality", "Scientific Spirituality - Foundation Course"),
                    ("School of Humanities, Social Sciences and Foundation Courses", "Faculty of Foundation Courses", "Department of Oriental Studies, Religious Studies and Philosophy", "P.G. Diploma Theology & Psychological Counseling"),
                    ("School of Humanities, Social Sciences and Foundation Courses", "Faculty of Foundation Courses", "Department of Oriental Studies, Religious Studies and Philosophy", "M.A. Hindu Studies"),
                    ("School of Humanities, Social Sciences and Foundation Courses", "Faculty of Foundation Courses", "Department of Oriental Studies, Religious Studies and Philosophy", "M.A. Philosophy"),
                    ("School of Indology", "Faculty of Yoga & Health", "Department of Yoga and Alternative Therapy", "B.Sc. Yogic Science (Honors)"),
                    ("School of Indology", "Faculty of Yoga & Health", "Department of Yoga and Alternative Therapy", "M.Sc. Yoga Therapy"),
                    ("School of Indology", "Faculty of Yoga & Health", "Department of Yoga and Alternative Therapy", "M.A. Human Consciousness & Yogic Science"),
                    ("School of Indology", "Faculty of Yoga & Health", "Department of Yoga and Alternative Therapy", "M.Sc. Human Consciousness & Yogic Science"),
                    ("School of Indology", "Faculty of Yoga & Health", "Department of Yoga and Alternative Therapy", "Ph. D. Human Consciousness & Yogic Science"),
                    ("School of Indology", "Faculty of Yoga & Health", "Department of Yoga and Alternative Therapy", "Ph. D. Oriental Studies"),
                    ("School of Indology", "Faculty of Yoga & Health", "Department of Yoga and Alternative Therapy", "Certificate in Yoga and Alternative Therapy"),
                    ("School of Indology", "Faculty of Yoga & Health", "Department of Yoga and Alternative Therapy", "P.G. Diploma Human Consciousness, Yoga & Alternative Therapy"),
                    ("School of Indology", "Faculty of Indian Languages", "Department of Vedic Studies and Sanskrit", "B.A. Sanskrit (Honors)"),
                    ("School of Indology", "Faculty of Indian Languages", "Department of Vedic Studies and Sanskrit", "M.A. Sanskrit"),
                    ("School of Indology", "Faculty of Indian Languages", "Department of Vedic Studies and Sanskrit", "Ph.D. Sanskrit"),
                    ("School of Indology", "Faculty of Indian Languages", "Department of Hindi", "B.A. Hindi (Honors)"),
                    ("School of Indology", "Faculty of Indian Languages", "Department of Hindi", "M.A. Hindi"),
                    ("School of Indology", "Faculty of Indian Languages", "Department of Hindi", "Ph.D. Hindi"),
                    ("School of Indology", "Faculty of Music & Indian Culture", "Department of Indian Classical Music", "B.A. Music (Vocal) (Honors)"),
                    ("School of Indology", "Faculty of Music & Indian Culture", "Department of Indian Classical Music", "M.A. Music (Vocal)"),
                    ("School of Indology", "Faculty of Music & Indian Culture", "Department of Indian Classical Music", "B.A. Music Instrumental Mridang/Tabla (Honors)"),
                    ("School of Indology", "Faculty of Music & Indian Culture", "Department of Indian Classical Music", "M.A. Music (Tabla, Pakhaawaj)"),
                    ("School of Indology", "Faculty of Music & Indian Culture", "Department of Indian Classical Music", "Ph. D. Indian Classical Music"),
                    ("School of Indology", "Faculty of Music & Indian Culture", "Department of History and Indian Culture", "B.A. History (Honors)"),
                    ("School of Indology", "Faculty of Music & Indian Culture", "Department of History and Indian Culture", "M.A. History and Indian Culture"),
                    ("School of Indology", "Faculty of Music & Indian Culture", "Department of History and Indian Culture", "Ph. D. History"),
                ]
                rows = [(school, faculty, department, program, semester, "Section A") for school, faculty, department, program in catalog for semester in (f"Semester {number}" for number in range(1, 9))]
                cur.executemany("INSERT INTO academic_sections (school,faculty,department,program,semester,section) VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING", rows)
            cur.execute("CREATE TABLE IF NOT EXISTS teacher_assignments (id SERIAL PRIMARY KEY, teacher_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, section_id INTEGER REFERENCES academic_sections(id) ON DELETE CASCADE, subject VARCHAR(160) NOT NULL, UNIQUE(teacher_user_id, section_id, subject))")
            cur.execute("ALTER TABLE students ADD COLUMN IF NOT EXISTS section_id INTEGER REFERENCES academic_sections(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS roll_number VARCHAR(50)")
            cur.execute("CREATE INDEX IF NOT EXISTS students_section_id_idx ON students(section_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS attendance_sessions_teacher_date_idx ON attendance_sessions(teacher_id, event_date DESC, starts_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS attendance_logs_session_student_idx ON attendance_logs(session_id, student_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS attendance_logs_student_timestamp_idx ON attendance_logs(student_id, timestamp DESC)")
            cur.execute("""CREATE TABLE IF NOT EXISTS attendance_upload_batches (
                id UUID PRIMARY KEY, session_id VARCHAR(50) NOT NULL REFERENCES attendance_sessions(session_id) ON DELETE CASCADE,
                submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                section_id INTEGER REFERENCES academic_sections(id) ON DELETE SET NULL,
                program VARCHAR(160) NOT NULL, semester VARCHAR(80) NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'PROCESSING', idempotency_key VARCHAR(100),
                total_files INTEGER NOT NULL DEFAULT 0, processed_files INTEGER NOT NULL DEFAULT 0,
                recognized_count INTEGER NOT NULL DEFAULT 0, duplicate_count INTEGER NOT NULL DEFAULT 0,
                unknown_faces INTEGER NOT NULL DEFAULT 0, failed_files INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, completed_at TIMESTAMPTZ,
                UNIQUE (session_id, idempotency_key))""")
            cur.execute("""CREATE TABLE IF NOT EXISTS attendance_batch_photos (
                id UUID PRIMARY KEY, batch_id UUID NOT NULL REFERENCES attendance_upload_batches(id) ON DELETE CASCADE,
                filename VARCHAR(255) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'PROCESSING',
                faces_detected INTEGER NOT NULL DEFAULT 0, recognized_count INTEGER NOT NULL DEFAULT 0,
                unknown_faces INTEGER NOT NULL DEFAULT 0, error_message TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)""")
            cur.execute("CREATE INDEX IF NOT EXISTS attendance_batches_session_created_idx ON attendance_upload_batches(session_id, created_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS attendance_batch_photos_batch_idx ON attendance_batch_photos(batch_id)")
            cur.execute("ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS recognition_status VARCHAR(20) NOT NULL DEFAULT 'NOT_RECOGNIZED', ADD COLUMN IF NOT EXISTS initial_attendance_status VARCHAR(10) NOT NULL DEFAULT 'ABSENT', ADD COLUMN IF NOT EXISTS final_attendance_status VARCHAR(10), ADD COLUMN IF NOT EXISTS attendance_method VARCHAR(24) NOT NULL DEFAULT 'FACE_RECOGNITION', ADD COLUMN IF NOT EXISTS is_manual_override BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP")
            cur.execute("CREATE TABLE IF NOT EXISTS audit_logs (id SERIAL PRIMARY KEY, actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL, action VARCHAR(80) NOT NULL, entity VARCHAR(80) NOT NULL, entity_id VARCHAR(120), previous_value JSONB, new_value JSONB, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)")
            # QR code identity & mutual connections
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS qr_code_id UUID DEFAULT gen_random_uuid()")
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_qr_code_id_idx ON users(qr_code_id)")
            cur.execute("UPDATE users SET qr_code_id = gen_random_uuid() WHERE qr_code_id IS NULL")

            cur.execute("""CREATE TABLE IF NOT EXISTS user_connections (
                id SERIAL PRIMARY KEY,
                user_id_1 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                user_id_2 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                connected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT check_no_self_connection CHECK (user_id_1 <> user_id_2)
            )""")
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS unique_user_connection_idx ON user_connections (LEAST(user_id_1, user_id_2), GREATEST(user_id_1, user_id_2))")
            cur.execute("CREATE INDEX IF NOT EXISTS user_connections_user1_idx ON user_connections(user_id_1)")
            cur.execute("CREATE INDEX IF NOT EXISTS user_connections_user2_idx ON user_connections(user_id_2)")
            cur.execute("CREATE INDEX IF NOT EXISTS user_connections_connected_at_idx ON user_connections(connected_at DESC)")
            # The database is intentionally empty except for the administrator.
            # Students and teachers are created through the application flows.
            cur.execute("""INSERT INTO users (username, password_hash, role)
                VALUES ('admin', %s, 'admin')
                ON CONFLICT (username) DO NOTHING""", (password_hash("admin123"),))

            # Initialize all students with default password dsvv@123# and must_reset_password = TRUE
            cur.execute("""
                CREATE TABLE IF NOT EXISTS app_settings (
                    key VARCHAR(80) PRIMARY KEY,
                    value TEXT NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cur.execute("SELECT value FROM app_settings WHERE key = 'default_student_password_initialized'")
            if not cur.fetchone():
                cur.execute(
                    "UPDATE users SET password_hash = %s, must_reset_password = TRUE WHERE role = 'student'",
                    (password_hash(DEFAULT_STUDENT_PASSWORD),)
                )
                cur.execute("""
                    INSERT INTO users (username, password_hash, role, student_id, display_name, email, phone, must_reset_password)
                    SELECT s.student_id, %s, 'student', s.student_id, s.name, s.email, s.phone, TRUE
                    FROM students s
                    WHERE s.student_id NOT IN (SELECT student_id FROM users WHERE student_id IS NOT NULL)
                    ON CONFLICT (username) DO NOTHING
                """, (password_hash(DEFAULT_STUDENT_PASSWORD),))
                cur.execute("INSERT INTO app_settings (key, value) VALUES ('default_student_password_initialized', 'true') ON CONFLICT DO NOTHING")
            else:
                # Ensure any newly enrolled students in students table have user accounts
                cur.execute("""
                    INSERT INTO users (username, password_hash, role, student_id, display_name, email, phone, must_reset_password)
                    SELECT s.student_id, %s, 'student', s.student_id, s.name, s.email, s.phone, TRUE
                    FROM students s
                    WHERE s.student_id NOT IN (SELECT student_id FROM users WHERE student_id IS NOT NULL)
                    ON CONFLICT (username) DO NOTHING
                """, (password_hash(DEFAULT_STUDENT_PASSWORD),))
        conn.commit()
    finally: conn.close()

@app.post("/auth/login")
def login(body: LoginRequest, request: Request):
    username_clean = body.username.strip().lower()
    allowed, remaining, reset_s = cache_rate_limit(f"login:{username_clean}", max_requests=10, window_seconds=60)
    if not allowed:
        raise HTTPException(429, f"Too many login attempts. Please wait {reset_s} seconds before retrying.")

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, username, password_hash, role, student_id, is_active, display_name, email, must_reset_password 
                   FROM users 
                   WHERE LOWER(TRIM(username)) = LOWER(%s) OR (email IS NOT NULL AND LOWER(TRIM(email)) = LOWER(%s))""",
                (body.username.strip(), body.username.strip()),
            )
            user = cur.fetchone()
            if not user:
                raise HTTPException(401, "Invalid username or password")
            if not user.get("is_active", True):
                raise HTTPException(403, "Account is disabled. Please contact administrator.")
            if not password_ok(body.password, user["password_hash"]) and not password_ok(body.password.strip(), user["password_hash"]):
                raise HTTPException(401, "Invalid username or password")

            # Role isolation validation
            user_role_norm = normalize_role(user["role"])
            if body.role:
                req_role_norm = normalize_role(body.role)
                if req_role_norm == "others" and user_role_norm != "others":
                    raise HTTPException(403, "Invalid credentials for visitor login portal.")
                elif req_role_norm != "others" and user_role_norm == "others":
                    raise HTTPException(403, "Visitors cannot log in through the campus staff/student portal.")
                elif req_role_norm in ("admin", "teacher", "faculty", "student") and req_role_norm != user_role_norm:
                    raise HTTPException(403, f"Account does not have {body.role} privileges.")

            cur.execute(
                "INSERT INTO audit_logs (actor_id, action, entity, entity_id) VALUES (%s, 'USER_LOGIN', 'user', %s)",
                (user["id"], str(user["id"])),
            )
        conn.commit()
    finally:
        conn.close()

    client_ip = request.client.host if request.client else "unknown"
    user_agent = request.headers.get("user-agent", "unknown")
    token, sid = create_user_session(user, client_ip=client_ip, user_agent=user_agent)
    return {
        "access_token": token,
        "session_id": sid,
        "user": {
            "id": user["id"],
            "username": user["username"],
            "role": user["role"],
            "student_id": user["student_id"],
            "display_name": user.get("display_name"),
            "email": user.get("email"),
            "must_reset_password": bool(user.get("must_reset_password", False)),
        },
    }

@app.post("/auth/others/login")
def others_login(body: VisitorLoginRequest, request: Request):
    login_req = LoginRequest(username=body.email, password=body.password, role="others")
    return login(login_req, request)

@app.post("/auth/others/register", status_code=201)
@app.post("/visitors/register", status_code=201)
async def register_visitor(request: Request):
    content_type = request.headers.get("content-type", "")
    photo_bytes = None

    if "multipart/form-data" in content_type:
        form = await request.form()
        full_name = str(form.get("full_name") or "")
        email = str(form.get("email") or "")
        phone = str(form.get("phone") or "")
        purpose_of_visit = str(form.get("purpose_of_visit") or "")
        purpose_other = str(form.get("purpose_other") or "") if form.get("purpose_other") else None
        expected_check_in = str(form.get("expected_check_in") or "")
        expected_check_out = str(form.get("expected_check_out") or "")
        identification_type = str(form.get("identification_type") or "")
        identification_number = str(form.get("identification_number") or "")
        password = str(form.get("password") or "")
        confirm_password = str(form.get("confirm_password") or "")

        file_obj = form.get("file") or form.get("photo")
        if file_obj is not None:
            if hasattr(file_obj, "read"):
                raw = await file_obj.read()
                if raw and len(raw) > 0:
                    photo_bytes = raw
            elif isinstance(file_obj, (bytes, bytearray)):
                photo_bytes = bytes(file_obj)
    else:
        try:
            body_dict = await request.json()
        except Exception:
            raise HTTPException(400, "Invalid JSON payload.")

        full_name = str(body_dict.get("full_name") or "")
        email = str(body_dict.get("email") or "")
        phone = str(body_dict.get("phone") or "")
        purpose_of_visit = str(body_dict.get("purpose_of_visit") or "")
        purpose_other = str(body_dict.get("purpose_other") or "") if body_dict.get("purpose_other") else None
        expected_check_in = str(body_dict.get("expected_check_in") or "")
        expected_check_out = str(body_dict.get("expected_check_out") or "")
        identification_type = str(body_dict.get("identification_type") or "")
        identification_number = str(body_dict.get("identification_number") or "")
        password = str(body_dict.get("password") or "")
        confirm_password = str(body_dict.get("confirm_password") or "")

        photo_b64 = body_dict.get("photo_base64")
        if photo_b64 and str(photo_b64).strip():
            try:
                clean_b64 = str(photo_b64).strip()
                if "base64," in clean_b64:
                    clean_b64 = clean_b64.split("base64,")[1]
                photo_bytes = base64.b64decode(clean_b64)
            except Exception as exc:
                logger.warning("Failed to decode visitor photo_base64: %s", exc)

    full_name = full_name.strip()
    if not full_name or len(full_name) < 2:
        raise HTTPException(400, "Full Name is required (minimum 2 characters).")

    email = email.strip().lower()
    if not validate_email_format(email):
        raise HTTPException(400, "Invalid email address format.")

    phone = phone.strip()
    if not phone or len(phone) < 7:
        raise HTTPException(400, "A valid mobile/phone number is required.")

    if purpose_of_visit not in VALID_PURPOSES:
        raise HTTPException(400, f"Invalid purpose of visit. Allowed options: {', '.join(VALID_PURPOSES)}.")

    purpose_other = purpose_other.strip() if purpose_other else None
    if purpose_of_visit == "Other" and not purpose_other:
        raise HTTPException(400, "Please specify the purpose of your visit.")

    try:
        dt_in = datetime.fromisoformat(expected_check_in.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(400, "Expected Check-In must be a valid ISO date/time string.")

    try:
        dt_out = datetime.fromisoformat(expected_check_out.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(400, "Expected Check-Out must be a valid ISO date/time string.")

    if dt_out <= dt_in:
        raise HTTPException(400, "Expected Check-Out time must be after Expected Check-In time.")

    if identification_type not in VALID_ID_TYPES:
        raise HTTPException(400, f"Invalid identification type. Allowed options: {', '.join(VALID_ID_TYPES)}.")

    id_number = identification_number.strip()
    if not id_number or len(id_number) < 3:
        raise HTTPException(400, "A valid identification number is required.")

    if not password or len(password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters long.")
    if password != confirm_password:
        raise HTTPException(400, "Password and confirm password do not match.")

    allowed, _, reset_s = cache_rate_limit(f"reg_visitor:{email}", max_requests=10, window_seconds=120)
    if not allowed:
        raise HTTPException(429, f"Too many registration attempts. Please wait {reset_s} seconds.")

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Check duplicate email
            cur.execute("SELECT id FROM users WHERE LOWER(username) = %s OR LOWER(email) = %s", (email, email))
            if cur.fetchone():
                raise HTTPException(409, "An account with this email address already exists. Please log in.")

            cur.execute("SELECT id FROM visitors WHERE LOWER(email) = %s", (email,))
            if cur.fetchone():
                raise HTTPException(409, "An account with this email address already exists. Please log in.")

            # Server-authoritative fields
            reg_date = datetime.now(timezone.utc)
            visitor_id = generate_visitor_id(cur, reg_date)
            masked_id = mask_identification_number(id_number)
            id_hash = hash_identification_number(id_number)
            pwd_hash = password_hash(password)

            rel_photo_path = None
            thumb = None
            if photo_bytes and len(photo_bytes) > 0:
                if len(photo_bytes) > MAX_IMAGE_BYTES:
                    raise HTTPException(413, "Profile photo is too large (maximum 10MB allowed).")
                try:
                    Image.open(io.BytesIO(photo_bytes)).verify()
                    rel_photo_path, _ = save_student_photo(visitor_id, full_name, photo_bytes)
                    thumb = student_photo_data_uri(photo_bytes)
                except Exception as exc:
                    logger.warning("save_student_photo failed for visitor %s: %s", visitor_id, exc)
                    rel_photo_path = None
                    thumb = None

            # Insert into users (role explicitly 'others') - store file path and thumbnail
            cur.execute(
                """INSERT INTO users (username, password_hash, role, display_name, email, phone, profile_photo, profile_picture, profile_photo_thumbnail)
                   VALUES (%s, %s, 'others', %s, %s, %s, NULL, %s, %s)
                   RETURNING id""",
                (email, pwd_hash, full_name, email, phone, rel_photo_path, thumb),
            )
            user_id = cur.fetchone()["id"]

            # QR payload strictly excludes passwords, tokens, full IDs
            qr_payload = {
                "type": "visitor",
                "visitor_id": visitor_id,
                "full_name": full_name,
                "email": email,
                "phone": phone,
                "purpose_of_visit": purpose_of_visit if purpose_of_visit != "Other" else f"Other: {purpose_other}",
                "expected_check_in": dt_in.isoformat(),
                "expected_check_out": dt_out.isoformat(),
                "registration_date": reg_date.isoformat(),
                "identification_type": identification_type,
                "identification_number_masked": masked_id,
            }

            # Insert into visitors table - store file path and thumbnail
            cur.execute(
                """INSERT INTO visitors (
                       visitor_id, user_id, full_name, email, phone,
                       purpose_of_visit, purpose_other, expected_check_in, expected_check_out,
                       identification_type, identification_number_masked, identification_number_hash,
                       registration_date, status, qr_payload, profile_photo, profile_picture, profile_photo_thumbnail
                   ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'REGISTERED', %s, NULL, %s, %s)
                   RETURNING id""",
                (
                    visitor_id, user_id, full_name, email, phone,
                    purpose_of_visit, purpose_other, dt_in, dt_out,
                    identification_type, masked_id, id_hash,
                    reg_date, json.dumps(qr_payload), rel_photo_path, thumb,
                ),
            )

            cur.execute(
                "INSERT INTO audit_logs (actor_id, action, entity, entity_id) VALUES (%s, 'VISITOR_REGISTER', 'visitor', %s)",
                (user_id, visitor_id),
            )
        conn.commit()
    finally:
        conn.close()

    qr_data_uri = generate_qr_code_data_uri(qr_payload)
    photo_url = f"/student-photos/{Path(rel_photo_path).name}" if rel_photo_path else None

    return {
        "ok": True,
        "message": "Visitor registered successfully.",
        "visitor_id": visitor_id,
        "full_name": full_name,
        "email": email,
        "registration_date": reg_date.isoformat(),
        "qr_payload": qr_payload,
        "qr_data_uri": qr_data_uri,
        "profile_photo_url": photo_url,
        "profile_picture": photo_url,
        "profile_photo_base64": thumb,
    }

@app.get("/visitors/me")
def get_my_visitor_profile(user=Depends(require_roles("others"))):
    user_id = user.get("sub")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT v.id, v.visitor_id, v.user_id, v.full_name, v.email, v.phone,
                          v.purpose_of_visit, v.purpose_other, v.expected_check_in, v.expected_check_out,
                          v.identification_type, v.identification_number_masked, v.registration_date,
                          v.status, v.qr_payload,
                          COALESCE(u.profile_picture, v.profile_picture) AS profile_picture,
                          COALESCE(u.profile_photo_thumbnail, v.profile_photo_thumbnail) AS profile_photo_thumbnail,
                          encode(COALESCE(u.profile_photo, v.profile_photo), 'base64') AS profile_photo_raw_b64
                   FROM visitors v
                   JOIN users u ON u.id = v.user_id
                   WHERE v.user_id = %s""",
                (user_id,),
            )
            v = cur.fetchone()
            if not v:
                raise HTTPException(404, "Visitor profile not found.")

            photo_b64 = v.get("profile_photo_thumbnail")
            if not photo_b64 and v.get("profile_photo_raw_b64"):
                photo_b64 = f"data:image/jpeg;base64,{v['profile_photo_raw_b64']}"

            if not photo_b64 and v.get("profile_picture"):
                disk_path = get_safe_photo_path(v["profile_picture"])
                if disk_path and disk_path.is_file():
                    try:
                        photo_b64 = student_photo_data_uri(disk_path.read_bytes())
                        if photo_b64:
                            cur.execute("UPDATE users SET profile_photo_thumbnail=%s WHERE id=%s", (photo_b64, user_id))
                            cur.execute("UPDATE visitors SET profile_photo_thumbnail=%s WHERE user_id=%s", (photo_b64, user_id))
                            conn.commit()
                    except Exception:
                        pass

            payload = v.get("qr_payload") or build_visitor_qr_payload(v)
            if isinstance(payload, str):
                try: payload = json.loads(payload)
                except Exception: payload = {}
            qr_data_uri = generate_qr_code_data_uri(payload)

            photo_url = None
            if v.get("profile_picture"):
                photo_url = f"/student-photos/{Path(v['profile_picture']).name}"
            elif photo_b64:
                photo_url = f"/users/{user_id}/photo"

            return {
                "visitor_id": v["visitor_id"],
                "full_name": v["full_name"],
                "email": v["email"],
                "phone": v["phone"],
                "purpose_of_visit": v["purpose_of_visit"],
                "purpose_other": v.get("purpose_other"),
                "expected_check_in": v["expected_check_in"].isoformat() if hasattr(v["expected_check_in"], "isoformat") else str(v["expected_check_in"]),
                "expected_check_out": v["expected_check_out"].isoformat() if hasattr(v["expected_check_out"], "isoformat") else str(v["expected_check_out"]),
                "identification_type": v["identification_type"],
                "identification_number_masked": v["identification_number_masked"],
                "registration_date": v["registration_date"].isoformat() if hasattr(v["registration_date"], "isoformat") else str(v["registration_date"]),
                "status": v["status"],
                "qr_payload": payload,
                "qr_data_uri": qr_data_uri,
                "profile_photo_url": photo_url,
                "profile_picture": photo_url,
                "profile_photo_base64": photo_b64,
            }
    finally:
        conn.close()

def get_qr_user_optional(
    authorization: str | None = Header(default=None),
    token: str | None = Query(default=None),
):
    header_val = (authorization or "").strip()
    if not header_val and token:
        token_str = token.strip()
        if token_str and token_str not in ("undefined", "null"):
            header_val = f"Bearer {token_str}" if not token_str.startswith("Bearer ") else token_str
    if not header_val or header_val in ("Bearer undefined", "Bearer null", "Bearer", "undefined", "null"):
        return None
    try:
        return decode_and_validate_token(header_val)
    except ValueError:
        return None

@app.get("/visitors/{visitor_id}/qr")
def download_visitor_qr(visitor_id: str, user=Depends(get_qr_user_optional)):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT user_id, visitor_id, qr_payload, full_name FROM visitors WHERE visitor_id = %s",
                (visitor_id,),
            )
            v = cur.fetchone()
            if not v:
                raise HTTPException(404, "Visitor not found.")

            if user is not None:
                caller_role = normalize_role(user.get("role"))
                if caller_role != "admin" and user.get("sub") != v["user_id"]:
                    raise HTTPException(403, "Access denied: cannot access another visitor's QR code.")

            payload = v.get("qr_payload") or build_visitor_qr_payload(v)
            if isinstance(payload, str):
                try: payload = json.loads(payload)
                except Exception: payload = {}
            png_bytes = generate_qr_code_bytes(payload)
            return Response(
                content=png_bytes,
                media_type="image/png",
                headers={
                    "Content-Disposition": f'attachment; filename="visitor_qr_{visitor_id}.png"',
                    "Cache-Control": "private, max-age=3600",
                },
            )
    finally:
        conn.close()

@app.get("/visitors/{visitor_id}")
def get_visitor_details(visitor_id: str, user=Depends(current_user)):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT v.visitor_id, v.user_id, v.full_name, v.email, v.phone,
                          v.purpose_of_visit, v.purpose_other, v.expected_check_in, v.expected_check_out,
                          v.identification_type, v.identification_number_masked, v.registration_date,
                          v.status, v.qr_payload,
                          COALESCE(u.profile_picture, v.profile_picture) AS profile_picture,
                          (u.profile_photo IS NOT NULL OR v.profile_photo IS NOT NULL) AS has_photo_blob,
                          encode(COALESCE(u.profile_photo, v.profile_photo), 'base64') AS profile_photo_base64
                   FROM visitors v
                   JOIN users u ON u.id = v.user_id
                   WHERE v.visitor_id = %s""",
                (visitor_id,),
            )
            v = cur.fetchone()
            if not v:
                raise HTTPException(404, "Visitor not found.")

            caller_role = normalize_role(user.get("role"))
            if caller_role != "admin" and user.get("sub") != v["user_id"]:
                raise HTTPException(403, "Access denied: cannot view another visitor's profile.")

            payload = v.get("qr_payload") or build_visitor_qr_payload(v)
            if isinstance(payload, str):
                try: payload = json.loads(payload)
                except Exception: payload = {}
            qr_data_uri = generate_qr_code_data_uri(payload)

            photo_url = None
            if v.get("profile_picture"):
                photo_url = f"/student-photos/{Path(v['profile_picture']).name}"
            elif v.get("has_photo_blob"):
                photo_url = f"/users/{v['user_id']}/photo"

            return {
                "visitor_id": v["visitor_id"],
                "full_name": v["full_name"],
                "email": v["email"],
                "phone": v["phone"],
                "purpose_of_visit": v["purpose_of_visit"],
                "purpose_other": v.get("purpose_other"),
                "expected_check_in": v["expected_check_in"].isoformat() if hasattr(v["expected_check_in"], "isoformat") else str(v["expected_check_in"]),
                "expected_check_out": v["expected_check_out"].isoformat() if hasattr(v["expected_check_out"], "isoformat") else str(v["expected_check_out"]),
                "identification_type": v["identification_type"],
                "identification_number_masked": v["identification_number_masked"],
                "registration_date": v["registration_date"].isoformat() if hasattr(v["registration_date"], "isoformat") else str(v["registration_date"]),
                "status": v["status"],
                "qr_payload": payload,
                "qr_data_uri": qr_data_uri,
                "profile_photo_url": photo_url,
                "profile_photo_base64": f"data:image/jpeg;base64,{v['profile_photo_base64']}" if v.get("profile_photo_base64") else None,
            }
    finally:
        conn.close()

@app.post("/auth/logout")
def logout(user=Depends(current_user)):
    sid = user.get("sid")
    if sid:
        revoke_user_session(sid, user_id=user.get("sub"))
    return {"ok": True, "message": "Logged out successfully"}

@app.post("/auth/logout-all")
def logout_all(user=Depends(current_user)):
    user_id = user.get("sub")
    count = revoke_all_user_sessions(user_id) if user_id else 0
    return {"ok": True, "revoked_count": count, "message": "All sessions revoked successfully"}

@app.get("/auth/sessions")
def get_active_sessions(user=Depends(current_user)):
    user_id = user.get("sub")
    current_sid = user.get("sid")
    sessions = list_user_sessions(user_id, current_sid=current_sid) if user_id else []
    return {"sessions": sessions}

@app.delete("/auth/sessions/{session_id}")
def revoke_session_by_id(session_id: str, user=Depends(current_user)):
    user_id = user.get("sub")
    target_session = get_user_session(session_id)
    if target_session and target_session.get("user_id") != user_id and user.get("role") != "admin":
        raise HTTPException(403, "Cannot revoke session belonging to another user")
    revoked = revoke_user_session(session_id, user_id=user_id)
    return {"ok": True, "revoked": revoked}

# ===========================================================================
# QR CODE IDENTITY & MUTUAL CONNECTIONS SYSTEM
# ===========================================================================

class ConnectRequest(BaseModel):
    target_qr_id: str | None = None
    target_user_id: int | None = None

class VerifyQRRequest(BaseModel):
    qr_data: str

def get_user_full_identity(user_id: int, cur) -> dict | None:
    cur.execute("""
        SELECT u.id, u.username, u.role, u.student_id, u.qr_code_id,
               COALESCE(u.display_name, s.name, v.full_name, u.username) AS display_name,
               COALESCE(u.email, s.email, v.email) AS email,
               COALESCE(u.phone, s.phone, v.phone) AS phone,
               s.roll_number, s.program, s.department AS student_department,
               sec.department AS section_department, sec.faculty AS section_faculty,
               sec.semester AS academic_semester,
               v.visitor_id, v.purpose_of_visit,
               COALESCE(s.profile_picture, u.profile_picture, v.profile_picture) AS profile_picture,
               (u.profile_photo IS NOT NULL OR s.profile_photo IS NOT NULL OR v.profile_photo IS NOT NULL) AS has_photo_blob
        FROM users u
        LEFT JOIN students s ON s.student_id = u.student_id
        LEFT JOIN academic_sections sec ON sec.id = s.section_id
        LEFT JOIN visitors v ON v.user_id = u.id
        WHERE u.id = %s
    """, (user_id,))
    row = cur.fetchone()
    if not row:
        return None

    role = normalize_role(row["role"])
    identifier = ""
    department_info = ""
    if role == "student":
        identifier = row["roll_number"] or row["student_id"] or row["username"]
        department_info = row["student_department"] or row["section_department"] or row["program"] or "Student"
    elif role in ("teacher", "faculty"):
        identifier = row["username"]
        department_info = row["section_faculty"] or "Faculty Member"
    elif role in ("others", "other"):
        identifier = row["visitor_id"] or row["email"]
        department_info = row["purpose_of_visit"] or "Visitor"
    else:
        identifier = row["username"]
        department_info = "System Administration"

    photo_url = None
    if row["profile_picture"]:
        photo_url = f"/student-photos/{Path(row['profile_picture']).name}"
    elif row["has_photo_blob"]:
        photo_url = f"/users/{row['id']}/photo"

    return {
        "user_id": row["id"],
        "qr_id": str(row["qr_code_id"]) if row.get("qr_code_id") else "",
        "username": row["username"],
        "display_name": row["display_name"],
        "role": role,
        "identifier": identifier,
        "department": department_info,
        "email": row["email"],
        "profile_photo_url": photo_url,
    }

@app.get("/connections/my-qr")
def get_my_qr(user=Depends(current_user)):
    user_id = user["sub"]
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT qr_code_id FROM users WHERE id=%s", (user_id,))
            u_row = cur.fetchone()
            if not u_row or not u_row.get("qr_code_id"):
                new_qr_id = str(uuid.uuid4())
                cur.execute("UPDATE users SET qr_code_id=%s WHERE id=%s", (new_qr_id, user_id))
                conn.commit()

            ident = get_user_full_identity(user_id, cur)
            if not ident:
                raise HTTPException(404, "User profile not found")

            payload = {
                "type": "pratyaksh_connect",
                "version": "1.0",
                "qr_id": ident["qr_id"],
                "uid": ident["user_id"],
                "role": ident["role"],
                "name": ident["display_name"],
                "id": ident["identifier"],
            }
            qr_data_uri = generate_qr_code_data_uri(payload)

            return {
                "user_id": ident["user_id"],
                "qr_id": ident["qr_id"],
                "display_name": ident["display_name"],
                "role": ident["role"],
                "identifier": ident["identifier"],
                "department": ident["department"],
                "profile_photo_url": ident["profile_photo_url"],
                "qr_payload": payload,
                "qr_data_uri": qr_data_uri,
            }
    finally:
        conn.close()

@app.post("/connections/verify-qr")
def verify_qr(body: VerifyQRRequest, user=Depends(current_user)):
    current_uid = user["sub"]
    raw = (body.qr_data or "").strip()
    if not raw:
        raise HTTPException(400, "Empty QR data")

    qr_id = None
    target_uid = None
    lookup_id = None

    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            qr_id = parsed.get("qr_id")
            target_uid = parsed.get("uid") or parsed.get("user_id")
            if not qr_id and parsed.get("visitor_id"):
                lookup_id = parsed.get("visitor_id")
    except Exception:
        cleaned_uuid = raw.strip().replace('"', "").replace("'", "")
        try:
            uuid.UUID(cleaned_uuid)
            qr_id = cleaned_uuid
        except Exception:
            lookup_id = cleaned_uuid

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            target_user_id = None
            if qr_id:
                cur.execute("SELECT id FROM users WHERE qr_code_id::text = %s", (str(qr_id),))
                u = cur.fetchone()
                if u:
                    target_user_id = u["id"]

            if not target_user_id and target_uid:
                try:
                    cur.execute("SELECT id FROM users WHERE id = %s", (int(target_uid),))
                    u = cur.fetchone()
                    if u:
                        target_user_id = u["id"]
                except Exception:
                    pass

            if not target_user_id and lookup_id:
                cur.execute("SELECT user_id FROM visitors WHERE visitor_id = %s", (lookup_id,))
                v = cur.fetchone()
                if v and v.get("user_id"):
                    target_user_id = v["user_id"]
                else:
                    cur.execute("SELECT id FROM users WHERE student_id = %s OR username = %s", (lookup_id, lookup_id))
                    u = cur.fetchone()
                    if u:
                        target_user_id = u["id"]

            if not target_user_id:
                raise HTTPException(404, "Invalid or unrecognized QR code. No matching user found.")

            target_ident = get_user_full_identity(target_user_id, cur)
            if not target_ident:
                raise HTTPException(404, "Target user profile not found.")

            is_self = (current_uid == target_user_id)

            cur.execute("""
                SELECT 1 FROM user_connections
                WHERE (user_id_1 = %s AND user_id_2 = %s)
                   OR (user_id_1 = %s AND user_id_2 = %s)
            """, (current_uid, target_user_id, target_user_id, current_uid))
            is_connected = bool(cur.fetchone())

            return {
                "status": "ok",
                "target_user": {
                    **target_ident,
                    "is_self": is_self,
                    "is_connected": is_connected,
                }
            }
    finally:
        conn.close()

@app.post("/connections/connect")
def create_connection(body: ConnectRequest, user=Depends(current_user)):
    current_uid = user["sub"]
    target_uid = body.target_user_id
    target_qr = body.target_qr_id

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            if not target_uid and target_qr:
                cur.execute("SELECT id FROM users WHERE qr_code_id::text = %s", (str(target_qr),))
                u = cur.fetchone()
                if u:
                    target_uid = u["id"]

            if not target_uid:
                raise HTTPException(400, "Target user not specified or invalid")

            if current_uid == target_uid:
                raise HTTPException(400, "You cannot establish a connection with yourself.")

            cur.execute("SELECT id, is_active FROM users WHERE id=%s", (target_uid,))
            target = cur.fetchone()
            if not target:
                raise HTTPException(404, "Target user not found")
            if target.get("is_active") is False:
                raise HTTPException(400, "Target user account is inactive")

            u1, u2 = min(current_uid, target_uid), max(current_uid, target_uid)
            cur.execute("""
                SELECT id, connected_at FROM user_connections
                WHERE user_id_1 = %s AND user_id_2 = %s
            """, (u1, u2))
            existing = cur.fetchone()
            if existing:
                target_ident = get_user_full_identity(target_uid, cur)
                return {
                    "status": "already_connected",
                    "message": "You are already connected to this user.",
                    "target_user": target_ident,
                }

            cur.execute("""
                INSERT INTO user_connections (user_id_1, user_id_2)
                VALUES (%s, %s)
                RETURNING id, connected_at
            """, (u1, u2))
            row = cur.fetchone()
            conn.commit()

            cache_delete(f"user:{current_uid}:connections", f"user:{target_uid}:connections")
            target_ident = get_user_full_identity(target_uid, cur)

            return {
                "status": "connected",
                "message": f"Successfully connected with {target_ident['display_name']}!",
                "connection_id": row["id"],
                "connected_at": row["connected_at"].isoformat() if hasattr(row["connected_at"], "isoformat") else str(row["connected_at"]),
                "target_user": target_ident,
            }
    finally:
        conn.close()

@app.get("/connections")
def list_connections(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    q: str | None = Query(default=None),
    user=Depends(current_user),
):
    current_uid = user["sub"]
    offset = (page - 1) * limit
    q_clean = f"%{q.strip().lower()}%" if q and q.strip() else None

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            where_clauses = ["(c.user_id_1 = %(uid)s OR c.user_id_2 = %(uid)s)"]
            params: dict[str, Any] = {"uid": current_uid, "limit": limit, "offset": offset}

            if q_clean:
                where_clauses.append("""
                    (LOWER(COALESCE(u.display_name, s.name, v.full_name, u.username)) LIKE %(q)s
                     OR LOWER(u.username) LIKE %(q)s
                     OR LOWER(COALESCE(s.roll_number, s.student_id, v.visitor_id, '')) LIKE %(q)s
                     OR LOWER(u.role) LIKE %(q)s)
                """)
                params["q"] = q_clean

            where_str = " AND ".join(where_clauses)

            count_query = f"""
                SELECT COUNT(*) AS total
                FROM user_connections c
                JOIN users u ON u.id = CASE WHEN c.user_id_1 = %(uid)s THEN c.user_id_2 ELSE c.user_id_1 END
                LEFT JOIN students s ON s.student_id = u.student_id
                LEFT JOIN visitors v ON v.user_id = u.id
                WHERE {where_str}
            """
            cur.execute(count_query, params)
            total_count = cur.fetchone()["total"]

            data_query = f"""
                SELECT c.id AS connection_id, c.connected_at,
                       u.id AS target_user_id, u.username, u.role, u.student_id, u.qr_code_id,
                       COALESCE(u.display_name, s.name, v.full_name, u.username) AS display_name,
                       COALESCE(u.email, s.email, v.email) AS email,
                       COALESCE(u.phone, s.phone, v.phone) AS phone,
                       s.roll_number, s.program, s.department AS student_department,
                       sec.department AS section_department, sec.faculty AS section_faculty,
                       v.visitor_id, v.purpose_of_visit,
                       COALESCE(s.profile_picture, u.profile_picture, v.profile_picture) AS profile_picture,
                       (u.profile_photo IS NOT NULL OR s.profile_photo IS NOT NULL OR v.profile_photo IS NOT NULL) AS has_photo_blob
                FROM user_connections c
                JOIN users u ON u.id = CASE WHEN c.user_id_1 = %(uid)s THEN c.user_id_2 ELSE c.user_id_1 END
                LEFT JOIN students s ON s.student_id = u.student_id
                LEFT JOIN academic_sections sec ON sec.id = s.section_id
                LEFT JOIN visitors v ON v.user_id = u.id
                WHERE {where_str}
                ORDER BY c.connected_at DESC
                LIMIT %(limit)s OFFSET %(offset)s
            """
            cur.execute(data_query, params)
            rows = cur.fetchall()

            connections = []
            for r in rows:
                role = normalize_role(r["role"])
                identifier = ""
                department_info = ""
                if role == "student":
                    identifier = r["roll_number"] or r["student_id"] or r["username"]
                    department_info = r["student_department"] or r["section_department"] or r["program"] or "Student"
                elif role in ("teacher", "faculty"):
                    identifier = r["username"]
                    department_info = r["section_faculty"] or "Faculty Member"
                elif role in ("others", "other"):
                    identifier = r["visitor_id"] or r["email"]
                    department_info = r["purpose_of_visit"] or "Visitor"
                else:
                    identifier = r["username"]
                    department_info = "System Administration"

                photo_url = None
                if r["profile_picture"]:
                    photo_url = f"/student-photos/{Path(r['profile_picture']).name}"
                elif r["has_photo_blob"]:
                    photo_url = f"/users/{r['target_user_id']}/photo"

                connections.append({
                    "connection_id": r["connection_id"],
                    "user_id": r["target_user_id"],
                    "qr_id": str(r["qr_code_id"]) if r.get("qr_code_id") else "",
                    "display_name": r["display_name"],
                    "role": role,
                    "identifier": identifier,
                    "department": department_info,
                    "profile_photo_url": photo_url,
                    "connected_at": r["connected_at"].isoformat() if hasattr(r["connected_at"], "isoformat") else str(r["connected_at"]),
                })

            return {
                "total_connections": total_count,
                "page": page,
                "limit": limit,
                "connections": connections,
            }
    finally:
        conn.close()

@app.delete("/connections/{target_user_id}")
def remove_connection(target_user_id: int, user=Depends(current_user)):
    current_uid = user["sub"]
    u1, u2 = min(current_uid, target_user_id), max(current_uid, target_user_id)
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM user_connections WHERE user_id_1 = %s AND user_id_2 = %s RETURNING id", (u1, u2))
            deleted = cur.fetchone()
            conn.commit()
            cache_delete(f"user:{current_uid}:connections", f"user:{target_user_id}:connections")
            return {"ok": bool(deleted), "message": "Connection removed"}
    finally:
        conn.close()

@app.get("/users/{target_user_id}/photo")
def get_user_photo(
    target_user_id: int,
    user=Depends(get_photo_user),
):
    current_uid = user.get("sub")
    caller_role = normalize_role(user.get("role"))
    is_authorized = (current_uid == target_user_id) or (caller_role in ("admin", "teacher", "faculty"))

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            if not is_authorized:
                u1, u2 = min(current_uid, target_user_id), max(current_uid, target_user_id)
                cur.execute("SELECT 1 FROM user_connections WHERE user_id_1 = %s AND user_id_2 = %s", (u1, u2))
                if cur.fetchone():
                    is_authorized = True

            if not is_authorized:
                raise HTTPException(403, "Access denied: you must be connected with this user to view their profile photo")

            cur.execute("""
                SELECT u.profile_picture AS user_pic, u.profile_photo AS user_blob,
                       s.profile_picture AS stu_pic, s.profile_photo AS stu_blob,
                       v.profile_picture AS vis_pic, v.profile_photo AS vis_blob
                FROM users u
                LEFT JOIN students s ON s.student_id = u.student_id
                LEFT JOIN visitors v ON v.user_id = u.id
                WHERE u.id = %s
            """, (target_user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "User not found")

            pic_path = row["stu_pic"] or row["user_pic"] or row["vis_pic"]
            if pic_path:
                safe_path = get_safe_photo_path(Path(pic_path).name)
                if safe_path and safe_path.exists() and safe_path.is_file():
                    ext = safe_path.suffix.lower()
                    media_type = "image/png" if ext == ".png" else "image/jpeg"
                    return FileResponse(path=safe_path, media_type=media_type)

            blob = row["stu_blob"] or row["user_blob"] or row["vis_blob"]
            if blob:
                data = bytes(blob)
                return Response(content=data, media_type="image/jpeg")

            raise HTTPException(404, "Profile photo not found")
    finally:
        conn.close()

@app.get("/auth/me")
def me(user=Depends(current_user)):
    cache_key = f"user:{user['sub']}:me"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT display_name, email, phone, must_reset_password FROM users WHERE id=%s", (user["sub"],))
            profile = cur.fetchone() or {}
            res = {**user, **profile, "must_reset_password": bool(profile.get("must_reset_password", False))}
            cache_set(cache_key, res, ttl=120)
            return res
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
        cache_delete(f"user:{user['sub']}:me", f"user:{user['sub']}:profile", f"teacher:{user['sub']}:profile")
        cache_delete_pattern("students:list:*")
        return {"profile": profile}
    finally: conn.close()

@app.get("/auth/profile")
def get_profile(user=Depends(current_user)):
    cache_key = f"user:{user['sub']}:profile"
    cached = cache_get(cache_key)
    if cached is not None:
        return {"profile": cached}
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""SELECT u.username, u.role, u.student_id, u.must_reset_password, COALESCE(u.display_name,s.name) AS display_name,
                COALESCE(u.email,s.email) AS email, COALESCE(u.phone,s.phone) AS phone,
                s.name, s.date_of_birth, s.program, s.roll_number, s.section_id,
                s.semester, s.department, s.gpa, s.enrollment_year,
                sec.school AS academic_school, sec.faculty AS academic_faculty,
                sec.department AS academic_department, sec.semester AS academic_semester,
                sec.section AS academic_section,
                EXISTS (SELECT 1 FROM student_embeddings e WHERE e.student_id=s.student_id) AS face_registered,
                COALESCE(u.profile_picture, s.profile_picture) AS profile_picture,
                COALESCE(u.profile_photo_thumbnail, s.profile_photo_thumbnail) AS profile_photo_thumbnail,
                encode(COALESCE(u.profile_photo, s.profile_photo), 'base64') AS profile_photo_raw_b64
                FROM users u LEFT JOIN students s ON s.student_id=u.student_id
                LEFT JOIN academic_sections sec ON sec.id=s.section_id
                WHERE u.id=%s""", (user["sub"],))
            profile = cur.fetchone()
            if not profile: raise HTTPException(404, "User not found")

            photo_b64 = profile.get("profile_photo_thumbnail")
            if not photo_b64 and profile.get("profile_photo_raw_b64"):
                photo_b64 = f"data:image/jpeg;base64,{profile['profile_photo_raw_b64']}"

            if not photo_b64 and profile.get("profile_picture"):
                disk_path = get_safe_photo_path(profile["profile_picture"])
                if disk_path and disk_path.is_file():
                    try:
                        photo_b64 = student_photo_data_uri(disk_path.read_bytes())
                        if photo_b64:
                            cur.execute("UPDATE users SET profile_photo_thumbnail=%s WHERE id=%s", (photo_b64, user["sub"]))
                            if profile.get("student_id"):
                                cur.execute("UPDATE students SET profile_photo_thumbnail=%s WHERE student_id=%s", (photo_b64, profile["student_id"]))
                            conn.commit()
                    except Exception:
                        pass

            profile["profile_photo_base64"] = photo_b64
            if profile.get("profile_picture"):
                profile["profile_photo_url"] = f"/student-photos/{Path(profile['profile_picture']).name}"
                profile["profile_picture"] = f"/student-photos/{Path(profile['profile_picture']).name}"
            profile["must_reset_password"] = bool(profile.get("must_reset_password", False))
            profile.pop("profile_photo_raw_b64", None)
            cache_set(cache_key, profile, ttl=120)
            return {"profile": profile}
    finally: conn.close()

@app.post("/auth/reset-password")
def reset_password(
    body: ResetPasswordRequest,
    authorization: str | None = Header(default=None),
):
    user_id = None
    if authorization and authorization.startswith("Bearer "):
        try:
            token_payload = decode_and_validate_token(authorization)
            user_id = token_payload.get("sub")
        except ValueError:
            pass

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            if user_id:
                cur.execute(
                    "SELECT id, username, password_hash, role, student_id, display_name, email, must_reset_password FROM users WHERE id=%s",
                    (user_id,)
                )
            elif body.username:
                uname = body.username.strip()
                cur.execute(
                    "SELECT id, username, password_hash, role, student_id, display_name, email, must_reset_password FROM users WHERE LOWER(TRIM(username))=LOWER(%s) OR (email IS NOT NULL AND LOWER(TRIM(email))=LOWER(%s))",
                    (uname, uname)
                )
            else:
                raise HTTPException(401, "Authentication session required or valid username must be provided.")

            user_record = cur.fetchone()
            if not user_record:
                raise HTTPException(404, "User account not found.")

            cur_pass = body.current_password or ""
            if not password_ok(cur_pass, user_record["password_hash"]) and not password_ok(cur_pass.strip(), user_record["password_hash"]):
                raise HTTPException(400, "Current password is incorrect.")

            new_pass = body.new_password.strip()
            if len(new_pass) < 6:
                raise HTTPException(422, "New password must be at least 6 characters long.")

            if body.new_password != body.confirm_password:
                raise HTTPException(422, "New password and confirm password do not match.")

            if new_pass == DEFAULT_STUDENT_PASSWORD:
                raise HTTPException(422, f"New password cannot be the default institutional password ({DEFAULT_STUDENT_PASSWORD}). Please create a personalized password.")

            if new_pass == cur_pass.strip():
                raise HTTPException(422, "New password must be different from your current password.")

            new_hash = password_hash(new_pass)
            cur.execute(
                "UPDATE users SET password_hash=%s, must_reset_password=FALSE WHERE id=%s RETURNING id, username, role, student_id, display_name, email, must_reset_password",
                (new_hash, user_record["id"])
            )
            updated_user = cur.fetchone()
            cur.execute(
                "INSERT INTO audit_logs (actor_id, action, entity, entity_id) VALUES (%s, 'PASSWORD_RESET', 'user', %s)",
                (user_record["id"], str(user_record["id"]))
            )
        conn.commit()

        cache_delete(f"user:{user_record['id']}:me", f"user:{user_record['id']}:profile", f"teacher:{user_record['id']}:profile")
        return {
            "status": "success",
            "message": "Password updated successfully. You can now access your account.",
            "must_reset_password": False,
            "user": {
                "id": updated_user["id"],
                "username": updated_user["username"],
                "role": updated_user["role"],
                "student_id": updated_user["student_id"],
                "display_name": updated_user["display_name"],
                "email": updated_user["email"],
                "must_reset_password": False,
            }
        }
    finally:
        conn.close()

@app.get("/teacher/profile")
def teacher_profile(user=Depends(require_roles("teacher"))):
    cache_key = f"teacher:{user['sub']}:profile"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""SELECT username, role, display_name, email, phone, profile_picture,
                           profile_photo_thumbnail,
                           encode(profile_photo, 'base64') AS profile_photo_raw_b64
                           FROM users WHERE id=%s""", (user["sub"],))
            profile = cur.fetchone()
            if not profile: raise HTTPException(404, "Teacher not found")

            photo_b64 = profile.get("profile_photo_thumbnail")
            if not photo_b64 and profile.get("profile_photo_raw_b64"):
                photo_b64 = f"data:image/jpeg;base64,{profile['profile_photo_raw_b64']}"

            if not photo_b64 and profile.get("profile_picture"):
                disk_path = get_safe_photo_path(profile["profile_picture"])
                if disk_path and disk_path.is_file():
                    try:
                        photo_b64 = student_photo_data_uri(disk_path.read_bytes())
                        if photo_b64:
                            cur.execute("UPDATE users SET profile_photo_thumbnail=%s WHERE id=%s", (photo_b64, user["sub"]))
                            conn.commit()
                    except Exception:
                        pass

            profile["profile_photo_base64"] = photo_b64
            if profile.get("profile_picture"):
                profile["profile_photo_url"] = f"/student-photos/{Path(profile['profile_picture']).name}"
                profile["profile_picture"] = f"/student-photos/{Path(profile['profile_picture']).name}"
            profile.pop("profile_photo_raw_b64", None)
            cur.execute("""SELECT ta.subject, sec.program, sec.section, sec.semester, COUNT(s.student_id) AS students
                FROM teacher_assignments ta JOIN academic_sections sec ON sec.id=ta.section_id
                LEFT JOIN students s ON s.section_id=sec.id
                WHERE ta.teacher_user_id=%s GROUP BY ta.subject, sec.program, sec.section, sec.semester ORDER BY ta.subject""", (user["sub"],))
            assignments = cur.fetchall()
            res = {"profile": profile, "assignments": assignments}
            cache_set(cache_key, res, ttl=120)
            return res
    finally: conn.close()

@app.post("/auth/profile/photo")
async def update_profile_photo(
    request: Request,
    file: UploadFile | None = File(default=None),
    user=Depends(current_user),
):
    data = None
    if file and hasattr(file, "read"):
        data = await file.read()

    if not data:
        content_type = request.headers.get("content-type", "").lower()
        if "multipart/form-data" in content_type or "application/x-www-form-urlencoded" in content_type:
            try:
                form = await request.form()
                file_obj = form.get("file") or form.get("photo") or form.get("image")
                if file_obj is not None:
                    if hasattr(file_obj, "read"):
                        data = await file_obj.read()
                    elif isinstance(file_obj, (bytes, bytearray)):
                        data = bytes(file_obj)
                    elif isinstance(file_obj, str) and file_obj.strip():
                        clean = file_obj.split("base64,")[-1]
                        data = base64.b64decode(clean)
            except Exception as form_exc:
                logger.warning("Failed to parse form in update_profile_photo: %s", form_exc)

    if not data:
        try:
            body = await request.json()
            if isinstance(body, dict):
                raw_b64 = body.get("photo") or body.get("photo_base64") or body.get("file") or body.get("image")
                if raw_b64 and isinstance(raw_b64, str):
                    clean = raw_b64.split("base64,")[-1]
                    data = base64.b64decode(clean)
        except Exception:
            pass

    if not data:
        content_type = request.headers.get("content-type", "").lower()
        if any(img_t in content_type for img_t in ("image/jpeg", "image/png", "image/webp")):
            data = await request.body()

    if not data or len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Profile photo is empty or too large")

    try:
        Image.open(io.BytesIO(data)).verify()
    except Exception as exc:
        raise HTTPException(400, "Invalid profile image") from exc

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT username, student_id, display_name FROM users WHERE id=%s", (user["sub"],))
            u_info = cur.fetchone()
            if not u_info:
                raise HTTPException(404, "User not found")

            target_id = u_info.get("student_id") or str(user["sub"])
            target_name = u_info.get("display_name") or u_info.get("username")
            rel_photo_path = None
            try:
                rel_photo_path, _ = save_student_photo(target_id, target_name, data)
            except Exception as exc:
                logger.warning("save_student_photo failed in update_profile_photo: %s", exc)

            thumb = student_photo_data_uri(data)
            if rel_photo_path:
                cur.execute("UPDATE users SET profile_photo=NULL, profile_picture=%s, profile_photo_thumbnail=%s WHERE id=%s", (rel_photo_path, thumb, user["sub"]))
                if u_info.get("student_id"):
                    cur.execute("UPDATE students SET profile_photo=NULL, profile_picture=%s, profile_photo_thumbnail=%s WHERE student_id=%s", (rel_photo_path, thumb, u_info["student_id"]))
                cur.execute("UPDATE visitors SET profile_photo=NULL, profile_picture=%s, profile_photo_thumbnail=%s WHERE user_id=%s", (rel_photo_path, thumb, user["sub"]))
            else:
                cur.execute("UPDATE users SET profile_photo=%s, profile_photo_thumbnail=%s WHERE id=%s", (data, thumb, user["sub"]))
                if u_info.get("student_id"):
                    cur.execute("UPDATE students SET profile_photo=%s, profile_photo_thumbnail=%s WHERE student_id=%s", (data, thumb, u_info["student_id"]))
                cur.execute("UPDATE visitors SET profile_photo=%s, profile_photo_thumbnail=%s WHERE user_id=%s", (data, thumb, user["sub"]))
        conn.commit()
        cache_delete(f"user:{user['sub']}:me", f"user:{user['sub']}:profile", f"teacher:{user['sub']}:profile")
        if u_info.get("student_id"):
            cache_delete_pattern(f"student:{u_info['student_id']}:*")
        cache_delete_pattern("students:list:*")
        photo_url = f"/student-photos/{Path(rel_photo_path).name}" if rel_photo_path else None
        return {
            "status": "saved",
            "profile_picture": photo_url,
            "profile_photo_url": photo_url,
            "profile_photo_base64": thumb,
        }
    finally:
        conn.close()

@app.get("/schedule")
def schedule(_=Depends(current_user)):
    cached = cache_get("schedules:all")
    if cached is not None:
        return {"schedule": cached}
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, subject, teacher, room, starts_at, ends_at, day FROM schedules ORDER BY day, starts_at, subject")
            rows = cur.fetchall()
            cache_set("schedules:all", rows, ttl=300)
            return {"schedule": rows}
    finally: conn.close()

@app.post("/admin/schedule")
def create_schedule(body: ScheduleRequest, _=Depends(require_roles("admin"))):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO schedules (subject, teacher, room, starts_at, ends_at, day) VALUES (%s,%s,%s,%s,%s,%s) RETURNING id, subject, teacher, room, starts_at, ends_at, day", (body.subject.strip(), body.teacher.strip(), body.room.strip(), body.starts_at.strip(), body.ends_at.strip(), body.day.strip()))
            result = cur.fetchone()
        conn.commit()
        cache_delete("schedules:all")
        return result
    finally: conn.close()

@app.delete("/admin/schedule/{schedule_id}")
def delete_schedule(schedule_id: int, _=Depends(require_roles("admin"))):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur: cur.execute("DELETE FROM schedules WHERE id=%s RETURNING id", (schedule_id,)); result = cur.fetchone()
        if not result: raise HTTPException(404, "Schedule entry not found")
        conn.commit()
        cache_delete("schedules:all")
        return {"deleted": schedule_id}
    finally: conn.close()

@app.get("/notifications")
def notifications(user=Depends(current_user)):
    cache_key = f"notifications:user:{user['sub']}"
    cached = cache_get(cache_key)
    if cached is not None:
        return {"notifications": cached}
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, category, title, body, is_read, created_at FROM notifications WHERE user_id=%s ORDER BY created_at DESC LIMIT 100", (user["sub"],))
            rows = cur.fetchall()
            cache_set(cache_key, rows, ttl=30)
            return {"notifications": rows}
    finally: conn.close()

@app.post("/notifications/{notification_id}/read")
def mark_notification_read(notification_id: int, user=Depends(current_user)):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur: cur.execute("UPDATE notifications SET is_read=TRUE WHERE id=%s AND user_id=%s RETURNING id", (notification_id, user["sub"])); result = cur.fetchone()
        if not result: raise HTTPException(404, "Notification not found")
        conn.commit()
        cache_delete(f"notifications:user:{user['sub']}")
        return {"id": notification_id, "is_read": True}
    finally: conn.close()

@app.post("/notifications/read-all")
def mark_all_notifications_read(user=Depends(current_user)):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE notifications SET is_read=TRUE WHERE user_id=%s", (user["sub"],))
            count = cur.rowcount
        conn.commit()
        cache_delete(f"notifications:user:{user['sub']}")
        return {"updated": count}
    finally: conn.close()

@app.post("/admin/notifications")
def create_notification(body: NotificationRequest, _=Depends(require_roles("admin"))):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur: cur.execute("INSERT INTO notifications (user_id, category, title, body) VALUES (%s,%s,%s,%s) RETURNING id, category, title, body, is_read, created_at", (body.user_id, body.category.strip(), body.title.strip(), body.body.strip())); result = cur.fetchone()
        conn.commit()
        cache_delete(f"notifications:user:{body.user_id}")
        return result
    finally: conn.close()

@app.post("/admin/users")
def create_user(body: UserRequest, _=Depends(require_roles("admin"))):
    if body.role not in ("admin", "teacher", "student"): raise HTTPException(422, "Invalid role")
    if body.role == "student":
        if not body.student_id or not body.name: raise HTTPException(422, "Student ID and full name are required")
        body.username = body.student_id.strip()
        body.password = DEFAULT_STUDENT_PASSWORD
    if len(body.username.strip()) < 3 or len(body.password) < 4: raise HTTPException(422, "ID must be at least 3 characters and password must be valid")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            try:
                if body.role == "student":
                    cur.execute("INSERT INTO students (student_id,name,email,phone,date_of_birth,program,section_id,roll_number) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (student_id) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,phone=EXCLUDED.phone,date_of_birth=EXCLUDED.date_of_birth,program=EXCLUDED.program,section_id=EXCLUDED.section_id,roll_number=EXCLUDED.roll_number", (body.student_id.strip(), body.name.strip(), body.email, body.phone, body.date_of_birth or None, body.program, body.section_id, body.roll_number))
                cur.execute("INSERT INTO users (username,password_hash,role,student_id,display_name,email,phone,must_reset_password) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id,username,role,student_id,must_reset_password", (body.username.strip(), password_hash(body.password), body.role, body.student_id, body.name if body.role == "student" else None, body.email, body.phone, True if body.role == "student" else False)); result = cur.fetchone()
                if body.role == "teacher" and body.academic_section_ids:
                    cur.executemany("INSERT INTO teacher_assignments (teacher_user_id,section_id,subject) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING", [(result["id"], section_id, "Assigned academic course") for section_id in body.academic_section_ids])
            except Exception as exc: conn.rollback(); raise HTTPException(409, "Username already exists or student ID is invalid") from exc
        conn.commit()
        cache_delete("admin:users:all", "admin:dashboard:summary")
        cache_delete_pattern("admin:users:*")
        cache_delete("admin:dashboard:summary")
        if body.role == "student":
            cache_delete_pattern("students:list:*")
        elif body.role == "teacher":
            cache_delete_pattern("teacher:*:profile")
        return {"user": result}
    finally: conn.close()

@app.get("/admin/users")
def list_users(_=Depends(require_roles("admin"))):
    cached = cache_get("admin:users:all")
    if cached is not None:
        return {"users": cached}
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, username, role, student_id, display_name, email, phone, is_active, must_reset_password, created_at
                   FROM users
                   ORDER BY id"""
            )
            rows = cur.fetchall()
            cache_set("admin:users:all", rows, ttl=120)
            return {"users": rows}
    finally:
        conn.close()

@app.delete("/admin/users/{user_id}")
@app.delete("/admin/teachers/{user_id}")
def delete_user(user_id: str, _=Depends(require_roles("admin"))):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            found = None
            if str(user_id).isdigit():
                cur.execute("SELECT id, username, display_name, role FROM users WHERE id=%s", (int(user_id),))
                found = cur.fetchone()
            if not found:
                cur.execute("SELECT id, username, display_name, role FROM users WHERE username=%s", (str(user_id),))
                found = cur.fetchone()
            if not found:
                raise HTTPException(404, "User not found")

            uid = found["id"]
            # Clean up teacher assignments and linkages
            cur.execute("DELETE FROM teacher_assignments WHERE teacher_user_id=%s", (uid,))
            cur.execute("UPDATE attendance_sessions SET teacher_id=NULL WHERE teacher_id=%s", (uid,))
            cur.execute("UPDATE attendance_logs SET teacher_id=NULL WHERE teacher_id=%s", (uid,))
            cur.execute("UPDATE attendance_logs SET updated_by=NULL WHERE updated_by=%s", (uid,))

            # Delete the user record
            cur.execute("DELETE FROM users WHERE id=%s RETURNING id", (uid,))
            deleted = cur.fetchone()
            if not deleted:
                raise HTTPException(404, "User could not be deleted")
            conn.commit()

        revoke_all_user_sessions(uid)
        cache_delete(f"user:{uid}:me", f"user:{uid}:profile", f"teacher:{uid}:profile")
        cache_delete_pattern("teacher:*:profile")
        cache_delete_pattern("teachers:list:*")
        cache_delete_pattern("admin:users:*")
        cache_delete("admin:dashboard:summary")
        cache_delete_pattern("schedules:*")
        return {"ok": True, "deleted": uid, "username": found["username"]}
    finally:
        conn.close()

class AdminUserUpdateRequest(BaseModel):
    display_name: str | None = None
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    role: str | None = None
    is_active: bool | None = None
    password: str | None = None
    must_reset_password: bool | None = None

@app.patch("/admin/users/{user_id}")
async def update_user(user_id: int, request: Request, _=Depends(require_roles("admin"))):
    body_data = {}
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            body_data = await request.json()
        except Exception:
            body_data = {}
    else:
        form = await request.form()
        body_data = dict(form)

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, username, role, student_id, display_name, email, phone, is_active, must_reset_password FROM users WHERE id=%s", (user_id,))
            existing = cur.fetchone()
            if not existing:
                raise HTTPException(404, "User not found")

            updates = {}
            name_val = body_data.get("display_name") or body_data.get("name")
            if name_val is not None:
                updates["display_name"] = str(name_val).strip() or None
            if "email" in body_data:
                updates["email"] = str(body_data["email"]).strip() or None
            if "phone" in body_data:
                updates["phone"] = str(body_data["phone"]).strip() or None
            if "role" in body_data and body_data["role"]:
                new_role = str(body_data["role"]).strip().lower()
                if new_role not in {"admin", "teacher", "faculty", "student"}:
                    raise HTTPException(422, "Role must be admin, teacher, faculty, or student")
                updates["role"] = new_role
            if "is_active" in body_data:
                val = body_data["is_active"]
                if isinstance(val, str):
                    updates["is_active"] = val.lower() in ("true", "1", "yes")
                else:
                    updates["is_active"] = bool(val)
            if "must_reset_password" in body_data:
                val = body_data["must_reset_password"]
                if isinstance(val, str):
                    updates["must_reset_password"] = val.lower() in ("true", "1", "yes")
                else:
                    updates["must_reset_password"] = bool(val)
            if "password" in body_data and body_data["password"]:
                pass_str = str(body_data["password"]).strip()
                if len(pass_str) >= 4:
                    updates["password_hash"] = password_hash(pass_str)
                    if existing["role"] == "student" and "must_reset_password" not in updates:
                        updates["must_reset_password"] = True

            if not updates:
                return existing

            set_clause = ", ".join(f"{col}=%s" for col in updates)
            cur.execute(
                f"UPDATE users SET {set_clause} WHERE id=%s RETURNING id, username, role, student_id, display_name, email, phone, is_active, must_reset_password",
                (*updates.values(), user_id),
            )
            row = cur.fetchone()
            cur.execute(
                "INSERT INTO audit_logs (actor_id, action, entity, entity_id, previous_value, new_value) VALUES (%s, 'USER_UPDATED', 'user', %s, %s, %s)",
                (1, str(user_id), json.dumps(dict(existing), default=str), json.dumps(dict(row), default=str)),
            )
        conn.commit()

        if "is_active" in updates:
            set_user_account_status(user_id, updates["is_active"])
        if "role" in updates:
            revoke_all_user_sessions(user_id)

        cache_delete(f"user:{user_id}:me", f"user:{user_id}:profile", f"teacher:{user_id}:profile")
        cache_delete_pattern(f"auth:user:{user_id}:*")
        return row
    finally:
        conn.close()

def is_blank_frame(image) -> bool:
    """True when the frame is effectively black (camera layer missing).

    A high percentile is used instead of std-dev so a small bright overlay
    (e.g. a timestamp stamped over an empty frame) does not hide the problem.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return float(gray.mean()) < BLANK_MEAN_MAX and float(np.percentile(gray, 99)) < BLANK_P99_MAX

def read_image_bytes(data: bytes, allow_blank: bool = False):
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, f"Image must be between 1 byte and {MAX_IMAGE_BYTES // (1024 * 1024)} MB")
    try:
        pil_image = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(400, "Invalid image file format") from exc
    # InsightFace/OpenCV inference expects BGR arrays. Mobile uploads arrive
    # through Pillow as RGB, so convert explicitly before detection.
    image = cv2.cvtColor(np.asarray(pil_image), cv2.COLOR_RGB2BGR)
    # Normalize thumbnail-sized uploads before face detection and quality
    # measurement. Keeping this in the image reader ensures detector boxes and
    # quality crops use the same working dimensions.
    height, width = image.shape[:2]
    if min(height, width) < 640:
        scale = 640.0 / max(min(height, width), 1)
        image = cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_CUBIC)
    if not allow_blank and is_blank_frame(image):
        logger.warning("blank_frame_rejected size=%sx%s", image.shape[1], image.shape[0])
        raise HTTPException(422, "The captured image is blank (black frame). The camera image was not received; please reopen the camera and retake the photo.")
    return image

def embedding_array(value):
    """Convert pgvector's Vector result (or a plain list) to a NumPy array."""
    if hasattr(value, "to_numpy"):
        return np.asarray(value.to_numpy(), dtype=np.float32)
    if hasattr(value, "to_list"):
        return np.asarray(value.to_list(), dtype=np.float32)
    return np.asarray(value, dtype=np.float32)

async def detect(image):
    # Some phone capture paths and multipart clients upload thumbnails around
    # 300px wide. RetinaFace is much more reliable when the face proposal is
    # evaluated at a reasonable pixel size, so enlarge small inputs before
    # inference. The returned bbox/embedding are intentionally based on this
    # working image; callers use the same image dimensions for quality checks.
    height, width = image.shape[:2]
    minimum_dimension = min(height, width)
    if minimum_dimension < 640:
        scale = 640.0 / max(minimum_dimension, 1)
        working = cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_CUBIC)
        logger.info("face_detection_upscale input=%sx%s working=%sx%s", width, height, working.shape[1], working.shape[0])
    else:
        working = image
    # Always prefer the normal recognition detector and preprocessing.
    faces = await face_model.detect(working)
    # Use a sensitive proposal threshold for webcam frames, then remove weak
    # proposals. This detects real faces without counting background noise.
    if faces or image.size == 0:
        return faces

    # Conservative recovery for a genuinely difficult webcam frame. A
    # fallback is accepted only when it finds exactly one strong face; an
    # ambiguous fallback is rejected rather than inventing extra faces.
    lab = cv2.cvtColor(working, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    l_channel = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(8, 8)).apply(l_channel)
    enhanced = cv2.cvtColor(cv2.merge((l_channel, a_channel, b_channel)), cv2.COLOR_LAB2BGR)
    recovered = await face_model.detect(enhanced)
    if recovered:
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

def confident_faces(faces, minimum_confidence=MIN_FACE_CONFIDENCE):
    """Retain only detector results strong enough for biometric processing."""
    return [
        face for face in faces
        if float(getattr(face, "det_score", 0.0)) >= minimum_confidence
    ]

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
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.size else np.empty((0, 0))
    brightness = float(gray.mean()) if gray.size else 0.0
    contrast = float(gray.std()) if gray.size else 0.0
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var()) if gray.size else 0.0
    issues = []

    if area_ratio < 0.02:
        issues.append("Move closer to the camera")
    elif area_ratio > 0.85:
        issues.append("Move farther from the camera")
    if brightness < 25:
        issues.append("Lighting is too dim")
    elif brightness > 235:
        issues.append("Lighting is too bright")
    if contrast < 10:
        issues.append("Use more even lighting with visible facial detail")
    if face_width < 40 or face_height < 40:
        issues.append("Move closer so your face is larger in frame")
    if sharpness < 15:
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
        "detection_confidence": round(float(getattr(face, "det_score", 0.0)), 4),
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
    cached = cache_get("system:health:status", use_l1=True)
    if cached is not None:
        return cached
    try:
        conn = get_db_connection(); conn.close()
        cache_status = "ok" if cache_available() else ("unavailable" if os.getenv("REDIS_URL") else "disabled")
        res = {"status": "ok", "model_loaded": face_model.loaded, "database": "ok", "cache": cache_status}
        cache_set("system:health:status", res, ttl=30, use_l1=True)
        return res
    except Exception as exc:
        raise HTTPException(503, f"Database unavailable: {exc}")

@app.get("/cache/stats")
def get_cache_stats():
    """Real-time cache hit ratios, throughput metrics, and L1/L2 telemetry."""
    return cache_stats()


@app.get("/model")
def model_info():
    """Expose the loaded model identity and its on-disk weight files."""
    files = []
    files = face_model.files()
    return {
        "name": face_model.name,
        "root": face_model.root,
        "loaded": face_model.loaded,
        "providers": face_model.providers,
        "files": files,
        "parameters": {
            "detector_proposal_threshold": face_model.det_threshold,
            "detector_size": face_model.det_size,
            "registration_min_confidence": MIN_FACE_CONFIDENCE,
            "group_min_confidence": MIN_GROUP_FACE_CONFIDENCE,
            "recognition_match_threshold": MATCH_THRESHOLD,
        },
    }

@app.post("/validate-face")
async def validate_face(
    file: UploadFile = File(...),
    target_pose: str = Form("any"),
    _=Depends(current_user),
):
    allowed = {"any", "center", "left", "right", "chin_up", "chin_down"}
    if target_pose not in allowed:
        raise HTTPException(422, f"target_pose must be one of: {', '.join(sorted(allowed))}")
    image = read_image_bytes(await file.read(), allow_blank=True)
    if is_blank_frame(image):
        blank_gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        logger.warning("face_validation pose=%s valid=false reason=blank_frame size=%sx%s", target_pose, image.shape[1], image.shape[0])
        return {
            "valid": False,
            "issues": ["Captured frame is black. The camera image was not received."],
            "faces_detected": 0,
            "target_pose": target_pose,
            "frame_blank": True,
            "image_width": image.shape[1],
            "image_height": image.shape[0],
            "brightness": round(float(blank_gray.mean()), 2),
            "contrast": round(float(blank_gray.std()), 2),
            "user_guidance": "The camera returned an empty image. Reopen the camera and retake the photo.",
        }
    detected_faces = await detect(image)
    candidate_count = len(detected_faces)
    faces = confident_faces(detected_faces, minimum_confidence=0.30)
    if not faces and detected_faces:
        faces = detected_faces
    logger.info(
        "face_detection pose=%s candidates=%s accepted=%s scores=%s",
        target_pose,
        candidate_count,
        len(faces),
        [round(float(getattr(face, "det_score", 0.0)), 4) for face in detected_faces],
    )
    faces = primary_face(image, faces)
    if len(faces) != 1:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        logger.info(
            "face_validation pose=%s valid=false candidates=%s accepted=%s scores=%s",
            target_pose,
            candidate_count,
            len(faces),
            [round(float(getattr(face, "det_score", 0.0)), 4) for face in detected_faces],
        )
        return {
            "valid": False,
            "issues": ["No face detected in the frame. Please ensure your face is clearly visible to the camera."],
            "faces_detected": 0,
            "target_pose": target_pose,
            "image_width": image.shape[1],
            "image_height": image.shape[0],
            "brightness": round(float(gray.mean()), 2),
            "contrast": round(float(gray.std()), 2),
            "user_guidance": "Please ensure your face is visible within the frame in good lighting."
        }
    quality = face_quality(image, faces[0], target_pose)
    quality["faces_detected"] = 1
    quality["image_width"] = image.shape[1]
    quality["image_height"] = image.shape[0]
    # For general capture or when target_pose is any, valid face detected is accepted
    if target_pose == "any":
        quality["valid"] = True
        quality["issues"] = []
        quality["user_guidance"] = "Face detected and verified!"
    logger.info(
        "face_validation pose=%s valid=%s candidates=%s image=%sx%s",
        target_pose, quality["valid"], candidate_count, image.shape[1], image.shape[0],
    )
    return quality

@app.get("/students")
def list_students(
    page: int | None = Query(default=None, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    search: str | None = Query(default=None),
    section_id: int | None = Query(default=None),
    program: str | None = Query(default=None),
    semester: str | None = Query(default=None),
    include_photos: bool = Query(default=True),
    user=Depends(require_roles("admin", "teacher", "faculty")),
):
    role = normalize_role(user["role"])
    search_clean = search.strip().lower() if search else None
    prog_clean = program.strip() if program else None
    sem_clean = semester.strip() if semester else None

    # Construct scoped cache key (admins share cached list since they view all students)
    user_scope = "all" if role == "admin" else str(user["sub"])
    cache_key = f"students:list:{role}:{user_scope}:p={page}:ps={page_size}:s={search_clean}:sec={section_id}:pr={prog_clean}:sem={sem_clean}:ph={include_photos}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            conditions = []
            params = []

            # Role scope
            if role == "faculty":
                conditions.append("""s.section_id IN (
                    SELECT ta.section_id FROM teacher_assignments ta WHERE ta.teacher_user_id = %s
                )""")
                params.append(user["sub"])

            if section_id is not None:
                conditions.append("s.section_id = %s")
                params.append(section_id)

            if prog_clean:
                conditions.append("s.program = %s")
                params.append(prog_clean)

            if sem_clean:
                conditions.append("s.semester = %s")
                params.append(sem_clean)

            if search_clean:
                conditions.append("(LOWER(s.name) LIKE %s OR LOWER(s.roll_number) LIKE %s OR LOWER(s.student_id) LIKE %s)")
                like_term = f"%{search_clean}%"
                params.extend([like_term, like_term, like_term])

            where_clause = " WHERE " + " AND ".join(conditions) if conditions else ""

            # Count total
            count_query = f"SELECT COUNT(*) AS total FROM students s{where_clause}"
            cur.execute(count_query, params)
            total_items = cur.fetchone()["total"]

            total_pages = (total_items + page_size - 1) // page_size if total_items > 0 else 0
            limit_clause = ""
            offset = 0
            if page is not None:
                offset = (page - 1) * page_size
                limit_clause = f" LIMIT {page_size} OFFSET {offset}"

            data_query = f"""
                SELECT s.student_id, s.name, s.email, s.phone, s.date_of_birth,
                       s.program, s.semester, s.department, s.gpa, s.enrollment_year,
                       s.roll_number, s.section_id, s.created_at,
                       sec.school AS academic_school, sec.faculty AS academic_faculty,
                       sec.department AS academic_department, sec.semester AS academic_semester,
                       sec.section AS academic_section
                       {", s.profile_photo_thumbnail" if include_photos else ""}
                FROM students s
                LEFT JOIN academic_sections sec ON sec.id = s.section_id
                {where_clause}
                ORDER BY s.student_id ASC
                {limit_clause}
            """
            cur.execute(data_query, params)
            rows = cur.fetchall()

            if include_photos:
                for student in rows:
                    thumb = student.pop("profile_photo_thumbnail", None)
                    if not thumb:
                        try:
                            cur.execute("SELECT profile_photo FROM students WHERE student_id = %s", (student["student_id"],))
                            p_row = cur.fetchone()
                            if p_row and p_row.get("profile_photo"):
                                thumb = student_photo_data_uri(p_row["profile_photo"])
                                if thumb:
                                    cur.execute("UPDATE students SET profile_photo_thumbnail = %s WHERE student_id = %s", (thumb, student["student_id"]))
                                    conn.commit()
                        except Exception as exc:
                            logger.warning("student_photo_thumbnail_failed student_id=%s error=%s", student["student_id"], exc)
                    student["profile_photo_base64"] = thumb or None

            current_page = page if page is not None else 1
            has_next = current_page < total_pages if page is not None else False
            has_previous = current_page > 1 if page is not None else False

            res = {
                "items": rows,
                "students": rows,  # backward compatibility
                "pagination": {
                    "page": current_page,
                    "page_size": page_size if page is not None else len(rows),
                    "total_items": total_items,
                    "total_pages": total_pages if page is not None else 1,
                    "has_next": has_next,
                    "has_previous": has_previous,
                },
            }
            cache_set(cache_key, res, ttl=180)
            return res
    finally:
        conn.close()

@app.get("/students/{student_id}")
@app.get("/api/students/{student_id}")
def get_student_detail(student_id: str, user=Depends(current_user)):
    student_id = student_id.strip()
    role = normalize_role(user.get("role", ""))

    # IDOR check: Students can only view their own profile
    if role == "student":
        if user.get("student_id") != student_id:
            raise HTTPException(403, "Access denied: you can only view your own student record")

    # IDOR check: Faculty/teacher can only view students in their assigned sections
    if role == "faculty":
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT 1 FROM students s
                    JOIN teacher_assignments ta ON ta.section_id = s.section_id
                    WHERE s.student_id = %s AND ta.teacher_user_id = %s
                """, (student_id, user["sub"]))
                if not cur.fetchone():
                    raise HTTPException(403, "Access denied: student is not enrolled in your assigned sections")
        finally:
            conn.close()

    cache_key = f"student:{student_id}:profile:viewer={user['sub']}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT s.student_id, s.name, s.email, s.phone, s.date_of_birth,
                       s.program, s.semester, s.department, s.gpa, s.enrollment_year,
                       s.roll_number, s.section_id, s.created_at,
                       sec.school AS academic_school, sec.faculty AS academic_faculty,
                       sec.department AS academic_department, sec.semester AS academic_semester,
                       sec.section AS academic_section,
                       COALESCE(s.profile_photo_thumbnail, encode(s.profile_photo, 'base64')) AS profile_photo_base64
                FROM students s
                LEFT JOIN academic_sections sec ON sec.id = s.section_id
                WHERE s.student_id = %s
            """, (student_id,))
            student = cur.fetchone()
            if not student:
                raise HTTPException(404, "Student not found")

            if student.get("profile_photo_base64") and not student["profile_photo_base64"].startswith("data:"):
                student["profile_photo_base64"] = f"data:image/jpeg;base64,{student['profile_photo_base64']}"

            cache_set(cache_key, student, ttl=60)
            return student
    finally:
        conn.close()

@app.get("/attendance/student/{student_id}")
@app.get("/api/attendance/student/{student_id}")
def get_student_attendance_history_by_id(
    student_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status: str | None = Query(default=None),
    user=Depends(current_user),
):
    student_id = student_id.strip()
    role = normalize_role(user.get("role", ""))

    # IDOR check: Students can only view their own history
    if role == "student":
        if user.get("student_id") != student_id:
            raise HTTPException(403, "Access denied: you can only view your own attendance history")

    # IDOR check: Faculty/teacher can only view students in their assigned sections
    if role == "faculty":
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT 1 FROM students s
                    JOIN teacher_assignments ta ON ta.section_id = s.section_id
                    WHERE s.student_id = %s AND ta.teacher_user_id = %s
                """, (student_id, user["sub"]))
                if not cur.fetchone():
                    raise HTTPException(403, "Access denied: student is not enrolled in your assigned sections")
        finally:
            conn.close()

    status_filter = status.upper().strip() if status else None
    cache_key = f"attendance:student:{student_id}:p={page}:ps={page_size}:st={status_filter}:v={user['sub']}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT student_id, name FROM students WHERE student_id=%s", (student_id,))
            student = cur.fetchone()
            if not student:
                raise HTTPException(404, "Student not found")

            conditions = ["a.student_id = %s"]
            params = [student_id]
            if status_filter in {"PRESENT", "ABSENT"}:
                conditions.append("COALESCE(a.final_attendance_status, a.initial_attendance_status, 'ABSENT') = %s")
                params.append(status_filter)

            where_clause = " WHERE " + " AND ".join(conditions)

            count_query = f"SELECT COUNT(*) AS total FROM attendance_logs a{where_clause}"
            cur.execute(count_query, params)
            total_items = cur.fetchone()["total"]

            total_pages = (total_items + page_size - 1) // page_size if total_items > 0 else 0
            offset = (page - 1) * page_size

            data_query = f"""
                SELECT a.id, a.session_id, a.student_id, a.confidence_score, a.timestamp,
                       COALESCE(a.final_attendance_status, a.initial_attendance_status, 'ABSENT') AS status,
                       a.is_manual_override,
                       sess.title, sess.course, sess.event_date, sess.starts_at, sess.ends_at, sess.room
                FROM attendance_logs a
                JOIN attendance_sessions sess ON sess.session_id = a.session_id
                {where_clause}
                ORDER BY a.timestamp DESC, a.id DESC
                LIMIT %s OFFSET %s
            """
            cur.execute(data_query, (*params, page_size, offset))
            items = cur.fetchall()

            res = {
                "student_id": student_id,
                "student_name": student["name"],
                "items": items,
                "pagination": {
                    "page": page,
                    "page_size": page_size,
                    "total_items": total_items,
                    "total_pages": total_pages,
                    "has_next": page < total_pages,
                    "has_previous": page > 1,
                },
            }
            cache_set(cache_key, res, ttl=30)
            return res
    finally:
        conn.close()

@app.get("/attendance/sessions/{session_id}/records")
@app.get("/api/attendance/sessions/{session_id}/records")
@app.get("/api/sessions/{session_id}/attendance")
@app.get("/sessions/{session_id}/attendance")
def get_session_attendance_records(
    session_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    limit: int | None = Query(default=None, ge=1, le=100),
    status: str | None = Query(default=None),
    search: str | None = Query(default=None),
    include_photos: bool = Query(default=False),
    user=Depends(current_user),
):
    session_id = session_id.strip()
    role = normalize_role(user.get("role", ""))
    effective_limit = limit if limit is not None else page_size

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM attendance_sessions WHERE session_id = %s", (session_id,))
            session = cur.fetchone()
            if not session:
                raise HTTPException(404, "Attendance session not found")

            sec_ids = session_section_ids(session)

            # Authorization Check
            if role == "faculty":
                is_owner = session["teacher_id"] == user["sub"]
                if not is_owner:
                    cur.execute("""
                        SELECT 1 FROM teacher_assignments
                        WHERE teacher_user_id = %s AND section_id = ANY(%s)
                    """, (user["sub"], sec_ids))
                    if not cur.fetchone():
                        raise HTTPException(403, "You are not authorized to access this attendance session")

            elif role == "student":
                cur.execute("""
                    SELECT 1 FROM students
                    WHERE student_id = %s AND section_id = ANY(%s)
                """, (user["student_id"], sec_ids))
                if not cur.fetchone():
                    raise HTTPException(403, "Access denied: you do not belong to this attendance session")

            status_filter = status.upper().strip() if status else None
            search_clean = search.strip().lower() if search else None

            viewer_scope = f"student:{user['student_id']}" if role == "student" else "staff"
            cache_key = f"attendance:session:{session_id}:records:v={viewer_scope}:p={page}:ps={effective_limit}:st={status_filter}:s={search_clean}:ph={include_photos}"
            cached = cache_get(cache_key)
            if cached is not None:
                return cached

            conditions = []
            params = []

            if sec_ids:
                conditions.append("(st.section_id = ANY(%s) OR a.session_id IS NOT NULL)")
                params.append(sec_ids)
            else:
                conditions.append("a.session_id IS NOT NULL")

            # If student, restrict strictly to their own record
            if role == "student":
                conditions.append("st.student_id = %s")
                params.append(user["student_id"])

            if status_filter in {"PRESENT", "ABSENT"}:
                conditions.append("COALESCE(a.final_attendance_status, a.initial_attendance_status, 'ABSENT') = %s")
                params.append(status_filter)

            if search_clean:
                conditions.append("(LOWER(st.name) LIKE %s OR LOWER(st.roll_number) LIKE %s OR LOWER(st.student_id) LIKE %s)")
                like_term = f"%{search_clean}%"
                params.extend([like_term, like_term, like_term])

            where_clause = (" WHERE " + " AND ".join(conditions)) if conditions else ""

            # Total count query
            count_query = f"""
                SELECT COUNT(DISTINCT st.student_id) AS total
                FROM students st
                LEFT JOIN attendance_logs a ON a.session_id = %s AND a.student_id = st.student_id
                {where_clause}
            """
            cur.execute(count_query, (session_id, *params))
            total_items = cur.fetchone()["total"]

            total_pages = (total_items + effective_limit - 1) // effective_limit if total_items > 0 else 0
            offset = (page - 1) * effective_limit

            photo_col = ", encode(st.profile_photo, 'base64') AS profile_photo_base64" if include_photos else ""

            data_query = f"""
                SELECT st.student_id, st.name, st.email, st.phone, st.program,
                       COALESCE(st.semester, sec.semester) AS semester,
                       COALESCE(st.department, sec.department) AS department,
                       st.date_of_birth, st.roll_number,
                       st.profile_picture,
                       a.confidence_score, a.timestamp,
                       COALESCE(a.final_attendance_status, a.initial_attendance_status, 'ABSENT') AS status,
                       COALESCE(a.is_manual_override, FALSE) AS is_manual_override
                       {photo_col}
                FROM students st
                LEFT JOIN academic_sections sec ON sec.id = st.section_id
                LEFT JOIN attendance_logs a ON a.session_id = %s AND a.student_id = st.student_id
                {where_clause}
                ORDER BY st.name ASC, st.student_id ASC
                LIMIT %s OFFSET %s
            """
            cur.execute(data_query, (session_id, *params, effective_limit, offset))
            items = cur.fetchall()

            for item in items:
                item["student_name"] = item.get("name")
                item["attendance_status"] = item.get("status")
                pic = item.get("profile_picture")
                if pic:
                    item["profile_picture"] = f"/student-photos/{Path(pic).name}"
                else:
                    item["profile_picture"] = None

                if include_photos:
                    if item.get("profile_photo_base64"):
                        item["profile_photo_base64"] = f"data:image/jpeg;base64,{item['profile_photo_base64']}"
                else:
                    item.pop("profile_photo_base64", None)

            res = {
                "session_id": session_id,
                "session_title": session.get("title", ""),
                "course": session.get("course", ""),
                "page": page,
                "page_size": effective_limit,
                "total_records": total_items,
                "total_items": total_items,
                "total_pages": total_pages,
                "has_next": page < total_pages,
                "has_previous": page > 1,
                "records": items,
                "items": items,
                "pagination": {
                    "page": page,
                    "page_size": effective_limit,
                    "total_items": total_items,
                    "total_pages": total_pages,
                    "has_next": page < total_pages,
                    "has_previous": page > 1,
                },
            }
            cache_set(cache_key, res, ttl=30)
            return res
    finally:
        conn.close()

class AcademicSectionRequest(BaseModel):
    school: str
    faculty: str
    department: str
    program: str
    semester: str
    section: str

class TeacherAssignmentRequest(BaseModel):
    teacher_user_id: int
    section_id: int
    subject: str

@app.post("/admin/academic/sections")
def create_academic_section(body: AcademicSectionRequest, _=Depends(require_roles("admin"))):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""INSERT INTO academic_sections (school,faculty,department,program,semester,section) VALUES (%s,%s,%s,%s,%s,%s)
                ON CONFLICT (school,faculty,department,program,semester,section) DO UPDATE SET school=EXCLUDED.school RETURNING *""", tuple(value.strip() for value in body.dict().values()))
            row = cur.fetchone()
        conn.commit()
        cache_delete("academic:sections")
        return row
    finally: conn.close()

@app.get("/academic/sections")
def list_academic_sections(_=Depends(current_user)):
    cached = cache_get("academic:sections")
    if cached is not None:
        return {"sections": cached}
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM academic_sections ORDER BY school, faculty, department, program, semester, section")
            rows = cur.fetchall()
            cache_set("academic:sections", rows, ttl=300)
            return {"sections": rows}
    finally: conn.close()

@app.post("/teacher/attendance-sessions")
def create_attendance_session(body: AttendanceSessionRequest, user=Depends(require_roles("teacher"))):
    if not body.title.strip() or not body.course.strip() or not body.school.strip() or not body.program.strip() or not body.semester.strip() or body.section_id is None:
        raise HTTPException(422, "Title, course, school, program, semester, and section are required")
    session_id = f"ATT-{secrets.token_hex(6).upper()}"
    section_ids = list(dict.fromkeys(body.section_ids or [body.section_id]))
    if body.section_id not in section_ids:
        section_ids.insert(0, body.section_id)
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            if len(section_ids) == 1:
                cur.execute("""SELECT sec.id FROM teacher_assignments ta JOIN academic_sections sec ON sec.id=ta.section_id
                    WHERE ta.teacher_user_id=%s AND sec.id = ANY(%s)""", (user["sub"], section_ids))
                assigned_ids = {row["id"] for row in cur.fetchall()}
                if set(section_ids) != assigned_ids:
                    raise HTTPException(403, "You are not assigned to every selected program and semester")
            else:
                cur.execute("SELECT id FROM academic_sections WHERE id = ANY(%s)", (section_ids,))
                valid_ids = {row["id"] for row in cur.fetchall()}
                if set(section_ids) != valid_ids:
                    raise HTTPException(404, "One or more selected academic sections do not exist")
            section_id = body.section_id
            scope = {**body.academic_scope, "section_ids": section_ids}
            cur.execute("""INSERT INTO attendance_sessions
                (session_id,teacher_id,title,course,school,faculty,department,program,semester,section_id,room,event_date,starts_at,ends_at,notes,academic_scope)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING *""", (session_id, user["sub"], body.title.strip(), body.course.strip(), body.school.strip(),
                body.faculty.strip(), body.department.strip(), body.program.strip(), body.semester.strip(), section_id,
                body.room.strip(), body.event_date, body.starts_at, body.ends_at, body.notes.strip(), json.dumps(scope)))
            result = cur.fetchone()
            cur.execute("SELECT COUNT(*) AS count FROM students WHERE section_id = ANY(%s)", (section_ids,))
            roster_count = cur.fetchone()["count"]
        conn.commit()
        init_attendance_live_state(
            session_id=session_id,
            teacher_id=user["sub"],
            total_roster=roster_count,
            status="ACTIVE",
        )
        cache_delete(f"teacher:{user['sub']}:attendance-sessions")
        cache_delete_pattern("teacher:*:attendance-sessions")
        cache_delete("admin:attendance:all", "admin:dashboard:summary")
        return result
    finally:
        conn.close()

@app.get("/teacher/attendance-sessions")
def teacher_attendance_sessions(user=Depends(require_roles("admin", "teacher"))):
    cache_key = f"teacher:{user['sub']}:attendance-sessions"
    cached = cache_get(cache_key)
    if cached is not None:
        return {"sessions": cached}
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            query = """SELECT s.*,
                (SELECT COUNT(DISTINCT st.student_id) FROM students st
                 WHERE st.section_id = s.section_id
                    OR (CASE WHEN jsonb_typeof(s.academic_scope->'section_ids') = 'array'
                        THEN ((s.academic_scope->'section_ids') @> to_jsonb(st.section_id) OR (s.academic_scope->'section_ids') ? (st.section_id::text))
                        ELSE FALSE END)
                ) AS roster_count,
                (SELECT COUNT(*) FROM attendance_logs a WHERE a.session_id=s.session_id
                    AND COALESCE(a.final_attendance_status, a.initial_attendance_status)='PRESENT') AS present_count
                FROM attendance_sessions s
                {owner_filter}
                ORDER BY s.event_date DESC, s.starts_at DESC"""
            owner_filter = "WHERE s.teacher_id=%s" if user["role"] == "teacher" else ""
            cur.execute(query.format(owner_filter=owner_filter), (user["sub"],) if owner_filter else ())
            rows = cur.fetchall()
            cache_set(cache_key, rows, ttl=30)
            return {"sessions": rows}
    finally:
        conn.close()

@app.get("/teacher/attendance-sessions/{session_id}")
def teacher_attendance_session_detail(session_id: str, user=Depends(require_roles("teacher"))):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM attendance_sessions WHERE session_id=%s AND teacher_id=%s", (session_id, user["sub"]))
            session = cur.fetchone()
            if not session: raise HTTPException(404, "Attendance session not found")
            cur.execute("SELECT * FROM attendance_upload_batches WHERE session_id=%s ORDER BY created_at DESC", (session_id,))
            batches = cur.fetchall()
            return {"session": session, "batches": batches}
    finally: conn.close()

@app.patch("/teacher/attendance-sessions/{session_id}")
def update_teacher_session(session_id: str, body: SessionUpdateRequest, user=Depends(require_roles("admin", "teacher"))):
    values = body.model_dump(exclude_none=True)
    if not values:
        raise HTTPException(422, "Provide at least one session field to update")
    text_fields = {"title", "course", "room", "notes"}
    for field in text_fields & values.keys():
        values[field] = values[field].strip()
    if any(not values[field] for field in {"title", "course"} & values.keys()):
        raise HTTPException(422, "Title and course cannot be empty")
    assignments = ", ".join(f"{field}=%s" for field in values)
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            owner_filter = "AND teacher_id=%s" if user["role"] == "teacher" else ""
            cur.execute(
                f"UPDATE attendance_sessions SET {assignments} WHERE session_id=%s {owner_filter} RETURNING *",
                (*values.values(), session_id, *([user["sub"]] if owner_filter else [])),
            )
            updated = cur.fetchone()
            if not updated:
                raise HTTPException(404, "Attendance session not found")
            cur.execute("INSERT INTO audit_logs (actor_id,action,entity,entity_id,new_value) VALUES (%s,'SESSION_UPDATED','attendance_session',%s,%s)",
                        (user["sub"], session_id, json.dumps(values)))
        conn.commit()
        cache_delete(f"teacher:{user['sub']}:attendance-sessions")
        cache_delete_pattern(f"attendance:session:{session_id}:*")
        cache_delete("admin:attendance:all", "admin:dashboard:summary")
        return updated
    finally:
        conn.close()

@app.patch("/teacher/attendance-sessions/{session_id}/status")
def update_teacher_session_status(session_id: str, body: SessionStatusRequest, user=Depends(require_roles("teacher"))):
    desired = body.status.upper()
    if desired not in {"ACTIVE", "COMPLETED"}:
        raise HTTPException(422, "Session status must be ACTIVE or COMPLETED")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT status FROM attendance_sessions WHERE session_id=%s AND teacher_id=%s FOR UPDATE", (session_id, user["sub"]))
            current = cur.fetchone()
            if not current: raise HTTPException(404, "Attendance session not found")
            if current["status"] == "COMPLETED" and desired != "ACTIVE":
                raise HTTPException(409, "Session is already completed")
            cur.execute("UPDATE attendance_sessions SET status=%s, completed_at=CASE WHEN %s='COMPLETED' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE session_id=%s RETURNING *", (desired, desired, session_id))
            updated = cur.fetchone()
            cur.execute("INSERT INTO audit_logs (actor_id,action,entity,entity_id,new_value) VALUES (%s,%s,'attendance_session',%s,%s)", (user["sub"], "SESSION_" + desired, session_id, json.dumps({"status": desired})))
        conn.commit()
        set_attendance_live_status(session_id, desired)
        cache_delete(f"teacher:{user['sub']}:attendance-sessions")
        cache_delete_pattern(f"attendance:session:{session_id}:*")
        cache_delete("admin:attendance:all", "admin:dashboard:summary")
        return updated
    finally: conn.close()

@app.delete("/teacher/attendance-sessions/{session_id}")
def delete_teacher_session(session_id: str, user=Depends(require_roles("teacher"))):
    """Delete a teacher-owned session and its dependent attendance records."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM attendance_sessions WHERE session_id=%s AND teacher_id=%s FOR UPDATE", (session_id, user["sub"]))
            if not cur.fetchone():
                raise HTTPException(404, "Attendance session not found")
            cur.execute("DELETE FROM attendance_logs WHERE session_id=%s", (session_id,))
            attendance_deleted = cur.rowcount
            # Upload batches and their photos cascade from the session.
            cur.execute("DELETE FROM attendance_sessions WHERE session_id=%s", (session_id,))
            cur.execute("INSERT INTO audit_logs (actor_id,action,entity,entity_id) VALUES (%s,'SESSION_DELETED','attendance_session',%s)",
                        (user["sub"], session_id))
        conn.commit()
        delete_attendance_live_state(session_id)
        cache_delete(f"teacher:{user['sub']}:attendance-sessions")
        cache_delete_pattern(f"attendance:session:{session_id}:*")
        cache_delete_pattern("student:*:attendance*")
        cache_delete("admin:attendance:all", "admin:dashboard:summary")
        return {"deleted": session_id, "attendance_records_deleted": attendance_deleted}
    finally:
        conn.close()

@app.get("/student/attendance-sessions")
def student_attendance_sessions(user=Depends(require_roles("student"))):
    student_id = user.get("student_id")
    if not student_id: raise HTTPException(422, "Student account is not linked to a student")
    cache_key = f"student:{student_id}:attendance-sessions"
    cached = cache_get(cache_key)
    if cached is not None:
        return {"sessions": cached}
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""SELECT s.session_id, s.title, s.course, s.school, s.faculty, s.department,
                s.program, s.semester, s.room, s.event_date, s.starts_at, s.ends_at, s.notes,
                COALESCE(a.final_attendance_status, a.initial_attendance_status, 'ABSENT') AS status,
                a.timestamp AS marked_at
                FROM attendance_sessions s
                LEFT JOIN attendance_logs a ON a.session_id=s.session_id AND a.student_id=%s
                WHERE a.student_id IS NOT NULL
                   OR EXISTS (
                       SELECT 1 FROM students st
                       WHERE st.student_id=%s AND (
                           st.section_id = s.section_id
                           OR (CASE WHEN jsonb_typeof(s.academic_scope->'section_ids') = 'array'
                               THEN ((s.academic_scope->'section_ids') @> to_jsonb(st.section_id) OR (s.academic_scope->'section_ids') ? (st.section_id::text))
                               ELSE FALSE END)
                       )
                   )
                ORDER BY s.event_date DESC, s.starts_at DESC""", (student_id, student_id))
            rows = cur.fetchall()
            cache_set(cache_key, rows, ttl=30)
            return {"sessions": rows}
    finally:
        conn.close()

@app.post("/admin/teacher-assignments")
def assign_teacher(body: TeacherAssignmentRequest, user=Depends(require_roles("admin"))):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO teacher_assignments (teacher_user_id,section_id,subject) VALUES (%s,%s,%s) ON CONFLICT (teacher_user_id,section_id,subject) DO NOTHING RETURNING id", (body.teacher_user_id, body.section_id, body.subject.strip()))
            row = cur.fetchone()
            if not row: raise HTTPException(409, "This teacher is already assigned to that class.")
            cur.execute("INSERT INTO audit_logs (actor_id, action, entity, entity_id, new_value) VALUES (%s,'TEACHER_ASSIGNED','teacher_assignment',%s,%s)", (user["sub"], str(row["id"]), json.dumps(body.dict())))
        conn.commit()
        cache_delete_pattern(f"teacher:{body.teacher_user_id}:*")
        cache_delete_pattern("students:list:*")
        return {"id": row["id"], "status": "assigned"}
    finally: conn.close()

@app.delete("/admin/students/{student_id}")
def delete_student(student_id: str, _=Depends(require_roles("admin"))):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE student_id=%s", (student_id,))
            user_rows = cur.fetchall()
            cur.execute("DELETE FROM attendance_logs WHERE student_id=%s", (student_id,))
            cur.execute("DELETE FROM student_embeddings WHERE student_id=%s", (student_id,))
            cur.execute("DELETE FROM users WHERE student_id=%s", (student_id,))
            cur.execute("DELETE FROM students WHERE student_id=%s RETURNING student_id", (student_id,))
            deleted = cur.fetchone()
        if not deleted: raise HTTPException(404, "Student not found")
        conn.commit()
        for u in user_rows:
            revoke_all_user_sessions(u["id"])
            cache_delete(f"user:{u['id']}:me", f"user:{u['id']}:profile")
        cache_delete_pattern("students:list:*")
        cache_delete_pattern(f"student:{student_id}:*")
        cache_delete("admin:dashboard:summary")
        return {"deleted": student_id}
    finally: conn.close()

@app.patch("/admin/students/{student_id}")
def update_student(student_id: str, body: StudentUpdateRequest, _=Depends(require_roles("admin"))):
    values = body.model_dump()
    values = {key: value.strip() if isinstance(value, str) else value for key, value in values.items()}
    if not values["name"]:
        raise HTTPException(422, "Student name is required")
    if values["date_of_birth"]:
        try:
            date.fromisoformat(values["date_of_birth"])
        except ValueError as exc:
            raise HTTPException(422, "date_of_birth must use YYYY-MM-DD") from exc
    # Use typed NULL parameters for cleared fields. Passing empty strings into
    # NULLIF expressions can leave PostgreSQL to infer the wrong type (most
    # notably for the DATE column), causing the whole transaction to fail.
    for key in ("email", "phone", "date_of_birth", "program", "department", "semester", "gpa", "enrollment_year", "roll_number"):
        if values[key] == "":
            values[key] = None
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""UPDATE students SET name=%s,email=%s,phone=%s,date_of_birth=%s,
                         program=%s,department=%s,semester=%s,gpa=%s,
                         enrollment_year=%s,roll_number=%s
                         WHERE student_id=%s RETURNING student_id,name,email,phone,date_of_birth,program,department,semester,gpa,enrollment_year,roll_number""",
                        (values["name"], values["email"], values["phone"], values["date_of_birth"], values["program"], values["department"], values["semester"], values["gpa"], values["enrollment_year"], values["roll_number"], student_id))
            row = cur.fetchone()
            if not row: raise HTTPException(404, "Student not found")
            cur.execute("UPDATE users SET display_name=%s,email=%s,phone=%s WHERE student_id=%s", (values["name"], values["email"], values["phone"], student_id))
        conn.commit()
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE student_id=%s", (student_id,))
            u = cur.fetchone()
            if u:
                cache_delete(f"user:{u['id']}:me", f"user:{u['id']}:profile")
        cache_delete_pattern(f"student:{student_id}:*")
        cache_delete_pattern("students:list:*")
        return row
    finally: conn.close()

@app.patch("/student/profile")
def update_own_student_profile(name: str = Form(...), email: str = Form(""), phone: str = Form(""), date_of_birth: str = Form(""), program: str = Form(""), department: str = Form(""), semester: str = Form(""), gpa: str = Form(""), enrollment_year: str = Form(""), roll_number: str = Form(""), user=Depends(require_roles("student"))):
    student_id = user.get("student_id")
    if not student_id:
        raise HTTPException(422, "Student account is not linked to a student profile")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""UPDATE students SET name=%s,email=NULLIF(%s,''),phone=NULLIF(%s,''),date_of_birth=NULLIF(%s,''),
                         program=NULLIF(%s,''),department=NULLIF(%s,''),semester=NULLIF(%s,''),gpa=NULLIF(%s,''),
                         enrollment_year=NULLIF(%s,''),roll_number=NULLIF(%s,'')
                         WHERE student_id=%s RETURNING student_id,name,email,phone,date_of_birth,program,department,semester,gpa,enrollment_year,roll_number""",
                        (name.strip(), email, phone, date_of_birth, program, department, semester, gpa, enrollment_year, roll_number, student_id))
            row = cur.fetchone()
            if not row: raise HTTPException(404, "Student profile not found")
            cur.execute("UPDATE users SET display_name=%s,email=NULLIF(%s,''),phone=NULLIF(%s,'') WHERE id=%s", (name.strip(), email, phone, user["sub"]))
        conn.commit()
        cache_delete_pattern(f"student:{student_id}:*")
        cache_delete_pattern("students:list:*")
        cache_delete(f"user:{user['sub']}:me", f"user:{user['sub']}:profile")
        return row
    finally: conn.close()

@app.post("/register-student")
async def register_student(
    student_id: str = Form(...),
    name: str = Form(...),
    password: str = Form("welcome123"),
    email: str = Form(""),
    phone: str = Form(""),
    date_of_birth: str = Form(""),
    program: str = Form(""),
    department: str = Form(""),
    semester: str = Form(""),
    roll_number: str = Form(""),
    section_id: int | None = Form(None),
    files: list[UploadFile] = File(default=[]),
    file: UploadFile | None = File(default=None),
    user=Depends(require_roles("admin", "teacher"))
):
    upload_list = [f for f in files if hasattr(f, "read")] if files else []
    if file and hasattr(file, "read"):
        upload_list.append(file)
    files = upload_list
    student_id, name = student_id.strip(), name.strip()
    if not student_id or not name:
        raise HTTPException(422, "student_id and name are required")
    phone = phone.strip()
    # Default student password is dsvv@123# with mandatory reset on first login
    password = DEFAULT_STUDENT_PASSWORD
    if not (1 <= len(files) <= 5):
        raise HTTPException(422, "Registration requires between 1 and 5 photos")
    if date_of_birth:
        try:
            date.fromisoformat(date_of_birth)
        except ValueError as exc:
            raise HTTPException(422, "date_of_birth must use YYYY-MM-DD") from exc
    embeddings = []
    first_image_bytes = None
    for position, upload in enumerate(files, 1):
        raw_bytes = await upload.read()
        if position == 1:
            first_image_bytes = raw_bytes
        image = read_image_bytes(raw_bytes)
        detected = await detect(image)
        faces = confident_faces(detected, minimum_confidence=0.30)
        if not faces and detected:
            faces = detected
        faces = primary_face(image, faces)
        if len(faces) != 1:
            raise HTTPException(400, f"Photo {position}: Could not detect a clear face. Found {len(faces)} faces in frame. Please ensure your face is clearly visible to the camera.")
        face = faces[0]
        if not hasattr(face, "embedding") or face.embedding is None:
            raise HTTPException(400, f"Photo {position}: Could not extract facial features. Please retake the photo.")
        vector = np.asarray(face.embedding, dtype=np.float32)
        if vector.shape != (512,) or not np.isfinite(vector).all():
            logger.error("invalid_embedding student_id=%s photo=%s shape=%s", student_id, position, vector.shape)
            raise HTTPException(500, "Face model returned an invalid embedding; please retry the capture")
        vector /= max(np.linalg.norm(vector), 1e-12)
        embeddings.append(vector)
    # Average normalized embeddings so small changes in pose/expression are
    # represented by one stable identity vector.
    embedding = np.mean(np.stack(embeddings), axis=0)
    embedding /= max(np.linalg.norm(embedding), 1e-12)
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            if section_id is not None:
                if user["role"] == "teacher":
                    cur.execute("SELECT 1 FROM teacher_assignments WHERE teacher_user_id=%s AND section_id=%s", (user["sub"], section_id))
                else:
                    cur.execute("SELECT 1 FROM academic_sections WHERE id=%s", (section_id,))
                if not cur.fetchone():
                    # If section exists in catalog, allow registration
                    cur.execute("SELECT 1 FROM academic_sections WHERE id=%s", (section_id,))
                    if not cur.fetchone():
                        raise HTTPException(403, "You are not allowed to register a student in this academic section")
            rel_photo_path = None
            thumb = None
            if first_image_bytes:
                try:
                    rel_photo_path, _ = save_student_photo(student_id, name, first_image_bytes)
                except Exception as exc:
                    logger.warning("save_student_photo failed during register_student: %s", exc)
                try:
                    thumb = student_photo_data_uri(first_image_bytes)
                except Exception as exc:
                    logger.warning("student_photo_data_uri failed during register_student: %s", exc)

            cur.execute("""INSERT INTO students (student_id, name, email, phone, date_of_birth, program, department, semester, roll_number, section_id, profile_photo, profile_picture, profile_photo_thumbnail)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (student_id) DO UPDATE SET
                    name=EXCLUDED.name,
                    email=COALESCE(EXCLUDED.email, students.email),
                    phone=COALESCE(EXCLUDED.phone, students.phone),
                    date_of_birth=COALESCE(EXCLUDED.date_of_birth, students.date_of_birth),
                    program=COALESCE(EXCLUDED.program, students.program),
                    department=COALESCE(EXCLUDED.department, students.department),
                    semester=COALESCE(EXCLUDED.semester, students.semester),
                    roll_number=COALESCE(EXCLUDED.roll_number, students.roll_number),
                    section_id=COALESCE(EXCLUDED.section_id, students.section_id),
                    profile_photo=COALESCE(EXCLUDED.profile_photo, students.profile_photo),
                    profile_picture=COALESCE(EXCLUDED.profile_picture, students.profile_picture),
                    profile_photo_thumbnail=COALESCE(EXCLUDED.profile_photo_thumbnail, students.profile_photo_thumbnail)""",
                (student_id, name, email or None, phone or None, date_of_birth or None, program or None, department or None, semester or None, roll_number or None, section_id, first_image_bytes, rel_photo_path, thumb))
            cur.execute("""INSERT INTO student_embeddings (student_id, embedding) VALUES (%s, %s)
                ON CONFLICT (student_id) DO UPDATE SET embedding=EXCLUDED.embedding""", (student_id, embedding.tolist()))
            # A student's ID is also their login ID. Registration creates or
            # refreshes the corresponding student account automatically.
            cur.execute("""INSERT INTO users (username, password_hash, role, student_id, display_name, profile_photo, profile_picture, must_reset_password, profile_photo_thumbnail)
                VALUES (%s, %s, 'student', %s, %s, %s, %s, TRUE, %s)
                ON CONFLICT (username) DO UPDATE SET
                    role='student',
                    student_id=EXCLUDED.student_id,
                    display_name=EXCLUDED.display_name,
                    profile_photo=COALESCE(EXCLUDED.profile_photo, users.profile_photo),
                    profile_picture=COALESCE(EXCLUDED.profile_picture, users.profile_picture),
                    profile_photo_thumbnail=COALESCE(EXCLUDED.profile_photo_thumbnail, users.profile_photo_thumbnail)""",
                (student_id, password_hash(password), student_id, name, first_image_bytes, rel_photo_path, thumb))
            cur.execute(
                """INSERT INTO audit_logs (actor_id, action, entity, entity_id, new_value)
                   VALUES (%s, 'STUDENT_FACE_REGISTERED', 'student', %s, %s)""",
                (user["sub"], student_id, json.dumps({"photos_used": len(embeddings), "embedding_dimensions": int(embedding.size)})),
            )
        conn.commit()
        cache_delete_pattern("students:list:*")
        cache_delete_pattern(f"student:{student_id}:*")
        cache_delete("admin:dashboard:summary")
    finally: conn.close()
    logger.info("student_face_registered student_id=%s photos=%s actor_id=%s", student_id, len(embeddings), user["sub"])
    return {"status": "success", "student_id": student_id, "photos_used": len(embeddings), "message": f"Student {name} registered with {len(embeddings)} face photo(s)"}

@app.post("/student/register-face")
async def student_register_face(
    files: list[UploadFile] = File(default=[]),
    file: UploadFile | None = File(default=None),
    user=Depends(require_roles("student"))
):
    upload_list = [f for f in files if hasattr(f, "read")] if files else []
    if file and hasattr(file, "read"):
        upload_list.append(file)
    files = upload_list
    student_id = user.get("student_id")
    if not student_id:
        raise HTTPException(422, "Student account is not linked to a student profile")
    if not (1 <= len(files) <= 5):
        raise HTTPException(422, "Please upload between 1 and 5 photos")
    embeddings = []
    first_image_bytes = None
    for position, upload in enumerate(files, 1):
        raw_bytes = await upload.read()
        if position == 1:
            first_image_bytes = raw_bytes
        image = read_image_bytes(raw_bytes)
        detected = await detect(image)
        faces = confident_faces(detected, minimum_confidence=0.30)
        if not faces and detected:
            faces = detected
        faces = primary_face(image, faces)
        if len(faces) != 1:
            raise HTTPException(400, f"Photo {position}: Could not detect a clear face in the photo. Please ensure your face is clearly visible in the camera frame.")
        face = faces[0]
        if not hasattr(face, "embedding") or face.embedding is None:
            raise HTTPException(400, f"Photo {position}: Could not extract facial features. Please retake the photo.")
        vector = np.asarray(face.embedding, dtype=np.float32)
        if vector.shape != (512,) or not np.isfinite(vector).all():
            raise HTTPException(500, "Face model returned an invalid embedding; please retry")
        vector /= max(np.linalg.norm(vector), 1e-12)
        embeddings.append(vector)

    embedding = np.mean(np.stack(embeddings), axis=0)
    embedding /= max(np.linalg.norm(embedding), 1e-12)

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""INSERT INTO student_embeddings (student_id, embedding) VALUES (%s, %s)
                ON CONFLICT (student_id) DO UPDATE SET embedding=EXCLUDED.embedding""", (student_id, embedding.tolist()))
            if first_image_bytes:
                rel_photo_path = None
                try:
                    cur.execute("SELECT name FROM students WHERE student_id=%s", (student_id,))
                    st_row = cur.fetchone()
                    st_name = st_row["name"] if st_row else None
                    rel_photo_path, _ = save_student_photo(student_id, st_name, first_image_bytes)
                except Exception as exc:
                    logger.warning("save_student_photo failed in student_register_face: %s", exc)
                if rel_photo_path:
                    cur.execute("UPDATE students SET profile_photo=%s, profile_picture=%s WHERE student_id=%s", (first_image_bytes, rel_photo_path, student_id))
                    cur.execute("UPDATE users SET profile_photo=%s, profile_picture=%s WHERE id=%s", (first_image_bytes, rel_photo_path, user["sub"]))
                else:
                    cur.execute("UPDATE students SET profile_photo=%s WHERE student_id=%s", (first_image_bytes, student_id))
                    cur.execute("UPDATE users SET profile_photo=%s WHERE id=%s", (first_image_bytes, user["sub"]))
            cur.execute(
                """INSERT INTO audit_logs (actor_id, action, entity, entity_id, new_value)
                   VALUES (%s, 'STUDENT_SELF_FACE_REGISTERED', 'student', %s, %s)""",
                (user["sub"], student_id, json.dumps({"photos_used": len(embeddings)})),
            )
        conn.commit()
        cache_delete_pattern(f"student:{student_id}:*")
        cache_delete_pattern("students:list:*")
        cache_delete(f"user:{user['sub']}:me", f"user:{user['sub']}:profile")
    finally:
        conn.close()
    return {"status": "success", "student_id": student_id, "photos_used": len(embeddings), "message": "Biometric face profile successfully registered!"}

@app.post("/process-group-attendance")
async def process_group_attendance(
    session_id: str = Form(...), section_id: int = Form(...), program: str = Form(...), semester: str = Form(...),
    section_ids: str | None = Form(None), idempotency_key: str | None = Form(None), files: list[UploadFile] = File(default=[]), file: UploadFile | None = File(default=None),
    user=Depends(require_roles("teacher")),
):
    """Process one bounded, retry-safe photo batch without changing its parent session's scope."""
    uploads = list(files or []) + ([file] if file is not None else [])
    session_id, program, semester = session_id.strip(), program.strip(), semester.strip()
    if not session_id or not program or not semester:
        raise HTTPException(422, "session_id, program, and semester are required")
    if not 1 <= len(uploads) <= MAX_BATCH_FILES:
        raise HTTPException(422, f"Upload between 1 and {MAX_BATCH_FILES} photographs per batch")
    if any(upload.content_type and upload.content_type.lower() not in {"image/jpeg", "image/jpg", "image/png", "image/webp"} for upload in uploads):
        raise HTTPException(422, "Only JPEG, PNG, and WebP photographs are supported")
    try:
        target_section_ids = list(dict.fromkeys(int(value) for value in json.loads(section_ids))) if section_ids else [section_id]
    except (TypeError, ValueError, json.JSONDecodeError):
        raise HTTPException(422, "section_ids must be a JSON list of section IDs")
    if not target_section_ids:
        raise HTTPException(422, "Select at least one academic section")

    # Pass canonical UUID text to psycopg2.  PostgreSQL coerces it to the UUID
    # column type, and this does not depend on the optional UUID adapter being
    # registered in each worker process.
    batch_id = str(uuid.uuid4())
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT status,section_id,academic_scope FROM attendance_sessions WHERE session_id=%s AND teacher_id=%s FOR UPDATE", (session_id, user["sub"]))
            session = cur.fetchone()
            if not session:
                raise HTTPException(404, "Attendance session not found or not owned by this teacher")
            if session["status"] not in {"DRAFT", "ACTIVE"}:
                raise HTTPException(409, f"Session is {session['status'].lower()} and cannot accept photographs")
            if not set(target_section_ids).issubset(session_section_ids(session)):
                raise HTTPException(403, "Selected sections are outside this attendance session")
            if len(session_section_ids(session)) == 1 and len(target_section_ids) == 1:
                cur.execute("SELECT section_id FROM teacher_assignments WHERE teacher_user_id=%s AND section_id = ANY(%s)", (user["sub"], target_section_ids))
                if {row["section_id"] for row in cur.fetchall()} != set(target_section_ids):
                    raise HTTPException(403, "You are not assigned to every selected program and semester")
            if idempotency_key:
                cur.execute("SELECT * FROM attendance_upload_batches WHERE session_id=%s AND idempotency_key=%s", (session_id, idempotency_key))
                previous = cur.fetchone()
                if previous:
                    if previous["status"] == "COMPLETED":
                        return {"session_id": session_id, "batch_id": str(previous["id"]), "status": "COMPLETED", "retry": True,
                                "recognized_count": previous["recognized_count"], "duplicate_count": previous["duplicate_count"], "unknown_faces": previous["unknown_faces"], "failed_files": previous["failed_files"]}
                    raise HTTPException(409, "This upload batch is already processing")
            cur.execute("""INSERT INTO attendance_upload_batches (id,session_id,submitted_by,section_id,program,semester,idempotency_key,total_files)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""", (batch_id, session_id, user["sub"], target_section_ids[0], program, semester, idempotency_key, len(uploads)))
            cur.execute("UPDATE attendance_sessions SET status='ACTIVE' WHERE session_id=%s", (session_id,))
            cur.execute("SELECT s.student_id, s.name, e.embedding FROM students s JOIN student_embeddings e USING (student_id) WHERE s.section_id = ANY(%s)", (target_section_ids,))
            roster = cur.fetchall()
        conn.commit()
    finally:
        conn.close()

    set_batch_progress(
        batch_id=batch_id,
        total_files=len(uploads),
        processed_files=0,
        status="PROCESSING",
    )

    known = np.asarray([embedding_array(row["embedding"]) for row in roster], dtype=np.float32) if roster else np.empty((0, 512), dtype=np.float32)
    if len(known): known /= np.maximum(np.linalg.norm(known, axis=1, keepdims=True), 1e-12)
    summary = {"total_faces_detected": 0, "recognized_count": 0, "duplicate_count": 0, "unknown_faces": 0, "failed_files": 0}
    students, photo_results = [], []
    for upload in uploads:
        photo_id, filename = str(uuid.uuid4()), (upload.filename or "photo").replace("/", "_").replace("\\", "_")[:255]
        try:
            raw = await upload.read()
            image = read_image_bytes(raw)
            faces = await detect(image)
            h, w = image.shape[:2]
            faces = [face for face in faces if float(getattr(face, "det_score", 0.0)) >= MIN_GROUP_FACE_CONFIDENCE and float(face.bbox[2] - face.bbox[0]) >= max(16, w * .008) and float(face.bbox[3] - face.bbox[1]) >= max(16, h * .008)]
            recognized, seen = [], set()
            for face in faces:
                query = np.asarray(face.embedding, dtype=np.float32); query /= max(np.linalg.norm(query), 1e-12)
                scores = known @ query if len(known) else np.empty(0)
                idx = int(np.argmax(scores)) if len(scores) else -1
                score = float(scores[idx]) if idx >= 0 else 0.0
                if idx >= 0 and score >= MATCH_THRESHOLD and roster[idx]["student_id"] not in seen:
                    seen.add(roster[idx]["student_id"])
                    recognized.append({"student_id": roster[idx]["student_id"], "name": roster[idx]["name"], "confidence": round(score, 4)})
            conn = get_db_connection()
            try:
                with conn.cursor() as cur:
                    newly_marked = 0
                    for student in recognized:
                        cur.execute("SELECT 1 FROM attendance_logs WHERE student_id=%s AND session_id=%s", (student["student_id"], session_id))
                        existed = bool(cur.fetchone())
                        cur.execute("""INSERT INTO attendance_logs (student_id,teacher_id,session_id,confidence_score,recognition_status,initial_attendance_status,final_attendance_status,attendance_method)
                            VALUES (%s,%s,%s,%s,'RECOGNIZED','PRESENT','PRESENT','FACE_RECOGNITION')
                            ON CONFLICT (student_id,session_id) DO UPDATE SET confidence_score=GREATEST(attendance_logs.confidence_score,EXCLUDED.confidence_score)""", (student["student_id"], user["sub"], session_id, student["confidence"]))
                        newly_marked += not existed
                    unknown = max(0, len(faces) - len(recognized))
                    cur.execute("""INSERT INTO attendance_batch_photos (id,batch_id,filename,status,faces_detected,recognized_count,unknown_faces)
                        VALUES (%s,%s,%s,'COMPLETED',%s,%s,%s)""", (photo_id, batch_id, filename, len(faces), len(recognized), unknown))
                conn.commit()
            finally: conn.close()
            summary["total_faces_detected"] += len(faces); summary["recognized_count"] += newly_marked; summary["duplicate_count"] += len(recognized) - newly_marked; summary["unknown_faces"] += unknown
            students.extend(recognized); photo_results.append({"id": str(photo_id), "filename": filename, "status": "COMPLETED", "faces_detected": len(faces), "recognized_count": len(recognized), "unknown_faces": unknown})
            update_batch_progress_step(
                batch_id=batch_id,
                processed_delta=1,
                recognized_delta=newly_marked,
                duplicate_delta=(len(recognized) - newly_marked),
                unknown_delta=unknown,
            )
            if newly_marked > 0:
                update_attendance_live_counters(
                    session_id=session_id,
                    present_delta=newly_marked,
                    absent_delta=-newly_marked,
                    recognized_delta=newly_marked,
                )
        except (HTTPException, ValueError, UnidentifiedImageError) as exc:
            message = getattr(exc, "detail", str(exc))
            summary["failed_files"] += 1; photo_results.append({"id": str(photo_id), "filename": filename, "status": "FAILED", "error": str(message)})
            conn = get_db_connection()
            try:
                with conn.cursor() as cur: cur.execute("INSERT INTO attendance_batch_photos (id,batch_id,filename,status,error_message) VALUES (%s,%s,%s,'FAILED',%s)", (photo_id, batch_id, filename, str(message)[:1000]))
                conn.commit()
            finally: conn.close()
            update_batch_progress_step(
                batch_id=batch_id,
                processed_delta=1,
                status="PROCESSING",
            )
        finally:
            await upload.close()
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""UPDATE attendance_upload_batches SET status='COMPLETED', processed_files=%s, recognized_count=%s, duplicate_count=%s, unknown_faces=%s, failed_files=%s, completed_at=CURRENT_TIMESTAMP WHERE id=%s""", (len(uploads), summary["recognized_count"], summary["duplicate_count"], summary["unknown_faces"], summary["failed_files"], batch_id))
        conn.commit()
    finally: conn.close()
    update_batch_progress_step(
        batch_id=batch_id,
        processed_delta=0,
        status="COMPLETED",
    )
    cache_delete(f"teacher:{user['sub']}:attendance-sessions")
    return {"session_id": session_id, "batch_id": str(batch_id), "status": "COMPLETED", **summary, "students": students, "photos": photo_results}

class FinalAttendanceRequest(BaseModel):
    session_id: str
    records: list[dict]

@app.post("/teacher/attendance/finalize")
def finalize_attendance(body: FinalAttendanceRequest, user=Depends(require_roles("teacher"))):
    if not body.records or any(row.get("status") not in ("PRESENT", "ABSENT") for row in body.records):
        raise HTTPException(422, "Please mark Present or Absent for every student.")

    with redis_lock(f"session_finalize:{body.session_id}", timeout_seconds=15.0):
        conn = get_db_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT section_id,academic_scope FROM attendance_sessions WHERE session_id=%s AND teacher_id=%s", (body.session_id, user["sub"]))
                session = cur.fetchone()
                if not session:
                    raise HTTPException(404, "Attendance session not found or not owned by this teacher")
                for row in body.records:
                    student_id, status = row.get("student_id"), row.get("status")
                    cur.execute("SELECT section_id FROM students WHERE student_id=%s", (student_id,))
                    student = cur.fetchone()
                    if not student or student["section_id"] not in session_section_ids(session):
                        raise HTTPException(403, "Student is outside this attendance session's selected hierarchy")
                    cur.execute("SELECT initial_attendance_status, recognition_status, confidence_score FROM attendance_logs WHERE student_id=%s AND session_id=%s", (student_id, body.session_id))
                    existing = cur.fetchone()
                    initial = existing["initial_attendance_status"] if existing else "ABSENT"
                    recognition = existing["recognition_status"] if existing else "NOT_RECOGNIZED"
                    confidence = existing["confidence_score"] if existing else 0
                    override = initial != status
                    cur.execute("""INSERT INTO attendance_logs (student_id, teacher_id, session_id, confidence_score, recognition_status, initial_attendance_status, final_attendance_status, attendance_method, is_manual_override, updated_by, updated_at)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,CURRENT_TIMESTAMP)
                        ON CONFLICT (student_id, session_id) DO UPDATE SET final_attendance_status=EXCLUDED.final_attendance_status, attendance_method=EXCLUDED.attendance_method, is_manual_override=EXCLUDED.is_manual_override, updated_by=EXCLUDED.updated_by, updated_at=CURRENT_TIMESTAMP""", (student_id, user["sub"], body.session_id, confidence, recognition, initial, status, "MANUAL_OVERRIDE" if override else "FACE_RECOGNITION", override, user["sub"]))
                    if override:
                        cur.execute("INSERT INTO audit_logs (actor_id, action, entity, entity_id, previous_value, new_value) VALUES (%s,'ATTENDANCE_MANUALLY_CHANGED','attendance',%s,%s,%s)", (user["sub"], f"{student_id}:{body.session_id}", json.dumps({"status": initial}), json.dumps({"status": status})))
            conn.commit()
            with conn.cursor() as cur:
                cur.execute("INSERT INTO notifications (user_id, category, title, body) VALUES (%s,'attendance','Attendance Confirmed',%s)", (user["sub"], f'Your submission for {body.session_id} was verified successfully.'))
            conn.commit()

            present_count = sum(1 for row in body.records if row.get("status") == "PRESENT")
            absent_count = len(body.records) - present_count
            set_attendance_live_status(body.session_id, "FINALIZED")
            update_attendance_live_counters(
                body.session_id,
                present_delta=present_count,
                absent_delta=absent_count,
            )

            cache_delete(f"teacher:{user['sub']}:attendance-sessions")
            cache_delete_pattern(f"attendance:session:{body.session_id}:*")
            cache_delete_pattern("student:*:attendance*")
            cache_delete_pattern("attendance:report:*")
            cache_delete("admin:attendance:all", "admin:dashboard:summary")
            return {"status": "submitted", "session_id": body.session_id, "records_processed": len(body.records)}
        finally:
            conn.close()

@app.get("/attendance/{session_id}")
def session_attendance(session_id: str, user=Depends(require_roles("admin", "teacher", "faculty"))):
    role = normalize_role(user["role"])
    session_id = session_id.strip()

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT teacher_id, section_id, academic_scope FROM attendance_sessions WHERE session_id=%s", (session_id,))
            session = cur.fetchone()
            if not session:
                raise HTTPException(404, "Attendance session not found")

            sec_ids = session_section_ids(session)
            if role == "faculty":
                is_owner = session["teacher_id"] == user["sub"]
                if not is_owner:
                    cur.execute("""
                        SELECT 1 FROM teacher_assignments
                        WHERE teacher_user_id = %s AND section_id = ANY(%s)
                    """, (user["sub"], sec_ids))
                    if not cur.fetchone():
                        raise HTTPException(403, "You are not authorized to view this attendance session")

            cache_key = f"attendance:session:{session_id}:roster"
            cached = cache_get(cache_key)
            if cached is not None:
                return cached

            cur.execute("""SELECT st.student_id, st.name, st.email, st.phone, st.program,
                COALESCE(st.semester, sec.semester) AS semester,
                COALESCE(st.department, sec.department) AS department,
                st.date_of_birth, st.roll_number,
                st.profile_picture,
                a.confidence_score, a.timestamp,
                COALESCE(a.final_attendance_status, a.initial_attendance_status, 'ABSENT') AS status,
                COALESCE(a.is_manual_override, FALSE) AS is_manual_override
                FROM attendance_sessions sess
                JOIN students st ON st.section_id = ANY(%s)
                LEFT JOIN academic_sections sec ON sec.id=st.section_id
                LEFT JOIN attendance_logs a ON a.session_id=sess.session_id AND a.student_id=st.student_id
                WHERE sess.session_id=%s ORDER BY st.name""", (sec_ids, session_id))
            students = cur.fetchall()
            for student in students:
                student["student_name"] = student.get("name")
                student["attendance_status"] = student.get("status")
                pic = student.get("profile_picture")
                if pic:
                    student["profile_picture"] = f"/student-photos/{Path(pic).name}"
                else:
                    student["profile_picture"] = None
                student["profile_photo_base64"] = None
            res = {"session_id": session_id, "students": students}
            cache_set(cache_key, res, ttl=30)
            return res
    finally: conn.close()

class SessionExportRequest(BaseModel):
    report_type: str = "detailed_pdf"
    attendance_status: str = "both"
    course_id: str | None = None

def get_session_and_verify_export_permission(session_id: str, user: dict, cur):
    cur.execute("SELECT sess.* FROM attendance_sessions sess WHERE sess.session_id=%s", (session_id,))
    session = cur.fetchone()
    if not session:
        raise HTTPException(404, "Attendance session not found")

    role = normalize_role(user.get("role", ""))
    if role not in {"admin", "faculty"}:
        raise HTTPException(403, "Students are not permitted to export session attendance reports")

    sec_ids = session_section_ids(session)
    if role == "faculty":
        is_owner = session["teacher_id"] == user["sub"]
        if not is_owner:
            cur.execute("""
                SELECT 1 FROM teacher_assignments
                WHERE teacher_user_id = %s AND section_id = ANY(%s)
            """, (user["sub"], sec_ids))
            if not cur.fetchone():
                raise HTTPException(403, "You are not authorized to export this attendance session")
    return session, sec_ids

def fetch_session_export_data(cur, session: dict, sec_ids: list[int], course_filter: str | None, status_filter: str):
    norm_status = (status_filter or "both").lower().strip()
    if norm_status not in {"present", "absent", "both"}:
        raise HTTPException(422, "attendance_status must be one of: 'present', 'absent', 'both'")

    session_id = session["session_id"]
    cur.execute("""
        SELECT DISTINCT st.student_id, st.name, st.roll_number, st.phone, st.email,
            COALESCE(NULLIF(sec.school, ''), NULLIF(sec_lookup.school, ''), NULLIF(%s, ''), 'School Not Specified') AS school,
            COALESCE(NULLIF(sec.faculty, ''), NULLIF(sec_lookup.faculty, ''), NULLIF(%s, ''), 'Faculty Not Specified') AS faculty,
            COALESCE(NULLIF(st.department, ''), NULLIF(sec.department, ''), NULLIF(sec_lookup.department, ''), NULLIF(%s, ''), 'Department Not Specified') AS department,
            COALESCE(NULLIF(st.program, ''), NULLIF(sec.program, ''), NULLIF(sec_lookup.program, ''), NULLIF(%s, ''), 'Course Not Specified') AS program,
            COALESCE(NULLIF(st.semester, ''), NULLIF(sec.semester, ''), NULLIF(sec_lookup.semester, ''), NULLIF(%s, ''), 'Semester Not Specified') AS semester,
            COALESCE(sec.section, sec_lookup.section, '') AS section,
            st.profile_photo,
            COALESCE(a.final_attendance_status, a.initial_attendance_status, 'ABSENT') AS status,
            COALESCE(a.is_manual_override, FALSE) AS is_manual_override
        FROM students st
        LEFT JOIN academic_sections sec ON sec.id = st.section_id
        LEFT JOIN LATERAL (
            SELECT school, faculty, department, program, semester, section
            FROM academic_sections
            WHERE program = st.program AND (semester = st.semester OR st.semester IS NULL)
            LIMIT 1
        ) sec_lookup ON st.section_id IS NULL
        LEFT JOIN attendance_logs a ON a.session_id = %s AND a.student_id = st.student_id
        WHERE (st.section_id = ANY(%s) OR a.session_id = %s)
        ORDER BY st.name ASC, st.student_id ASC
    """, (
        session.get("school") or "",
        session.get("faculty") or "",
        session.get("department") or "",
        session.get("program") or "",
        session.get("semester") or "",
        session_id,
        sec_ids or [-1],
        session_id,
    ))
    all_students = cur.fetchall()

    total_eligible = len(all_students)
    present_count = sum(1 for s in all_students if str(s["status"]).upper() == "PRESENT")
    absent_count = total_eligible - present_count

    summary = {
        "total_students": total_eligible,
        "present_students": present_count,
        "absent_students": absent_count,
    }

    # Course filter
    filtered = all_students
    if course_filter and course_filter.lower() not in {"all", "all courses", "all courses / groups"}:
        c_clean = course_filter.lower().strip()
        filtered = [
            s for s in filtered
            if c_clean in (s.get("program") or "").lower()
            or c_clean in (s.get("department") or "").lower()
            or c_clean == (session.get("course") or "").lower()
        ]

    # Status filter
    if norm_status == "present":
        filtered = [s for s in filtered if str(s["status"]).upper() == "PRESENT"]
    elif norm_status == "absent":
        filtered = [s for s in filtered if str(s["status"]).upper() == "ABSENT"]

    return filtered, summary

def handle_session_export(
    session_id: str,
    report_type: str,
    attendance_status: str,
    course_id: str | None,
    user: dict,
) -> Response:
    norm_report = (report_type or "detailed_pdf").lower().strip()
    norm_status = (attendance_status or "both").lower().strip()

    if norm_report not in {"face_pdf", "face", "detailed_pdf", "detailed", "text_pdf", "text"}:
        raise HTTPException(422, "report_type must be one of: 'face_pdf', 'detailed_pdf', 'text_pdf'")

    if norm_status not in {"present", "absent", "both"}:
        raise HTTPException(422, "attendance_status must be one of: 'present', 'absent', 'both'")

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            session, sec_ids = get_session_and_verify_export_permission(session_id, user, cur)
            students, summary = fetch_session_export_data(
                cur, session, sec_ids, course_filter=course_id, status_filter=norm_status
            )
            if not students:
                raise HTTPException(
                    422, "No students match the selected course and attendance filter criteria."
                )

            pdf_bytes, filename = build_session_attendance_pdf(
                session=session,
                students=students,
                summary=summary,
                report_type=norm_report,
                status_filter=norm_status,
                course_filter=course_id,
            )

            return Response(
                content=pdf_bytes,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "Content-Type": "application/pdf",
                    "X-Filename": filename,
                },
            )
    finally:
        conn.close()

@app.get("/attendance/sessions/{session_id}/export-options")
@app.get("/api/attendance/sessions/{session_id}/export-options")
def get_session_export_options(session_id: str, user=Depends(require_roles("admin", "teacher", "faculty"))):
    """Retrieve available academic courses, session metadata, and counts for export configuration."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            session, sec_ids = get_session_and_verify_export_permission(session_id, user, cur)
            all_students, summary = fetch_session_export_data(cur, session, sec_ids, course_filter=None, status_filter="both")

            courses = [{"id": "all", "label": "All Courses / Groups"}]
            if session.get("course"):
                courses.append({"id": session["course"], "label": f"{session['course']} (Course)"})

            if sec_ids:
                cur.execute("""
                    SELECT DISTINCT program, section, semester
                    FROM academic_sections
                    WHERE id = ANY(%s)
                """, (sec_ids,))
                sec_rows = cur.fetchall()
                for r in sec_rows:
                    prog = r.get("program")
                    if prog and not any(c["id"] == prog for c in courses):
                        courses.append({"id": prog, "label": f"{prog} ({r.get('section', 'Sec')})"})

            return {
                "session": {
                    "session_id": session["session_id"],
                    "title": session["title"],
                    "course": session["course"],
                    "event_date": str(session["event_date"]),
                    "starts_at": str(session["starts_at"])[:5],
                    "ends_at": str(session["ends_at"])[:5],
                    "room": session.get("room") or "—",
                    "school": session.get("school"),
                    "faculty": session.get("faculty"),
                    "department": session.get("department"),
                    "program": session.get("program"),
                    "semester": session.get("semester"),
                    "status": session.get("status", "ACTIVE"),
                },
                "courses": courses,
                "summary": summary,
                "report_types": [
                    {
                        "id": "face_pdf",
                        "title": "OPTION A: Course-Wise Student Face PDF",
                        "description": "Visual grid layout containing student facial photographs, names, and scholar numbers organized by course.",
                        "button_label": "Generate Face PDF",
                    },
                    {
                        "id": "detailed_pdf",
                        "title": "OPTION B: Complete Student Details PDF",
                        "description": "Comprehensive printable tabular report with student photos, scholar numbers, names, contact numbers, and attendance status.",
                        "button_label": "Generate Detailed PDF",
                    },
                    {
                        "id": "text_pdf",
                        "title": "OPTION C: Student Text-Only Report",
                        "description": "Clean, lightweight textual report containing scholar numbers, names, mobile numbers, and attendance status without biometric photos.",
                        "button_label": "Generate Text Report",
                    },
                ],
            }
    finally:
        conn.close()

@app.get("/attendance/sessions/{session_id}/export-summary")
@app.get("/api/attendance/sessions/{session_id}/export-summary")
def get_session_export_summary(
    session_id: str,
    course_id: str | None = Query(default=None),
    attendance_status: str = Query(default="both"),
    user=Depends(require_roles("admin", "teacher", "faculty")),
):
    """Retrieve pre-export summary counts reflecting the active course and status filters."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            session, sec_ids = get_session_and_verify_export_permission(session_id, user, cur)
            filtered, summary = fetch_session_export_data(cur, session, sec_ids, course_filter=course_id, status_filter=attendance_status)
            return {
                "session_id": session_id,
                "total_eligible": summary["total_students"],
                "present_students": summary["present_students"],
                "absent_students": summary["absent_students"],
                "records_included": len(filtered),
            }
    finally:
        conn.close()

@app.post("/attendance/sessions/{session_id}/export")
@app.post("/api/attendance/sessions/{session_id}/export")
def export_session_post(
    session_id: str,
    body: SessionExportRequest,
    user=Depends(require_roles("admin", "teacher", "faculty")),
):
    return handle_session_export(
        session_id=session_id,
        report_type=body.report_type,
        attendance_status=body.attendance_status,
        course_id=body.course_id,
        user=user,
    )

@app.get("/attendance/sessions/{session_id}/export")
@app.get("/api/attendance/sessions/{session_id}/export")
def export_session_get(
    session_id: str,
    report_type: str = Query(default="detailed_pdf"),
    attendance_status: str = Query(default="both"),
    course_id: str | None = Query(default=None),
    user=Depends(require_roles("admin", "teacher", "faculty")),
):
    return handle_session_export(
        session_id=session_id,
        report_type=report_type,
        attendance_status=attendance_status,
        course_id=course_id,
        user=user,
    )

@app.post("/attendance/sessions/{session_id}/export/face-pdf")
@app.get("/attendance/sessions/{session_id}/export/face-pdf")
def export_session_face_pdf(
    session_id: str,
    attendance_status: str = Query(default="both"),
    course_id: str | None = Query(default=None),
    user=Depends(require_roles("admin", "teacher", "faculty")),
):
    return handle_session_export(session_id, "face_pdf", attendance_status, course_id, user)

@app.post("/attendance/sessions/{session_id}/export/detailed-pdf")
@app.get("/attendance/sessions/{session_id}/export/detailed-pdf")
def export_session_detailed_pdf(
    session_id: str,
    attendance_status: str = Query(default="both"),
    course_id: str | None = Query(default=None),
    user=Depends(require_roles("admin", "teacher", "faculty")),
):
    return handle_session_export(session_id, "detailed_pdf", attendance_status, course_id, user)

@app.post("/attendance/sessions/{session_id}/export/text-pdf")
@app.get("/attendance/sessions/{session_id}/export/text-pdf")
def export_session_text_pdf(
    session_id: str,
    attendance_status: str = Query(default="both"),
    course_id: str | None = Query(default=None),
    user=Depends(require_roles("admin", "teacher", "faculty")),
):
    return handle_session_export(session_id, "text_pdf", attendance_status, course_id, user)

@app.get("/attendance/{session_id}/pdf")
def export_session_attendance_pdf(
    session_id: str,
    report_type: str = Query(default="detailed_pdf"),
    attendance_status: str = Query(default="both"),
    course_id: str | None = Query(default=None),
    user=Depends(require_roles("admin", "teacher", "faculty")),
):
    """Backward-compatible endpoint: delegates to modular PDF export handler."""
    return handle_session_export(session_id, report_type, attendance_status, course_id, user)

@app.patch("/attendance/{session_id}/{student_id}")
def update_session_attendance(session_id: str, student_id: str, body: dict, user=Depends(require_roles("admin", "teacher", "faculty"))):
    role = normalize_role(user["role"])
    status = str(body.get("status", "")).upper()
    if status not in {"PRESENT", "ABSENT"}:
        raise HTTPException(422, "Status must be PRESENT or ABSENT")
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT section_id, academic_scope, teacher_id, status FROM attendance_sessions WHERE session_id=%s", (session_id,))
            session = cur.fetchone()
            if not session:
                raise HTTPException(404, "Attendance session not found")
            if role == "faculty" and session["teacher_id"] != user["sub"]:
                raise HTTPException(403, "You are not authorized to modify attendance for this session")
            if session["status"] == "COMPLETED" and role == "faculty":
                raise HTTPException(409, "Reopen the session before changing attendance")
            cur.execute("SELECT section_id FROM students WHERE student_id=%s", (student_id,))
            student = cur.fetchone()
            if not student or student["section_id"] not in session_section_ids(session):
                raise HTTPException(403, "Student is outside this attendance session's selected hierarchy")
            cur.execute("SELECT initial_attendance_status, COALESCE(final_attendance_status, initial_attendance_status, 'ABSENT') AS current FROM attendance_logs WHERE session_id=%s AND student_id=%s", (session_id, student_id))
            previous = cur.fetchone()
            old_status = previous["current"] if previous else "ABSENT"
            cur.execute("""INSERT INTO attendance_logs
                (student_id, session_id, teacher_id, confidence_score, recognition_status,
                 initial_attendance_status, final_attendance_status, attendance_method,
                 is_manual_override, updated_by, updated_at)
                VALUES (%s,%s,%s,0,'MANUAL',%s,%s,'MANUAL_OVERRIDE',TRUE,%s,CURRENT_TIMESTAMP)
                ON CONFLICT (student_id, session_id) DO UPDATE SET
                  final_attendance_status=EXCLUDED.final_attendance_status,
                  attendance_method='MANUAL_OVERRIDE', is_manual_override=TRUE,
                  updated_by=EXCLUDED.updated_by, updated_at=CURRENT_TIMESTAMP""",
                (student_id, session_id, user["sub"], old_status, status, user["sub"]))
            cur.execute("INSERT INTO audit_logs (actor_id, action, entity, entity_id, previous_value, new_value) VALUES (%s,'ATTENDANCE_MANUALLY_CHANGED','attendance',%s,%s,%s)", (user["sub"], f"{student_id}:{session_id}", json.dumps({"status": old_status}), json.dumps({"status": status})))
        conn.commit()

        if old_status != status:
            if status == "PRESENT":
                update_attendance_live_counters(session_id, present_delta=1, absent_delta=-1)
            elif old_status == "PRESENT":
                update_attendance_live_counters(session_id, present_delta=-1, absent_delta=1)

        cache_delete_pattern(f"attendance:session:{session_id}:*")
        cache_delete_pattern(f"attendance:student:{student_id}:*")
        cache_delete_pattern(f"student:{student_id}:*")
        cache_delete_pattern("teacher:*:attendance-sessions")
        cache_delete_pattern("attendance:report:*")
        cache_delete("admin:attendance:all", "admin:dashboard:summary")
        return {"session_id": session_id, "student_id": student_id, "status": status}
    finally:
        conn.close()

@app.get("/teacher/attendance/report")
def teacher_attendance_report(
    month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    date: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    _=Depends(require_roles("admin", "teacher")),
):
    if month and date: raise HTTPException(422, "Use either month or date, not both")
    cache_key = f"attendance:report:m={month}:d={date}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            conditions, values = [], []
            if month: conditions.append("a.timestamp >= to_date(%s, 'YYYY-MM') AND a.timestamp < (to_date(%s, 'YYYY-MM') + interval '1 month')"); values += [month, month]
            if date: conditions.append("a.timestamp::date = %s::date"); values.append(date)
            where = " WHERE " + " AND ".join(conditions) if conditions else ""
            cur.execute(f"SELECT a.id, a.session_id, a.student_id, s.name, a.confidence_score, a.timestamp, sess.title, sess.course, sess.event_date, sess.starts_at, sess.ends_at FROM attendance_logs a JOIN students s USING (student_id) JOIN attendance_sessions sess USING (session_id){where} ORDER BY a.timestamp DESC, s.name", values)
            records = cur.fetchall()
            cur.execute(f"SELECT a.student_id, s.name, COUNT(*) AS days_present, MIN(a.timestamp) AS first_attendance, MAX(a.timestamp) AS last_attendance FROM attendance_logs a JOIN students s USING (student_id){where} GROUP BY a.student_id, s.name ORDER BY s.name", values)
            by_student = cur.fetchall()
            res = {"filter": {"month": month, "date": date}, "totals": {"attendance_records": len(records), "students_present": len(by_student), "sessions": len({row['session_id'] for row in records})}, "by_student": by_student, "records": records}
            cache_set(cache_key, res, ttl=60)
            return res
    finally: conn.close()

@app.get("/student/attendance")
def own_attendance(
    page: int | None = Query(default=None, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status: str | None = Query(default=None),
    user=Depends(require_roles("student")),
):
    student_id = user.get("student_id")
    if not student_id:
        raise HTTPException(422, "Student account is not linked to a student")

    status_filter = status.upper().strip() if status else None
    cache_key = f"student:{student_id}:attendance:logs:p={page}:ps={page_size}:st={status_filter}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            conditions = ["a.student_id = %s"]
            params = [student_id]
            if status_filter in {"PRESENT", "ABSENT"}:
                conditions.append("COALESCE(a.final_attendance_status, a.initial_attendance_status) = %s")
                params.append(status_filter)

            where_clause = " WHERE " + " AND ".join(conditions)

            count_query = f"SELECT COUNT(*) AS total FROM attendance_logs a{where_clause}"
            cur.execute(count_query, params)
            total_items = cur.fetchone()["total"]

            total_pages = (total_items + page_size - 1) // page_size if total_items > 0 else 0
            limit_clause = ""
            if page is not None:
                offset = (page - 1) * page_size
                limit_clause = f" LIMIT {page_size} OFFSET {offset}"

            data_query = f"""
                SELECT a.session_id, a.confidence_score, a.timestamp,
                       COALESCE(a.final_attendance_status, a.initial_attendance_status) AS status,
                       sess.title, sess.course, sess.event_date, sess.starts_at, sess.ends_at
                FROM attendance_logs a
                LEFT JOIN attendance_sessions sess ON sess.session_id = a.session_id
                {where_clause}
                ORDER BY a.timestamp DESC
                {limit_clause}
            """
            cur.execute(data_query, params)
            records = cur.fetchall()

            current_page = page if page is not None else 1
            res = {
                "student_id": student_id,
                "attendance": records,
                "items": records,
                "pagination": {
                    "page": current_page,
                    "page_size": page_size if page is not None else len(records),
                    "total_items": total_items,
                    "total_pages": total_pages if page is not None else 1,
                    "has_next": current_page < total_pages if page is not None else False,
                    "has_previous": current_page > 1 if page is not None else False,
                },
            }
            cache_set(cache_key, res, ttl=60)
            return res
    finally:
        conn.close()

@app.get("/student/attendance/overview")
def own_attendance_overview(user=Depends(require_roles("student"))):
    if not user.get("student_id"): raise HTTPException(422, "Student account is not linked to a student")
    cache_key = f"student:{user['student_id']}:attendance:overview"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT s.student_id, s.name, s.created_at, u.username FROM students s JOIN users u ON u.student_id=s.student_id WHERE s.student_id=%s", (user["student_id"],)); profile = cur.fetchone()
            cur.execute("""SELECT s.session_id, s.title, s.course, s.school, s.faculty, s.department,
                s.program, s.semester, s.room, s.event_date, s.starts_at, s.ends_at, s.notes,
                COALESCE(a.final_attendance_status, a.initial_attendance_status, 'ABSENT') AS status,
                a.timestamp AS marked_at
                FROM attendance_sessions s
                LEFT JOIN attendance_logs a ON a.session_id=s.session_id AND a.student_id=%s
                WHERE a.student_id IS NOT NULL
                   OR EXISTS (
                       SELECT 1 FROM students st
                       WHERE st.student_id=%s AND (
                           st.section_id = s.section_id
                           OR (CASE WHEN jsonb_typeof(s.academic_scope->'section_ids') = 'array'
                               THEN ((s.academic_scope->'section_ids') @> to_jsonb(st.section_id) OR (s.academic_scope->'section_ids') ? (st.section_id::text))
                               ELSE FALSE END)
                       )
                   )
                ORDER BY s.event_date DESC, s.starts_at DESC""", (user["student_id"], user["student_id"]))
            attendance = cur.fetchall()
            present = sum(1 for row in attendance if str(row["status"]).upper() == "PRESENT")
            res = {"profile": profile, "attendance": attendance, "subjects": attendance, "summary": {"present": present, "absent": len(attendance) - present, "overall_percentage": round(present / len(attendance) * 100, 1) if attendance else 0}}
            cache_set(cache_key, res, ttl=60)
            return res
    finally: conn.close()

@app.delete("/admin/attendance/{session_id}")
def delete_session(session_id: str, _=Depends(require_roles("admin"))):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur: cur.execute("DELETE FROM attendance_logs WHERE session_id=%s", (session_id,)); count = cur.rowcount
        conn.commit()
        delete_attendance_live_state(session_id)
        cache_delete_pattern(f"attendance:session:{session_id}:*")
        cache_delete_pattern("student:*:attendance*")
        cache_delete_pattern("teacher:*:attendance-sessions")
        cache_delete("admin:attendance:all", "admin:dashboard:summary")
        return {"deleted_records": count, "session_id": session_id}
    finally: conn.close()

@app.get("/admin/dashboard")
@app.get("/admin/stats")
def get_admin_dashboard(_=Depends(require_roles("admin"))):
    """Ultra-fast aggregated metrics for the campus administration dashboard.
    Cached in Redis for high throughput and sub-millisecond response time.
    """
    cache_key = "admin:dashboard:summary"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    (SELECT COUNT(*) FROM students) AS total_students,
                    (SELECT COUNT(*) FROM users WHERE role = 'teacher') AS faculty_count,
                    (SELECT COUNT(*) FROM users) AS total_users,
                    (SELECT COUNT(*) FROM attendance_sessions) AS total_sessions,
                    (SELECT COUNT(*) FROM attendance_logs) AS total_attendance_logs,
                    (SELECT COUNT(*) FROM attendance_logs WHERE COALESCE(final_attendance_status, initial_attendance_status) = 'PRESENT') AS present_count
            """)
            counts = cur.fetchone() or {}
            total_students = counts.get("total_students") or 0
            faculty_count = counts.get("faculty_count") or 0
            total_sessions = counts.get("total_sessions") or 0
            total_logs = counts.get("total_attendance_logs") or 0
            present_count = counts.get("present_count") or 0
            attendance_rate = round((present_count / total_logs) * 100) if total_logs > 0 else 0

            cur.execute("""
                SELECT sess.session_id, sess.title, sess.course, sess.event_date,
                       sess.starts_at, sess.ends_at, sess.status,
                       u.display_name AS teacher_name,
                       (SELECT COUNT(*) FROM attendance_logs a WHERE a.session_id = sess.session_id AND COALESCE(a.final_attendance_status, a.initial_attendance_status) = 'PRESENT') AS present_count
                FROM attendance_sessions sess
                LEFT JOIN users u ON u.id = sess.teacher_id
                ORDER BY sess.event_date DESC, sess.starts_at DESC
                LIMIT 5
            """)
            recent_sessions = [dict(r) for r in cur.fetchall()]
            for s in recent_sessions:
                if s.get("event_date"):
                    s["event_date"] = str(s["event_date"])
                if s.get("starts_at"):
                    s["starts_at"] = str(s["starts_at"])
                if s.get("ends_at"):
                    s["ends_at"] = str(s["ends_at"])

            res = {
                "total_students": total_students,
                "faculty_count": faculty_count,
                "total_users": counts.get("total_users") or 0,
                "total_sessions": total_sessions,
                "attendance_rate": attendance_rate,
                "present_count": present_count,
                "total_attendance_logs": total_logs,
                "recent_sessions": recent_sessions,
            }
            cache_set(cache_key, res, ttl=30)
            return res
    finally:
        conn.close()

@app.get("/admin/attendance")
def all_attendance(_=Depends(require_roles("admin"))):
    cache_key = "admin:attendance:all"
    cached = cache_get(cache_key)
    if cached is not None:
        return {"attendance": cached}
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""SELECT a.id, sess.session_id, st.student_id, st.name, a.confidence_score,
                a.timestamp, sess.title, sess.course, sess.event_date, sess.starts_at, sess.ends_at,
                COALESCE(a.final_attendance_status, a.initial_attendance_status, 'ABSENT') AS status
                FROM attendance_sessions sess JOIN students st ON st.section_id=sess.section_id
                LEFT JOIN attendance_logs a ON a.session_id=sess.session_id AND a.student_id=st.student_id
                ORDER BY sess.event_date DESC, sess.starts_at DESC, st.name""")
            rows = cur.fetchall()
            cache_set(cache_key, rows, ttl=30)
            return {"attendance": rows}
    finally: conn.close()

@app.get("/attendance/{session_id}/live")
def get_live_attendance_telemetry(session_id: str, _=Depends(current_user)):
    """Retrieve real-time live attendance counters without database locking."""
    live = get_attendance_live_state(session_id)
    if live:
        return live
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT session_id, teacher_id, status, section_id, academic_scope FROM attendance_sessions WHERE session_id=%s", (session_id,))
            session = cur.fetchone()
            if not session:
                raise HTTPException(404, "Attendance session not found")
            section_ids = session_section_ids(session)
            cur.execute("SELECT COUNT(*) AS count FROM students WHERE section_id = ANY(%s)", (section_ids,))
            roster_count = cur.fetchone()["count"]
            cur.execute("""SELECT
                COUNT(CASE WHEN COALESCE(final_attendance_status, initial_attendance_status)='PRESENT' THEN 1 END) AS present_count,
                COUNT(CASE WHEN recognition_status='RECOGNIZED' THEN 1 END) AS recognized_count
                FROM attendance_logs WHERE session_id=%s""", (session_id,))
            counts = cur.fetchone()
            present = counts["present_count"] or 0
            recognized = counts["recognized_count"] or 0
            live_data = {
                "session_id": session_id,
                "teacher_id": session["teacher_id"],
                "status": session["status"],
                "total_roster": roster_count,
                "present_count": present,
                "absent_count": max(0, roster_count - present),
                "recognized_count": recognized,
                "updated_at": int(time.time()),
            }
            init_attendance_live_state(session_id, session["teacher_id"], roster_count, session["status"])
            return live_data
    finally:
        conn.close()

@app.get("/batch/{batch_id}/progress")
def get_upload_batch_progress(batch_id: str, _=Depends(current_user)):
    """Retrieve real-time photo batch inference progress from Redis memory."""
    progress = get_batch_progress(batch_id)
    if progress:
        return progress
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""SELECT id, session_id, status, total_files, processed_files,
                recognized_count, duplicate_count, unknown_faces, failed_files,
                created_at, completed_at FROM attendance_upload_batches WHERE id=%s""", (batch_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "Batch not found")
            return dict(row)
    finally:
        conn.close()
