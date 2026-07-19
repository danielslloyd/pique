import base64
import io
import json
import random
import uuid
import zipfile
from pathlib import PurePosixPath

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from PIL import Image
from pydantic import BaseModel
from sqlmodel import Session, select

from ..config import settings
from ..db import get_session
from ..models import BookCharacter, Character, CharacterImage, Style, utcnow
from ..services import comfy_client
from ..services.gpu_coordinator import gpu
from ..services.job_runner import start_job
from ..services.storage import Storage, get_storage

router = APIRouter(prefix="/api/characters", tags=["characters"])

MAX_SEED = 2**31 - 1

# artStyle (legacy) -> seeded preset style name
LEGACY_STYLE_MAP = {
    "children_book": "storybook_watercolor",
    "bold_cartoon": "bold_cartoon",
    "ghibli": "ghibli_soft",
    "realistic": "realistic_illustration",
}
DEFAULT_LEGACY_STYLE = "storybook_watercolor"


# --- Schemas ------------------------------------------------------------------


class CharacterSummary(BaseModel):
    id: int
    name: str
    status: str
    description: str
    style_id: int | None
    style_name: str | None
    thumbnail_url: str | None


class StyleBrief(BaseModel):
    id: int | None
    name: str | None
    master_prompt: str | None
    negative_prompt: str | None


class ImageOut(BaseModel):
    id: int
    kind: str
    url: str | None
    seed: int | None


class CharacterDetail(BaseModel):
    id: int
    name: str
    description: str
    status: str
    style: StyleBrief
    identity_prompt: str
    source_photo_url: str | None
    ref_image_url: str | None
    sheet_image_url: str | None
    seed: int | None
    images: list[ImageOut]


class CharacterUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    style_id: int | None = None


class BaseImageRequest(BaseModel):
    prompt_override: str | None = None
    seed: int | None = None
    count: int = 2


class SheetRequest(BaseModel):
    seed: int | None = None
    source_image_id: int | None = None


class RefCropRequest(BaseModel):
    image_id: int
    x: float
    y: float
    w: float
    h: float


class LockRequest(BaseModel):
    ref_image_id: int | None = None
    identity_prompt: str | None = None


# --- Serialization helpers ----------------------------------------------------


def _thumbnail_key(character: Character, session: Session) -> str | None:
    if character.ref_image_path:
        return character.ref_image_path
    if character.sheet_image_path:
        return character.sheet_image_path
    if character.source_photo_path:
        return character.source_photo_path
    first_base = session.exec(
        select(CharacterImage)
        .where(
            CharacterImage.character_id == character.id,
            CharacterImage.kind == "base_candidate",
        )
        .order_by(CharacterImage.id)
    ).first()
    return first_base.path if first_base else None


def _summary(character: Character, session: Session, storage: Storage) -> CharacterSummary:
    style = session.get(Style, character.style_id) if character.style_id else None
    return CharacterSummary(
        id=character.id,
        name=character.name,
        status=character.status,
        description=character.description,
        style_id=character.style_id,
        style_name=style.name if style else None,
        thumbnail_url=storage.url_for(_thumbnail_key(character, session)),
    )


def _detail(character: Character, session: Session, storage: Storage) -> CharacterDetail:
    style = session.get(Style, character.style_id) if character.style_id else None
    images = session.exec(
        select(CharacterImage)
        .where(CharacterImage.character_id == character.id)
        .order_by(CharacterImage.id)
    ).all()
    return CharacterDetail(
        id=character.id,
        name=character.name,
        description=character.description,
        status=character.status,
        style=StyleBrief(
            id=style.id if style else None,
            name=style.name if style else None,
            master_prompt=style.master_prompt if style else None,
            negative_prompt=style.negative_prompt if style else None,
        ),
        identity_prompt=character.identity_prompt,
        source_photo_url=storage.url_for(character.source_photo_path),
        ref_image_url=storage.url_for(character.ref_image_path),
        sheet_image_url=storage.url_for(character.sheet_image_path),
        seed=character.seed,
        images=[
            ImageOut(id=im.id, kind=im.kind, url=storage.url_for(im.path), seed=im.seed)
            for im in images
        ],
    )


