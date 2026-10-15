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


def generate_visitor_id(cur=None) -> str:
    """Generate a unique Visitor ID in the preferred format: VIS-YYYY-XXXXXXXX.

    YYYY is current registration year, XXXXXXXX is an 8-character hex string.
    Ensures database uniqueness if cursor is provided.
    """
    year = datetime.now(timezone.utc).year
    for _ in range(10):
        unique_suffix = os.urandom(4).hex().upper()
        candidate = f"VIS-{year}-{unique_suffix}"
        if cur:
            cur.execute("SELECT 1 FROM visitors WHERE visitor_id = %s", (candidate,))
            if cur.fetchone():
                continue
        return candidate

    # Fallback with timestamp microsecond component
    hex_ts = hex(int(datetime.now(timezone.utc).timestamp() * 1000))[2:].upper()[-8:]
    return f"VIS-{year}-{hex_ts}"


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
