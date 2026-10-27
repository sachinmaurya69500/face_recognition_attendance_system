import base64
import hashlib
import io
import threading
from typing import Optional

from PIL import Image, ImageOps

# In-memory LRU cache for computed thumbnails to avoid CPU-intensive recomputation
_THUMBNAIL_CACHE: dict[str, str] = {}
_THUMBNAIL_CACHE_LOCK = threading.Lock()
_MAX_THUMBNAIL_CACHE_SIZE = 1000


def student_photo_data_uri(photo: bytes | memoryview | None) -> Optional[str]:
    if not photo:
        return None

    raw_bytes = bytes(photo)
    if not raw_bytes:
        return None

    digest = hashlib.md5(raw_bytes).hexdigest()
    with _THUMBNAIL_CACHE_LOCK:
        cached = _THUMBNAIL_CACHE.get(digest)
        if cached is not None:
            return cached

    with Image.open(io.BytesIO(raw_bytes)) as image:
        thumbnail = ImageOps.exif_transpose(image).convert("RGB")
        thumbnail.thumbnail((96, 96), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        thumbnail.save(output, format="JPEG", quality=65, optimize=True)

    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    data_uri = f"data:image/jpeg;base64,{encoded}"

    with _THUMBNAIL_CACHE_LOCK:
        if len(_THUMBNAIL_CACHE) >= _MAX_THUMBNAIL_CACHE_SIZE:
            # Evict oldest 20%
            keys = list(_THUMBNAIL_CACHE.keys())[:200]
            for k in keys:
                _THUMBNAIL_CACHE.pop(k, None)
        _THUMBNAIL_CACHE[digest] = data_uri

    return data_uri
