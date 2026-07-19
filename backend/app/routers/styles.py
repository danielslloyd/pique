from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..models import Book, Character, Style
from ..services.storage import Storage, get_storage

router = APIRouter(prefix="/api/styles", tags=["styles"])


class StyleOut(BaseModel):
    id: int
    name: str
    is_preset: bool
    master_prompt: str
    negative_prompt: str
    thumbnail_url: str | None


class StyleCreate(BaseModel):
    name: str
    master_prompt: str
    negative_prompt: str = ""


class StyleUpdate(BaseModel):
    name: str | None = None
    master_prompt: str | None = None
    negative_prompt: str | None = None


def _out(style: Style, storage: Storage) -> StyleOut:
    return StyleOut(
        id=style.id,
        name=style.name,
        is_preset=style.is_preset,
        master_prompt=style.master_prompt,
        negative_prompt=style.negative_prompt,
        thumbnail_url=storage.url_for(style.thumbnail_path),
    )


@router.get("", response_model=list[StyleOut])
def list_styles(
    session: Session = Depends(get_session), storage: Storage = Depends(get_storage)
) -> list[StyleOut]:
    # Presets first, then customs; stable by id within each group.
    styles = session.exec(
        select(Style).order_by(Style.is_preset.desc(), Style.id)
    ).all()
    return [_out(s, storage) for s in styles]


@router.post("", response_model=StyleOut)
def create_style(
    body: StyleCreate,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> StyleOut:
    style = Style(
        name=body.name,
        master_prompt=body.master_prompt,
        negative_prompt=body.negative_prompt,
        is_preset=False,
    )
    session.add(style)
    session.commit()
    session.refresh(style)
    return _out(style, storage)


@router.patch("/{style_id}", response_model=StyleOut)
def update_style(
    style_id: int,
    body: StyleUpdate,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> StyleOut:
    style = session.get(Style, style_id)
    if not style:
        raise HTTPException(404, "style not found")
    if style.is_preset:
        raise HTTPException(409, "cannot modify a preset style")
    for key, value in body.model_dump(exclude_none=True).items():
        setattr(style, key, value)
    session.add(style)
    session.commit()
    session.refresh(style)
    return _out(style, storage)


@router.delete("/{style_id}")
def delete_style(style_id: int, session: Session = Depends(get_session)) -> dict:
    style = session.get(Style, style_id)
    if not style:
        raise HTTPException(404, "style not found")
    if style.is_preset:
        raise HTTPException(409, "cannot delete a preset style")
    referenced = session.exec(
        select(Character.id).where(Character.style_id == style_id)
    ).first() or session.exec(
        select(Book.id).where(Book.style_id == style_id)
    ).first()
    if referenced:
        raise HTTPException(409, "style is referenced by a character or book")
    session.delete(style)
    session.commit()
    return {"deleted": style_id}