def _get_character(character_id: int, session: Session) -> Character:
    character = session.get(Character, character_id)
    if not character:
        raise HTTPException(404, "character not found")
    return character


# --- CRUD ---------------------------------------------------------------------


@router.get("", response_model=list[CharacterSummary])
def list_characters(
    session: Session = Depends(get_session), storage: Storage = Depends(get_storage)
) -> list[CharacterSummary]:
    characters = session.exec(select(Character).order_by(Character.created_at.desc())).all()
    return [_summary(c, session, storage) for c in characters]


@router.post("", response_model=CharacterDetail)
async def create_character(
    name: str = Form(...),
    description: str = Form(...),
    style_id: int = Form(...),
    photo: UploadFile | None = File(None),
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> CharacterDetail:
    if not session.get(Style, style_id):
        raise HTTPException(400, "style not found")
    character = Character(name=name, description=description, style_id=style_id)
    session.add(character)
    session.flush()  # assign id

    if photo is not None:
        data = await photo.read()
        ext = PurePosixPath(photo.filename or "source.png").suffix or ".png"
        key = f"characters/{character.id}/source{ext}"
        storage.save_bytes(data, key)
        character.source_photo_path = key
        session.add(CharacterImage(character_id=character.id, kind="source_photo", path=key))

    session.commit()
    session.refresh(character)
    return _detail(character, session, storage)


@router.get("/{character_id}", response_model=CharacterDetail)
def get_character(
    character_id: int,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> CharacterDetail:
    character = _get_character(character_id, session)
    return _detail(character, session, storage)


@router.patch("/{character_id}", response_model=CharacterDetail)
def update_character(
    character_id: int,
    body: CharacterUpdate,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> CharacterDetail:
    character = _get_character(character_id, session)
    if character.status == "locked":
        raise HTTPException(409, "character is locked")
    updates = body.model_dump(exclude_none=True)
    if "style_id" in updates and not session.get(Style, updates["style_id"]):
        raise HTTPException(400, "style not found")
    for key, value in updates.items():
        setattr(character, key, value)
    session.add(character)
    session.commit()
    session.refresh(character)
    return _detail(character, session, storage)


@router.delete("/{character_id}")
def delete_character(
    character_id: int,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> dict:
    character = _get_character(character_id, session)
    referenced = session.exec(
        select(BookCharacter).where(BookCharacter.character_id == character_id)
    ).first()
    if referenced:
        raise HTTPException(409, "character is referenced by a book")
    images = session.exec(
        select(CharacterImage).where(CharacterImage.character_id == character_id)
    ).all()
    for im in images:
        try:
            path = storage.path_for(im.path)
            if path.is_file():
                path.unlink()
        except (ValueError, OSError):
            pass
        session.delete(im)
    session.delete(character)
    session.commit()
    return {"deleted": character_id}


# --- Image generation jobs ----------------------------------------------------


def _add_image(
    session: Session, character_id: int, kind: str, key: str, seed: int | None
) -> CharacterImage:
    image = CharacterImage(character_id=character_id, kind=kind, path=key, seed=seed)
    session.add(image)
    session.commit()
    session.refresh(image)
    return image


@router.post("/{character_id}/base-image")
async def create_base_image(
    character_id: int,
    body: BaseImageRequest,
    session: Session = Depends(get_session),
) -> dict:
    character = _get_character(character_id, session)
    style = session.get(Style, character.style_id) if character.style_id else None
    if not style:
        raise HTTPException(400, "character has no style")
    base_prompt = body.prompt_override or character.description
    prompt = f"{style.master_prompt}, {base_prompt}"
    count = max(1, body.count)
    seed = body.seed

    async def job(report):
        from ..db import get_engine

        engine = get_engine()
        st = get_storage()
        try:
            template = comfy_client.load_workflow(settings.base_workflow)
        except FileNotFoundError as e:
            raise RuntimeError(
                f"base image workflow '{settings.base_workflow}.json' is missing"
            ) from e
        image_ids: list[int] = []
        async with gpu.phase("comfy"):
            client_id = uuid.uuid4().hex
            for i in range(count):
                used_seed = (seed + i) if seed is not None else random.randint(0, MAX_SEED)
                wf = comfy_client.patch_workflow(template, prompt_text=prompt, seed=used_seed)
                prompt_id = await comfy_client.queue_prompt(wf, client_id)
                outputs = await comfy_client.wait_for_completion(prompt_id, timeout_s=600)
                images = await comfy_client.fetch_output_images(outputs)
                for j, img_bytes in enumerate(images):
                    suffix = "" if j == 0 else f"_{j}"
                    key = f"characters/{character_id}/base_{used_seed}{suffix}.png"
                    st.save_bytes(img_bytes, key)
                    with Session(engine) as s:
                        rec = _add_image(s, character_id, "base_candidate", key, used_seed)
                        image_ids.append(rec.id)
                report((i + 1) / count)
        return {"character_id": character_id, "image_ids": image_ids, "count": len(image_ids)}

    job_id = start_job("base_image", job)
    return {"job_id": job_id}


@router.post("/{character_id}/sheet")
async def create_sheet(
    character_id: int,
    body: SheetRequest,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> dict:
    character = _get_character(character_id, session)
    style = session.get(Style, character.style_id) if character.style_id else None
    if not style:
        raise HTTPException(400, "character has no style")

    # Resolve the input image bytes now (needs request session/storage).
    if body.source_image_id is not None:
        src = session.get(CharacterImage, body.source_image_id)
        if not src or src.character_id != character_id:
            raise HTTPException(400, "source_image_id not found for this character")
        input_key = src.path
    elif character.source_photo_path:
        input_key = character.source_photo_path
    else:
        raise HTTPException(400, "no source image available for sheet generation")

    if not storage.exists(input_key):
        raise HTTPException(400, "source image file missing")
    input_bytes = storage.path_for(input_key).read_bytes()

    # The USO sheet workflow has no built-in turnaround boilerplate (the CCC one did),
    # so the full instruction lives in the prompt we inject.
    prompt_text = (
        f"character turnaround sheet of this exact character, three full-body views "
        f"in a clean horizontal row on a plain white background: front view, side profile, "
        f"back view, evenly spaced, consistent lighting, same proportions and details in "
        f"every view. {style.master_prompt}. {character.description}"
    )
    seed = body.seed if body.seed is not None else random.randint(0, MAX_SEED)

    async def job(report):
        from ..db import get_engine

        engine = get_engine()
        st = get_storage()
        try:
            template = comfy_client.load_workflow(settings.sheet_workflow)
        except FileNotFoundError as e:
            raise RuntimeError(f"{settings.sheet_workflow}.json workflow is missing") from e
        async with gpu.phase("comfy"):
            client_id = uuid.uuid4().hex
            server_filename = await comfy_client.upload_image(input_bytes, "sheet_input.png")
            wf = comfy_client.patch_workflow(
                template, input_image=server_filename, prompt_text=prompt_text, seed=seed
            )
            prompt_id = await comfy_client.queue_prompt(wf, client_id)
            outputs = await comfy_client.wait_for_completion(
                prompt_id, on_progress=report, timeout_s=1800
            )
            images = await comfy_client.fetch_output_images(outputs)
        if not images:
            raise RuntimeError("sheet generation produced no images")

        # Largest by pixel area is the sheet; the rest are harmless extras.
        def area(b: bytes) -> int:
            try:
                with Image.open(io.BytesIO(b)) as im:
                    return im.width * im.height
            except Exception:  # noqa: BLE001
                return len(b)

        order = sorted(range(len(images)), key=lambda k: area(images[k]), reverse=True)
        sheet_idx = order[0]
        sheet_key = f"characters/{character_id}/sheet_{seed}.png"
        st.save_bytes(images[sheet_idx], sheet_key)
        result_ids: list[int] = []
        with Session(engine) as s:
            rec = _add_image(s, character_id, "sheet", sheet_key, seed)
            result_ids.append(rec.id)
            character = s.get(Character, character_id)
            character.sheet_image_path = sheet_key
            character.seed = seed
            s.add(character)
            s.commit()
            for n, idx in enumerate(order[1:]):
                extra_key = f"characters/{character_id}/sheet_{seed}_extra_{n}.png"
                st.save_bytes(images[idx], extra_key)
                extra = _add_image(s, character_id, "sheet_extra", extra_key, seed)
                result_ids.append(extra.id)
        return {"character_id": character_id, "sheet_id": result_ids[0], "image_ids": result_ids}

    job_id = start_job("sheet", job)
    return {"job_id": job_id}


@router.post("/{character_id}/ref-crop", response_model=ImageOut)
def ref_crop(
    character_id: int,
    body: RefCropRequest,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> ImageOut:
    character = _get_character(character_id, session)
    src = session.get(CharacterImage, body.image_id)
    if not src or src.character_id != character_id:
        raise HTTPException(400, "image_id not found for this character")
    if not storage.exists(src.path):
        raise HTTPException(400, "source image file missing")

    with Image.open(storage.path_for(src.path)) as im:
        im = im.convert("RGB")
        w, h = im.size
        left = int(max(0.0, min(1.0, body.x)) * w)
        top = int(max(0.0, min(1.0, body.y)) * h)
        right = int(min(1.0, body.x + body.w) * w)
        bottom = int(min(1.0, body.y + body.h) * h)
        if right <= left or bottom <= top:
            raise HTTPException(400, "invalid crop rectangle")
        cropped = im.crop((left, top, right, bottom))
        buf = io.BytesIO()
        cropped.save(buf, format="PNG")

    key = f"characters/{character_id}/ref.png"
    storage.save_bytes(buf.getvalue(), key)
    character.ref_image_path = key
    session.add(character)
    rec = _add_image(session, character_id, "ref_crop", key, None)
    session.refresh(character)
    return ImageOut(id=rec.id, kind=rec.kind, url=storage.url_for(rec.path), seed=rec.seed)


# --- Identity prompt (Ollama, best-effort) ------------------------------------


def _template_identity(character: Character) -> str:
    desc = character.description.strip()
    if desc:
        return desc
    return f"A character named {character.name}."


async def _draft_identity_via_vision(image_b64: str) -> str:
    payload = {
        "model": "qwen3-vl:8b",
        "stream": False,
        "keep_alive": "2m",
        "messages": [
            {
                "role": "user",
                "content": (
                    "Describe this character's visual appearance in 1-2 concise "
                    "sentences for use as a consistent image-generation descriptor. "
                    "Focus on hair, clothing, colors, and distinctive features."
                ),
                "images": [image_b64],
            }
        ],
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(f"{settings.ollama_url}/api/chat", json=payload)
    resp.raise_for_status()
    return resp.json()["message"]["content"].strip()


async def _draft_identity_via_text(character: Character) -> str:
    prompt = (
        "Write a 1-2 sentence visual descriptor of a character for consistent "
        "image generation (like 'A young girl with curly red hair wearing a yellow "
        f"raincoat'). Name: {character.name}. Description: {character.description}. "
        "Reply with only the descriptor."
    )
    payload = {
        "model": settings.story_model,
        "prompt": prompt,
        "stream": False,
        "keep_alive": "2m",
    }
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(f"{settings.ollama_url}/api/generate", json=payload)
    resp.raise_for_status()
    return resp.json()["response"].strip()


@router.post("/{character_id}/identity-prompt")
async def identity_prompt(
    character_id: int,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> dict:
    character = _get_character(character_id, session)

    image_key = (
        character.sheet_image_path
        or character.ref_image_path
        or character.source_photo_path
    )
    draft: str | None = None
    async with gpu.phase("llm"):
        if image_key and storage.exists(image_key):
            try:
                img_bytes = storage.path_for(image_key).read_bytes()
                image_b64 = base64.b64encode(img_bytes).decode("ascii")
                draft = await _draft_identity_via_vision(image_b64)
            except Exception:  # noqa: BLE001 - fall through to text draft
                draft = None
        if not draft:
            try:
                draft = await _draft_identity_via_text(character)
            except Exception:  # noqa: BLE001 - fall back to template
                draft = None
    if not draft:
        draft = _template_identity(character)

    character.identity_prompt = draft
    session.add(character)
    session.commit()
    return {"identity_prompt": draft}


# --- Lock / unlock ------------------------------------------------------------


@router.post("/{character_id}/lock", response_model=CharacterDetail)
def lock_character(
    character_id: int,
    body: LockRequest,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> CharacterDetail:
    character = _get_character(character_id, session)
    if character.status == "locked":
        raise HTTPException(409, "character is already locked")

    if body.ref_image_id is not None:
        ref = session.get(CharacterImage, body.ref_image_id)
        if not ref or ref.character_id != character_id:
            raise HTTPException(400, "ref_image_id not found for this character")
        character.ref_image_path = ref.path
    if not character.ref_image_path:
        raise HTTPException(400, "a reference image is required to lock")

    if body.identity_prompt:
        character.identity_prompt = body.identity_prompt
    if not character.identity_prompt.strip():
        raise HTTPException(400, "a non-empty identity prompt is required to lock")

    character.status = "locked"
    character.locked_at = utcnow()
    session.add(character)
    session.commit()
    session.refresh(character)
    return _detail(character, session, storage)


@router.post("/{character_id}/unlock", response_model=CharacterDetail)
def unlock_character(
    character_id: int,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> CharacterDetail:
    character = _get_character(character_id, session)
    referenced = session.exec(
        select(BookCharacter).where(BookCharacter.character_id == character_id)
    ).first()
    if referenced:
        raise HTTPException(409, "character is referenced by a book")
    character.status = "draft"
    character.locked_at = None
    session.add(character)
    session.commit()
    session.refresh(character)
    return _detail(character, session, storage)


# --- Legacy import ------------------------------------------------------------


@router.post("/import-legacy")
async def import_legacy(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
) -> dict:
    data = await file.read()
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise HTTPException(400, "not a valid zip archive") from e
    names = set(archive.namelist())
    if "characters.json" not in names:
        raise HTTPException(400, "missing characters.json")
    try:
        entries = json.loads(archive.read("characters.json"))
    except json.JSONDecodeError as e:
        raise HTTPException(400, "characters.json is not valid JSON") from e
    if not isinstance(entries, list):
        raise HTTPException(400, "characters.json must be a list")

    # Preset styles by name for artStyle mapping.
    styles = {s.name: s for s in session.exec(select(Style)).all()}

    imported_ids: list[int] = []
    errors: list[dict] = []

    for idx, entry in enumerate(entries):
        try:
            if not isinstance(entry, dict):
                raise ValueError("entry is not an object")
            art_style = entry.get("artStyle")
            style_name = LEGACY_STYLE_MAP.get(art_style, DEFAULT_LEGACY_STYLE)
            style = styles.get(style_name) or styles.get(DEFAULT_LEGACY_STYLE)

            attributes = {}
            if isinstance(entry.get("attributes"), dict):
                attributes.update(entry["attributes"])
            if entry.get("tags"):
                attributes["tags"] = entry["tags"]

            character = Character(
                name=entry.get("name") or f"Imported {idx + 1}",
                description=entry.get("description") or "",
                style_id=style.id if style else None,
                attributes_json=json.dumps(attributes),
                status="draft",
            )
            session.add(character)
            session.flush()  # assign id

            primary = entry.get("primaryImage")
            image_names = entry.get("images") or []
            saved_primary = False
            for n, image_name in enumerate(image_names):
                arc_name = image_name
                if arc_name not in names:
                    arc_name = f"images/{image_name}"
                if arc_name not in names:
                    continue
                img_bytes = archive.read(arc_name)
                key = f"characters/{character.id}/legacy_{n}.png"
                storage.save_bytes(img_bytes, key)
                session.add(
                    CharacterImage(
                        character_id=character.id, kind="base_candidate", path=key
                    )
                )
                if primary and image_name == primary and not saved_primary:
                    sheet_key = f"characters/{character.id}/legacy_primary.png"
                    storage.save_bytes(img_bytes, sheet_key)
                    session.add(
                        CharacterImage(
                            character_id=character.id, kind="sheet", path=sheet_key
                        )
                    )
                    character.sheet_image_path = sheet_key
                    saved_primary = True

            session.add(character)
            session.commit()
            imported_ids.append(character.id)
        except Exception as e:  # noqa: BLE001 - report per-entry, keep going
            session.rollback()
            errors.append({"index": idx, "error": str(e)})

    return {"imported": len(imported_ids), "characters": imported_ids, "errors": errors}
