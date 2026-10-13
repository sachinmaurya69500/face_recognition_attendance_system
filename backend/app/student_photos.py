import base64
import io

from PIL import Image, ImageOps


def student_photo_data_uri(photo: bytes | memoryview | None) -> str | None:
    if not photo:
        return None

    with Image.open(io.BytesIO(bytes(photo))) as image:
        thumbnail = ImageOps.exif_transpose(image).convert("RGB")
        thumbnail.thumbnail((96, 96), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        thumbnail.save(output, format="JPEG", quality=65, optimize=True)

    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"
