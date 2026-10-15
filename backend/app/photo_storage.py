"""External file storage manager and migration utility for student profile photos.

Architectural Guarantees:
1. Photos are stored as files on external disk storage, not embedded in database rows.
2. Filenames follow the deterministic pattern: studentname__uniquevalue.extension
   (e.g., rahul_sharma__a83f21c9.jpg).
3. Relative storage paths are stored in PostgreSQL: student_photos/rahul_sharma__a83f21c9.jpg
4. Strict path traversal protection prevents accessing unauthorized filesystem paths.
5. Idempotent extraction & migration: safe to run multiple times without duplicating files
   or corrupting existing data. Original binary data is preserved during migration.
"""
import hashlib
import io
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, Union

logger = logging.getLogger("attendance.photo_storage")

# Base directory for storing student profile photos
DEFAULT_STORAGE_ROOT = Path("/workspace/storage")
if not DEFAULT_STORAGE_ROOT.exists():
    # Local native development fallback
    DEFAULT_STORAGE_ROOT = Path(__file__).resolve().parent.parent / "storage"

PHOTO_STORAGE_DIR = Path(os.getenv("PHOTO_STORAGE_DIR", str(DEFAULT_STORAGE_ROOT / "student_photos")))
PHOTO_STORAGE_DIR.mkdir(parents=True, exist_ok=True)


def sanitize_student_name(name: Optional[str]) -> str:
    """Sanitize student name for filename usage.

    Converts to lowercase, replaces spaces/dashes with underscores,
    strips non-alphanumeric characters, and ensures non-empty string.
    """
    if not name:
        return "student"
    cleaned = name.strip().lower()
    cleaned = re.sub(r"[\s\-]+", "_", cleaned)
    cleaned = re.sub(r"[^a-z0-9_]", "", cleaned)
    cleaned = cleaned.strip("_")
    return cleaned if cleaned else "student"


def generate_unique_component(student_id: str) -> str:
    """Generate a collision-resistant, deterministic 8-character hex identifier."""
    clean_id = str(student_id).strip()
    return hashlib.sha256(clean_id.encode("utf-8")).hexdigest()[:8]


def detect_image_extension(raw_bytes: bytes) -> str:
    """Detect image file extension from magic bytes."""
    if not raw_bytes:
        return ".jpg"
    if raw_bytes.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if raw_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if raw_bytes.startswith(b"GIF87a") or raw_bytes.startswith(b"GIF89a"):
        return ".gif"
    if len(raw_bytes) >= 12 and raw_bytes[:4] == b"RIFF" and raw_bytes[8:12] == b"WEBP":
        return ".webp"
    return ".jpg"


def build_photo_filename(name: Optional[str], student_id: str, raw_bytes: bytes) -> str:
    """Construct filename following exact specification: studentname__uniquevalue.extension"""
    safe_name = sanitize_student_name(name)
    unique_val = generate_unique_component(student_id)
    ext = detect_image_extension(raw_bytes)
    return f"{safe_name}__{unique_val}{ext}"


def get_safe_photo_path(relative_or_filename: str) -> Optional[Path]:
    """Resolve a relative photo path or filename securely, preventing path traversal attacks."""
    if not relative_or_filename:
        return None
    # Strip any leading slashes or prefixes like 'student_photos/' or '/student-photos/'
    clean = relative_or_filename.strip().lstrip("/")
    if clean.startswith("student_photos/"):
        clean = clean[len("student_photos/"):]
    elif clean.startswith("student-photos/"):
        clean = clean[len("student-photos/"):]

    # Ensure no directory traversal characters exist in the filename
    filename = Path(clean).name
    if filename != clean or ".." in clean:
        logger.warning("Path traversal attempt blocked: %s", relative_or_filename)
        return None

    resolved = (PHOTO_STORAGE_DIR / filename).resolve()
    try:
        # Check that the resolved file is strictly inside PHOTO_STORAGE_DIR
        resolved.relative_to(PHOTO_STORAGE_DIR.resolve())
        return resolved
    except ValueError:
        logger.warning("File %s escapes storage directory %s", resolved, PHOTO_STORAGE_DIR)
        return None


