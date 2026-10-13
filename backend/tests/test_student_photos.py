import base64
import io

from PIL import Image

from app.student_photos import student_photo_data_uri


def test_student_photo_data_uri_returns_small_thumbnail():
    original = Image.new("RGB", (2400, 1600), color=(25, 100, 180))
    original_bytes = io.BytesIO()
    original.save(original_bytes, format="JPEG", quality=95)

    result = student_photo_data_uri(original_bytes.getvalue())

    assert result is not None
    assert result.startswith("data:image/jpeg;base64,")
    thumbnail_bytes = base64.b64decode(result.split(",", 1)[1])
    with Image.open(io.BytesIO(thumbnail_bytes)) as thumbnail:
        assert thumbnail.size == (96, 64)
    assert len(thumbnail_bytes) < len(original_bytes.getvalue())


def test_student_photo_data_uri_returns_none_for_missing_photo():
    assert student_photo_data_uri(None) is None
    assert student_photo_data_uri(b"") is None
