from pathlib import Path


class Storage:
    """Filesystem media store. All media reads/writes go through this so a future
    deployment can swap in S3/R2 without touching callers."""

    def __init__(self, media_dir: Path):
        self.media_dir = media_dir.resolve()
        self.media_dir.mkdir(parents=True, exist_ok=True)

    def save_bytes(self, data: bytes, key: str) -> str:
        path = self._safe_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return key

    def path_for(self, key: str) -> Path:
        return self._safe_path(key)

    def url_for(self, key: str | None) -> str | None:
        return f"/media/{key}" if key else None

    def exists(self, key: str) -> bool:
        return self._safe_path(key).is_file()

    def _safe_path(self, key: str) -> Path:
        path = (self.media_dir / key).resolve()
        if not path.is_relative_to(self.media_dir):
            raise ValueError(f"media key escapes media dir: {key!r}")
        return path


def get_storage() -> Storage:
    from ..config import settings

    return Storage(settings.media_dir)
