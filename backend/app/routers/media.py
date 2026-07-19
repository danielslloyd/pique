from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from ..services.storage import Storage, get_storage

router = APIRouter(tags=["media"])


@router.get("/media/{key:path}")
def serve_media(key: str, storage: Storage = Depends(get_storage)) -> FileResponse:
    try:
        path = storage.path_for(key)
    except ValueError:
        raise HTTPException(404, "not found") from None
    if not path.is_file():
        raise HTTPException(404, "not found")
    return FileResponse(path)
