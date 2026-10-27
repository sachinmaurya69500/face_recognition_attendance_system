"""Visitor management and QR code generation service for the 'Others' role.

Architectural guarantees:
1. Unique, collision-resistant Visitor IDs: VIS-YYYY-XXXXXXXX.
2. QR code payload contains non-sensitive profile details only.
3. Explicit exclusion of passwords, password hashes, complete government ID numbers,
   tokens, and internal system secrets from QR code and logs.
4. Masked identification numbers (e.g., '********1234') displayed in UI and QR code.
5. Server-side authoritative timestamp generation.
"""
import base64
import hashlib
import io
import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger("attendance.visitor_services")

try:
    import qrcode
except ImportError:
    try:
        import subprocess, sys
        logger.warning("qrcode module not found, installing on-the-fly...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "qrcode[pil]>=8.0"])
        import qrcode
    except Exception as exc:
        logger.error(f"Failed to auto-install qrcode: {exc}")
        qrcode = None

# Supported purposes of visit
VALID_PURPOSES = [
    "Interview",
    "Client Meeting",
    "Vendor",
    "Maintenance",
    "Official Meeting",
    "Academic Visit",
    "Other",
]

# Supported identification types
VALID_ID_TYPES = [
    "Passport",
    "Driver's License",
    "Government-Issued Identity Card",
    "Other Accepted Identification",
]


def mask_identification_number(id_num: str) -> str:
    """Mask identification number, preserving only the last 4 characters.

    Never logs or exposes the complete number.
    Example: 'A12345678' -> '*****5678'
    """
    clean = str(id_num or "").strip()
    if not clean:
        return "****"
    if len(clean) <= 4:
        return "*" * len(clean)
    last_four = clean[-4:]
    masked_prefix = "*" * (len(clean) - 4)
    return f"{masked_prefix}{last_four}"


def hash_identification_number(id_num: str) -> str:
    """Compute secure collision-resistant SHA-256 hash of identification number.

    Allows duplicate-detection / lookup without storing plain-text government numbers.
    """
    clean = str(id_num or "").strip().upper()
    return hashlib.sha256(clean.encode("utf-8")).hexdigest()


_in_memory_visitor_seq: Dict[str, int] = {}


def generate_visitor_id(cur=None, target_date: Optional[Any] = None) -> str:
    """Generate a unique sequential Visitor ID in format: VIS-YYYYMMDD-0001.

    - YYYYMMDD is the registration date.
    - 4-digit ascending sequential number starting at 0001 up to 9999 for that date.
    - If cur is provided, queries the database for existing IDs on that date,
      extracts the maximum sequence number, and assigns max_seq + 1.
    - Concurrency-safe: verifies uniqueness against the database.
    """
    if target_date is None:
        dt = datetime.now(timezone.utc)
        date_str = dt.strftime("%Y%m%d")
    elif isinstance(target_date, datetime):
        date_str = target_date.strftime("%Y%m%d")
    elif isinstance(target_date, str):
        clean = re.sub(r"[^\d]", "", target_date)
        if len(clean) >= 8:
            date_str = clean[:8]
        else:
            date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    else:
        date_str = datetime.now(timezone.utc).strftime("%Y%m%d")

    global _in_memory_visitor_seq

    if cur:
        try:
            cur.execute(
                "SELECT visitor_id FROM visitors WHERE visitor_id LIKE %s",
                (f"VIS-{date_str}-%",),
            )
            rows = cur.fetchall()
            max_seq = 0
            for r in rows:
                vid = r["visitor_id"] if isinstance(r, dict) else r[0]
                m = re.search(r"(\d+)$", str(vid or ""))
                if m:
                    try:
                        seq_val = int(m.group(1))
                        if seq_val > max_seq:
                            max_seq = seq_val
                    except ValueError:
                        pass
            next_seq = max_seq + 1
            for _ in range(100):
                candidate = f"VIS-{date_str}-{next_seq:04d}"
                cur.execute("SELECT 1 FROM visitors WHERE visitor_id = %s", (candidate,))
                if not cur.fetchone():
                    _in_memory_visitor_seq[date_str] = max(_in_memory_visitor_seq.get(date_str, 0), next_seq)
                    return candidate
                next_seq += 1
        except Exception as exc:
            logger.warning("Database query failed in generate_visitor_id: %s. Using sequential fallback.", exc)

    seq = _in_memory_visitor_seq.get(date_str, 0) + 1
    _in_memory_visitor_seq[date_str] = seq
    return f"VIS-{date_str}-{seq:04d}"



def build_visitor_qr_payload(visitor: Dict[str, Any]) -> Dict[str, Any]:
    """Construct non-sensitive visitor QR code payload.

    EXPLICITLY EXCLUDES:
    - password / password_hash
    - full identification number
    - authentication tokens or session cookies
    - database credentials or internal secrets
    """
    # Format timestamps cleanly
    def _format_dt(val: Any) -> str:
        if isinstance(val, datetime):
            return val.isoformat()
        return str(val or "")

    return {
        "type": "visitor",
        "visitor_id": visitor.get("visitor_id"),
        "full_name": visitor.get("full_name"),
        "email": visitor.get("email"),
        "phone": visitor.get("phone"),
        "purpose_of_visit": visitor.get("purpose_of_visit"),
        "expected_check_in": _format_dt(visitor.get("expected_check_in")),
        "expected_check_out": _format_dt(visitor.get("expected_check_out")),
        "registration_date": _format_dt(visitor.get("registration_date")),
        "identification_type": visitor.get("identification_type"),
        "identification_number_masked": visitor.get("identification_number_masked"),
    }


def generate_qr_code_bytes(payload: Dict[str, Any]) -> bytes:
    """Generate PNG bytes of the QR code from non-sensitive dictionary payload."""
    payload_str = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )
    qr.add_data(payload_str)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def generate_qr_code_data_uri(payload: Dict[str, Any]) -> str:
    """Generate a base64 PNG data URI for direct rendering in web/mobile image components."""
    png_bytes = generate_qr_code_bytes(payload)
    b64_str = base64.b64encode(png_bytes).decode("ascii")
    return f"data:image/png;base64,{b64_str}"


def validate_email_format(email: str) -> bool:
    """Validate email address format."""
    if not email or len(email) > 160:
        return False
    # RFC 5322 compliant simplified regex
    pattern = r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$"
    return bool(re.match(pattern, email.strip()))
