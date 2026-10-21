"""Checks and shrinks product photos before they are stored."""

import warnings
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import get_settings
from app.services.errors import ServiceError

MAX_SIDE = 1600
ALLOWED_FORMATS = {"JPEG", "PNG"}
Image.MAX_IMAGE_PIXELS = 40_000_000  # refuses "decompression bomb" files


def prepare_photo(data: bytes) -> tuple[bytes, str]:
    """Returns the re-encoded photo and its file extension.

    Re-encoding drops anything hidden in the file, including EXIF data such as GPS location. Photos are
    turned the right way up and shrunk to at most 1600 px on the long side, so pages stay light on phones.
    """
    limit_mb = get_settings().max_image_bytes // (1024 * 1024)
    if len(data) > get_settings().max_image_bytes:
        raise ServiceError(f"Photos must be {limit_mb} MB or smaller.", code="file_too_large")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            probe = Image.open(BytesIO(data))
            probe.verify()
            image = Image.open(BytesIO(data))
            image.load()
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ServiceError("That file isn't a JPG or PNG photo.", code="invalid_image") from None
    source_format = image.format
    if source_format not in ALLOWED_FORMATS:
        raise ServiceError("That file isn't a JPG or PNG photo.", code="invalid_image")

    has_alpha = image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)
    image = ImageOps.exif_transpose(image)
    image.thumbnail((MAX_SIDE, MAX_SIDE))

    out = BytesIO()
    # exif_transpose returns a new image without .format, so use the format read above.
    if source_format == "PNG" or has_alpha:
        image.save(out, format="PNG", optimize=True)
        return out.getvalue(), "png"
    image.convert("RGB").save(out, format="JPEG", quality=85, optimize=True)
    return out.getvalue(), "jpg"
