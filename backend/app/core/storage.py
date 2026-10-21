"""Where uploaded files live. Local disk in development; an S3-compatible store can implement the same
interface for production (HANDOFF.md, "Files")."""

from functools import lru_cache
from pathlib import Path
from typing import Protocol

from app.core.config import get_settings

MEDIA_PREFIX = "/media/"


class FileStorage(Protocol):
    def save(self, key: str, data: bytes) -> str:
        """Stores the bytes and returns the URL to save on the record."""
        ...

    def delete_url(self, url: str) -> None: ...

    def save_private(self, key: str, data: bytes) -> str:
        """Stores a file that must never be public (print-request uploads). Returns the key to keep."""
        ...

    def read_private(self, key: str) -> bytes: ...


class LocalFileStorage:
    """Files under UPLOAD_DIR, outside the web root. app.api.v1.media serves the public ones."""

    def __init__(self, root: str) -> None:
        self.root = Path(root).resolve()

    def path_for(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError("Path escapes the upload folder")
        return path

    def save(self, key: str, data: bytes) -> str:
        path = self.path_for(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return MEDIA_PREFIX + key

    def delete_url(self, url: str) -> None:
        if url.startswith(MEDIA_PREFIX):
            self.path_for(url.removeprefix(MEDIA_PREFIX)).unlink(missing_ok=True)

    def save_private(self, key: str, data: bytes) -> str:
        if key.startswith("products/"):
            raise ValueError("products/ is the public folder")
        path = self.path_for(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return key

    def read_private(self, key: str) -> bytes:
        return self.path_for(key).read_bytes()


@lru_cache
def get_storage() -> FileStorage:
    return LocalFileStorage(get_settings().upload_dir)