def save_student_photo(
    student_id: str,
    name: Optional[str],
    photo_data: Union[bytes, memoryview, bytearray, str],
) -> Tuple[str, Path]:
    """Write student photo to storage directory and return (relative_path, absolute_path).

    Relative path format: student_photos/studentname__uniquevalue.extension
    """
    if isinstance(photo_data, (memoryview, bytearray)):
        raw_bytes = bytes(photo_data)
    elif isinstance(photo_data, str):
        # Handle possible base64 string or data URI
        import base64
        clean_str = photo_data
        if "base64," in clean_str:
            clean_str = clean_str.split("base64,")[1]
        raw_bytes = base64.b64decode(clean_str)
    else:
        raw_bytes = bytes(photo_data)

    if not raw_bytes:
        raise ValueError("Cannot save empty photo data")

    filename = build_photo_filename(name, student_id, raw_bytes)
    target_path = PHOTO_STORAGE_DIR / filename
    temp_path = PHOTO_STORAGE_DIR / f"{filename}.tmp.{os.urandom(4).hex()}"

    # Atomic write via temporary file
    with open(temp_path, "wb") as f:
        f.write(raw_bytes)
    os.replace(temp_path, target_path)

    relative_path = f"student_photos/{filename}"
    return relative_path, target_path


def migrate_all_student_photos() -> Dict[str, Any]:
    """Idempotently migrate all existing BYTEA profile photos to external file storage.

    Updates students.profile_picture and users.profile_picture with relative paths
    while preserving original bytea profile_photo for recovery and zero data loss.
    """
    from app.database import get_db_connection

    conn = get_db_connection()
    stats = {
        "total_records": 0,
        "migrated": 0,
        "already_migrated": 0,
        "failed": 0,
        "errors": [],
    }

    try:
        with conn.cursor() as cur:
            # 1. Ensure columns exist
            cur.execute("ALTER TABLE students ADD COLUMN IF NOT EXISTS profile_picture VARCHAR(255);")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture VARCHAR(255);")

            # 2. Select students with photos
            cur.execute("""
                SELECT student_id, name, profile_photo, profile_picture
                FROM students
                WHERE profile_photo IS NOT NULL;
            """)
            rows = cur.fetchall()
            stats["total_records"] = len(rows)

            for r in rows:
                sid = r["student_id"]
                sname = r["name"]
                raw_photo = r["profile_photo"]
                existing_rel_path = r.get("profile_picture")

                # If already migrated and file exists on disk, skip redundant write
                if existing_rel_path:
                    local_file = get_safe_photo_path(existing_rel_path)
                    if local_file and local_file.exists() and local_file.stat().st_size > 0:
                        stats["already_migrated"] += 1
                        continue

                try:
                    rel_path, abs_path = save_student_photo(sid, sname, raw_photo)
                    if not abs_path.exists() or abs_path.stat().st_size == 0:
                        raise IOError(f"Verification failed: {abs_path} is missing or empty")

                    # Update database record with relative path
                    cur.execute(
                        "UPDATE students SET profile_picture = %s WHERE student_id = %s",
                        (rel_path, sid),
                    )
                    # Also update users table if linked
                    cur.execute(
                        "UPDATE users SET profile_picture = %s WHERE student_id = %s",
                        (rel_path, sid),
                    )
                    stats["migrated"] += 1
                except Exception as exc:
                    stats["failed"] += 1
                    stats["errors"].append(f"Student {sid}: {str(exc)}")
                    logger.error("Failed to migrate photo for student %s: %s", sid, exc)

        conn.commit()
    finally:
        conn.close()

    logger.info("Photo migration complete: %s", stats)
    return stats
